"""
Jarvis Glasses Assistant — Realtime Voice & WebSocket Relay Server (T02/T03)
Connects mobile client with Gemini API:
- Speech recognition & intent processing via Gemini 2.5 Flash
- Real-time Function Calling / Tool execution via js/tools.js definitions
- High-fidelity natural voice response generation (24kHz PCM)
- Interruption (barge-in) and state synchronisation
"""

import os
import json
import base64
import asyncio
import aiohttp
from aiohttp import web

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

# System prompt according to Muse specification
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

# Keep conversational memory per connection
conversations = {}

async def generate_gemini_reply(user_text, session_id):
    if session_id not in conversations:
        conversations[session_id] = []

    history = conversations[session_id]
    history.append({"role": "user", "parts": [{"text": user_text}]})

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    
    payload = {
        "systemInstruction": {
            "parts": [{"text": SYSTEM_INSTRUCTION}]
        },
        "contents": history,
        "tools": [{"functionDeclarations": TOOLS_DECLARATION}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 200
        }
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload) as resp:
            data = await resp.json()
            if "error" in data:
                raise RuntimeError(data["error"].get("message", "Gemini error"))

            candidate = data["candidates"][0]["content"]
            first_part = candidate["parts"][0]

            # Check if model wants to call a tool
            if "functionCall" in first_part:
                fc = first_part["functionCall"]
                tool_name = fc["name"]
                tool_args = fc.get("args", {})
                return {
                    "type": "tool_call",
                    "name": tool_name,
                    "args": tool_args,
                    "candidate": candidate
                }

            text_reply = first_part.get("text", "")
            history.append({"role": "model", "parts": [{"text": text_reply}]})
            return {"type": "text", "text": text_reply}

async def generate_tts_audio(text):
    """Generates 24kHz PCM audio using Gemini Flash TTS."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key={GEMINI_API_KEY}"
    payload = {
        "contents": [{"parts": [{"text": text}]}],
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

    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload) as resp:
            data = await resp.json()
            parts = data["candidates"][0]["content"]["parts"]
            for p in parts:
                if "inlineData" in p:
                    return p["inlineData"]["data"] # Base64 PCM 24kHz
    return None

async def handle_tool_feedback(session_id, candidate, tool_name, tool_result):
    """Send tool execution output back to Gemini to complete response."""
    history = conversations.get(session_id, [])
    history.append(candidate)
    history.append({
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
        "contents": history,
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 150}
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload) as resp:
            data = await resp.json()
            text_reply = data["candidates"][0]["content"]["parts"][0].get("text", "")
            history.append({"role": "model", "parts": [{"text": text_reply}]})
            return text_reply

async def handle_ws(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    session_id = id(ws)
    print(f"[server-ws] Connected client session: {session_id}")

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                data = json.loads(msg.data)
                evt = data.get("type")

                if evt == "ping":
                    await ws.send_json({"type": "pong"})

                elif evt == "user_utterance":
                    # User completed speech
                    user_text = data.get("text", "").strip()
                    if not user_text:
                        continue

                    print(f"[server-ws] User: {user_text}")
                    await ws.send_json({"type": "state", "state": "thinking"})

                    try:
                        res = await generate_gemini_reply(user_text, session_id)

                        if res["type"] == "tool_call":
                            # Request client/local tool execution
                            await ws.send_json({
                                "type": "execute_tool",
                                "name": res["name"],
                                "args": res["args"],
                                "candidate": res["candidate"]
                            })
                        else:
                            reply_text = res["text"]
                            print(f"[server-ws] Jarvis: {reply_text}")
                            
                            # Synthesize 24kHz audio
                            pcm_b64 = await generate_tts_audio(reply_text)
                            await ws.send_json({
                                "type": "assistant_reply",
                                "text": reply_text,
                                "audio_pcm24k": pcm_b64
                            })
                    except Exception as err:
                        print(f"[server-ws] Generation error: {err}")
                        await ws.send_json({"type": "error", "message": str(err)})

                elif evt == "tool_response":
                    tool_name = data.get("name")
                    tool_output = data.get("result")
                    candidate = data.get("candidate")

                    reply_text = await handle_tool_feedback(session_id, candidate, tool_name, tool_output)
                    print(f"[server-ws] Jarvis (post-tool): {reply_text}")
                    pcm_b64 = await generate_tts_audio(reply_text)
                    await ws.send_json({
                        "type": "assistant_reply",
                        "text": reply_text,
                        "audio_pcm24k": pcm_b64
                    })

                elif evt == "barge_in":
                    # User interrupted speaking
                    print("[server-ws] Barge-in event triggered by user")
                    await ws.send_json({"type": "state", "state": "listening"})

    finally:
        conversations.pop(session_id, None)
        print(f"[server-ws] Disconnected session: {session_id}")

    return ws

def init_app():
    app = web.Application()
    app.router.add_get("/ws", handle_ws)
    base_dir = os.path.dirname(os.path.abspath(__file__))
    app.router.add_static("/", path=base_dir, show_index=True)
    return app

if __name__ == "__main__":
    print(f"🚀 Jarvis Relay Server running on http://{HOST}:{PORT}")
    app = init_app()
    web.run_app(app, host=HOST, port=PORT)
