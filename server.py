"""
Jarvis Glasses Assistant — Realtime Voice & WebSocket Relay Server (T02/T03)
Integrated with VisionClaw Gateway Patterns:
- Bi-directional WebSocket relay for streaming audio & control frames
- Resilient session state management & conversational memory
- Native Gemini 2.5 Flash Function Calling (T05) & I CLUB Knowledge Base (T04)
- 24kHz PCM linear audio generation for wearable companion glasses
- Safe interruption (barge-in) and dangerous actions guard
"""

import os
import json
import base64
import asyncio
import logging
import aiohttp
from aiohttp import web

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [%(levelname)s] %(message)s")
logger = logging.getLogger("jarvis-relay")

# Load .env variables
ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(ENV_PATH):
    with open(ENV_PATH) as f:
        for line in f:
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ[k] = v

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
HOST = os.getenv("APP_HOST", "0.0.0.0")
PORT = int(os.getenv("APP_PORT", 3000))

# System instruction with strict persona and I CLUB grounding
SYSTEM_INSTRUCTION = """Ты — Джарвис, персональный голосовой AI-помощник Романа для умных очков.
Характер и стиль:
1. Отвечай кратко, чётко, емко (1-2 предложения), как подобает ассистенту в очках/гарнитуре.
2. По проектам и вопросам найма: отвечай строго по базе знаний I CLUB (международный рекрутинг линейного персонала в Европе: склады, производство, логистика; квалификация документов ЕС, ВНЖ, Параграф 24; омниканальная CRM EspoCRM).
3. Опасные или деструктивные действия (удаление данных, массовая рассылка, изменение конфигов) выполняй ТОЛЬКО после явного словесного или тактильного подтверждения Романа.
4. При вопросах о состоянии системы, устройства, батареи, времени или задач — используй соответствующие инструменты (function calling).
Язык общения: русский."""

TOOLS_DECLARATION = [
    {
        "name": "get_system_status",
        "description": "Получить текущий статус системы, устройства (очков/смартфона), сети и батареи."
    },
    {
        "name": "get_active_tasks",
        "description": "Получить список активных или запланированных задач ассистента."
    },
    {
        "name": "query_iclub_knowledge",
        "description": "Поиск информации в базе знаний I CLUB (международный рекрутинг, кандидаты, регламенты, CRM).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {
                    "type": "STRING",
                    "description": "Поисковый запрос или вопрос по I CLUB"
                }
            },
            "required": ["query"]
        }
    }
]

# Conversational session storage (Gateway pattern from VisionClaw)
sessions = {}

class SessionState:
    def __init__(self, session_id):
        self.session_id = session_id
        self.history = []
        self.pending_tool = None
        self.is_interrupted = False

    def reset_interrupt(self):
        self.is_interrupted = False

    def interrupt(self):
        self.is_interrupted = True

async def generate_gemini_reply(user_text, session: SessionState):
    session.history.append({"role": "user", "parts": [{"text": user_text}]})

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    
    payload = {
        "systemInstruction": {
            "parts": [{"text": SYSTEM_INSTRUCTION}]
        },
        "contents": session.history,
        "tools": [{"functionDeclarations": TOOLS_DECLARATION}],
        "generationConfig": {
            "temperature": 0.35,
            "maxOutputTokens": 200
        }
    }

    async with aiohttp.ClientSession() as http_client:
        async with http_client.post(url, json=payload) as resp:
            data = await resp.json()
            if "error" in data:
                raise RuntimeError(data["error"].get("message", "Gemini error"))

            candidate = data["candidates"][0]["content"]
            first_part = candidate["parts"][0]

            if "functionCall" in first_part:
                fc = first_part["functionCall"]
                return {
                    "type": "tool_call",
                    "name": fc["name"],
                    "args": fc.get("args", {}),
                    "candidate": candidate
                }

            text_reply = first_part.get("text", "")
            session.history.append({"role": "model", "parts": [{"text": text_reply}]})
            return {"type": "text", "text": text_reply}

async def generate_tts_audio(text):
    """Generates 24kHz PCM linear audio via Flash TTS."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key={GEMINI_API_KEY}"
    tts_prompt = f"Read the following text aloud with no modification: {text}"
    payload = {
        "contents": [{"parts": [{"text": tts_prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": "Puck"
                    }
                }
            }
        }
    }
    async with aiohttp.ClientSession() as http_client:
        async with http_client.post(url, json=payload) as resp:
            data = await resp.json()
            parts = data["candidates"][0]["content"]["parts"]
            for p in parts:
                if "inlineData" in p:
                    return p["inlineData"]["data"]
    return None

async def handle_tool_feedback(session: SessionState, candidate, tool_name, tool_result):
    session.history.append(candidate)
    session.history.append({
        "role": "function",
        "parts": [{
            "functionResponse": {
                "name": tool_name,
                "response": {"output": tool_result}
            }
        }]
    })

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "contents": session.history,
        "generationConfig": {"temperature": 0.35, "maxOutputTokens": 150}
    }

    async with aiohttp.ClientSession() as http_client:
        async with http_client.post(url, json=payload) as resp:
            data = await resp.json()
            text_reply = data["candidates"][0]["content"]["parts"][0].get("text", "")
            session.history.append({"role": "model", "parts": [{"text": text_reply}]})
            return text_reply

async def handle_ws(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    session_id = str(id(ws))
    session = SessionState(session_id)
    sessions[session_id] = session
    logger.info(f"Client connected (Session {session_id})")

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                data = json.loads(msg.data)
                evt = data.get("type")

                if evt == "ping":
                    await ws.send_json({"type": "pong"})

                elif evt == "user_utterance":
                    user_text = data.get("text", "").strip()
                    if not user_text:
                        continue

                    session.reset_interrupt()
                    logger.info(f"[{session_id}] User said: {user_text}")
                    await ws.send_json({"type": "state", "state": "thinking"})

                    try:
                        res = await generate_gemini_reply(user_text, session)

                        if session.is_interrupted:
                            logger.info(f"[{session_id}] Interrupted during inference")
                            continue

                        if res["type"] == "tool_call":
                            logger.info(f"[{session_id}] Dispatching tool: {res['name']}")
                            await ws.send_json({
                                "type": "execute_tool",
                                "name": res["name"],
                                "args": res["args"],
                                "candidate": res["candidate"]
                            })
                        else:
                            reply_text = res["text"]
                            logger.info(f"[{session_id}] Jarvis reply: {reply_text}")
                            pcm_b64 = await generate_tts_audio(reply_text)

                            if not session.is_interrupted:
                                await ws.send_json({
                                    "type": "assistant_reply",
                                    "text": reply_text,
                                    "audio_pcm24k": pcm_b64
                                })
                    except Exception as err:
                        logger.error(f"[{session_id}] Inference error: {err}")
                        await ws.send_json({"type": "error", "message": str(err)})

                elif evt == "tool_response":
                    tool_name = data.get("name")
                    tool_output = data.get("result")
                    candidate = data.get("candidate")

                    reply_text = await handle_tool_feedback(session, candidate, tool_name, tool_output)
                    logger.info(f"[{session_id}] Jarvis post-tool reply: {reply_text}")
                    pcm_b64 = await generate_tts_audio(reply_text)

                    if not session.is_interrupted:
                        await ws.send_json({
                            "type": "assistant_reply",
                            "text": reply_text,
                            "audio_pcm24k": pcm_b64
                        })

                elif evt == "barge_in":
                    logger.info(f"[{session_id}] Barge-in interruption triggered")
                    session.interrupt()
                    await ws.send_json({"type": "state", "state": "listening"})

    finally:
        sessions.pop(session_id, None)
        logger.info(f"Session {session_id} terminated")

    return ws

def init_app():
    app = web.Application()
    app.router.add_get("/ws", handle_ws)
    base_dir = os.path.dirname(os.path.abspath(__file__))
    app.router.add_static("/", path=base_dir, show_index=True)
    return app

if __name__ == "__main__":
    logger.info(f"Starting Jarvis Relay Gateway on http://{HOST}:{PORT}")
    app = init_app()
    web.run_app(app, host=HOST, port=PORT)
