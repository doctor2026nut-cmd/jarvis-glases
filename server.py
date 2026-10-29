import agent_bridge
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
        "name": "delegate_to_agent",
        "description": "Передать поручение или запрос одному из субагентов (Antigravity на сервере, Meta Muse, OpenClaw).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "agent": {
                    "type": "STRING",
                    "description": "Имя агента: 'antigravity', 'muse', 'openclaw'",
                    "enum": ["antigravity", "muse", "openclaw"]
                },
                "instruction": {
                    "type": "STRING",
                    "description": "Четкая задача или вопрос, который нужно передать агенту"
                }
            },
            "required": ["agent", "instruction"]
        }
    },
    {
        "name": "control_media_app",
        "description": "Управление приложениями на смартфоне (музыка, переводчик, заметки, звонки).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "app": {
                    "type": "STRING",
                    "description": "Приложение: 'music', 'translator', 'notes', 'whatsapp'",
                    "enum": ["music", "translator", "notes", "whatsapp"]
                },
                "action": {
                    "type": "STRING",
                    "description": "Действие: 'open', 'play', 'pause', 'next'"
                }
            },
            "required": ["app", "action"]
        }
    },
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

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={GEMINI_API_KEY}"
    
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

            candidates = data.get("candidates", [])
            if not candidates:
                logger.warning(f"No candidates from Gemini: {data}")
                return {"type": "text", "text": "Я вас слушаю, Роман."}

            candidate = candidates[0].get("content", {})
            parts = candidate.get("parts", [])
            if not parts:
                logger.warning(f"Empty parts in Gemini candidate: {data}")
                return {"type": "text", "text": "Слушаю вас."}

            # Check if any part is a function call
            for part in parts:
                if "functionCall" in part:
                    fc = part["functionCall"]
                    return {
                        "type": "tool_call",
                        "name": fc["name"],
                        "args": fc.get("args", {}),
                        "candidate": candidate
                    }

            # Extract text (skip internal thoughts if present)
            text_reply = ""
            for part in parts:
                if "text" in part and not part.get("thought", False):
                    text_reply += part["text"] + " "
            text_reply = text_reply.strip() or "Слушаю вас."

            session.history.append({"role": "model", "parts": [{"text": text_reply}]})
            return {"type": "text", "text": text_reply}

async def generate_tts_audio(text):
    """
    Generates audio for Jarvis.
    Primary: High-fidelity local Edge Neural TTS with ffmpeg PCM 24kHz stream.
    Fallback: Gemini Preview TTS.
    """
    clean_text = text.replace('\n', ' ').strip()
    if not clean_text:
        return None

    # 1. Спробуємо локальний Neural TTS (port 8000), який дає стабільний звук
    try:
        import urllib.parse
        encoded_text = urllib.parse.quote(clean_text)
        url = f"http://127.0.0.1:8000/api/tts?text={encoded_text}&lang=ru"
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=6)) as resp:
                if resp.status == 200:
                    mp3_bytes = await resp.read()
                    if mp3_bytes and len(mp3_bytes) > 200:
                        proc = await asyncio.create_subprocess_exec(
                            "ffmpeg", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "24000", "pipe:1",
                            stdin=asyncio.subprocess.PIPE,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.DEVNULL
                        )
                        pcm_bytes, _ = await proc.communicate(input=mp3_bytes)
                        if pcm_bytes:
                            return base64.b64encode(pcm_bytes).decode("ascii")
    except Exception as e:
        logger.warning(f"Local Neural TTS error: {e}")

    # 2. Fallback на Gemini Flash TTS
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key={GEMINI_API_KEY}"
        tts_prompt = f"Read the following text aloud with no modification: {clean_text}"
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
            async with http_client.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    candidates = data.get("candidates", [])
                    if candidates and "content" in candidates[0]:
                        parts = candidates[0]["content"].get("parts", [])
                        for p in parts:
                            if "inlineData" in p:
                                return p["inlineData"]["data"]
    except Exception as e:
        logger.error(f"Gemini TTS error: {e}")

    return None

async def convert_audio_to_wav(audio_bytes):
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-i", "pipe:0", "-f", "wav", "-ac", "1", "-ar", "16000", "pipe:1",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL
        )
        wav_bytes, _ = await proc.communicate(input=audio_bytes)
        return wav_bytes
    except Exception as e:
        logger.error(f"Error converting audio to wav: {e}")
        return None

async def transcribe_audio(wav_b64):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={GEMINI_API_KEY}"
    payload = {
        "contents": [{
            "role": "user",
            "parts": [
                {"inlineData": {"mimeType": "audio/wav", "data": wav_b64}},
                {"text": "Точно транскрибируй аудио на русском или украинском языке. Выведи только транскрипцию без лишних слов и кавычек."}
            ]
        }],
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": 200
        }
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=25)) as resp:
                data = await resp.json()
                candidates = data.get("candidates", [])
                if candidates and "content" in candidates[0]:
                    parts = candidates[0]["content"].get("parts", [])
                    if parts:
                        text = parts[0].get("text", "").strip()
                        # Очищаем от возможных артефактов
                        if text.lower().startswith("в аудио сказано:"):
                            text = text.split(":", 1)[1].strip()
                        return text.strip('"\'')
    except Exception as e:
        logger.error(f"Transcription error: {repr(e)}")
    return ""

async def process_utterance(user_text, session: SessionState, session_id: str, ws: web.WebSocketResponse):
    session.reset_interrupt()
    logger.info(f"[{session_id}] Processing user text: {user_text}")
    await ws.send_json({"type": "state", "state": "thinking"})

    try:
        res = await generate_gemini_reply(user_text, session)

        if session.is_interrupted:
            logger.info(f"[{session_id}] Interrupted during inference")
            return

        if res["type"] == "tool_call":
            tool_name = res["name"]
            tool_args = res["args"]
            logger.info(f"[{session_id}] Dispatching tool: {tool_name}")

            # Handle server-side agent delegation directly
            if tool_name == "delegate_to_agent":
                agent_res = await agent_bridge.execute_agent_command(
                    tool_args.get("agent", ""),
                    tool_args.get("instruction", "")
                )
                reply_text = await handle_tool_feedback(session, res["candidate"], tool_name, agent_res)
                logger.info(f"[{session_id}] Jarvis post-agent reply: {reply_text}")
                pcm_b64 = await generate_tts_audio(reply_text)
                if not session.is_interrupted:
                    await ws.send_json({
                        "type": "assistant_reply",
                        "text": reply_text,
                        "audio_pcm24k": pcm_b64
                    })
            else:
                # Client-side device tools (battery, sensors)
                await ws.send_json({
                    "type": "execute_tool",
                    "name": tool_name,
                    "args": tool_args,
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

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={GEMINI_API_KEY}"
    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "contents": session.history,
        "generationConfig": {"temperature": 0.35, "maxOutputTokens": 150}
    }

    async with aiohttp.ClientSession() as http_client:
        async with http_client.post(url, json=payload) as resp:
            data = await resp.json()
            candidates = data.get("candidates", [])
            text_reply = ""
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                for p in parts:
                    if "text" in p and not p.get("thought", False):
                        text_reply += p["text"] + " "
            text_reply = text_reply.strip() or "Готово."
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
                    await process_utterance(user_text, session, session_id, ws)

                elif evt == "user_audio":
                    raw_b64 = data.get("audio", "")
                    if not raw_b64:
                        continue

                    session.reset_interrupt()
                    logger.info(f"[{session_id}] Received user audio stream ({len(raw_b64)} chars), processing...")
                    await ws.send_json({"type": "state", "state": "thinking"})

                    try:
                        audio_bytes = base64.b64decode(raw_b64)
                        wav_bytes = await convert_audio_to_wav(audio_bytes)
                        if not wav_bytes:
                            logger.warning(f"[{session_id}] Audio conversion failed")
                            await ws.send_json({"type": "state", "state": "sleeping"})
                            continue

                        wav_b64 = base64.b64encode(wav_bytes).decode("ascii")
                        user_text = await transcribe_audio(wav_b64)
                        logger.info(f"[{session_id}] Audio transcribed: '{user_text}'")

                        if not user_text:
                            logger.info(f"[{session_id}] Inaudible audio or silence")
                            await ws.send_json({"type": "state", "state": "sleeping"})
                            continue

                        # Send recognized text back so client renders bubble
                        await ws.send_json({"type": "user_transcript", "text": user_text})

                        # Process utterance through agent / gemini / tts
                        await process_utterance(user_text, session, session_id, ws)
                    except Exception as e:
                        logger.error(f"[{session_id}] user_audio error: {e}")
                        await ws.send_json({"type": "state", "state": "sleeping"})

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
    base_dir = os.path.dirname(os.path.abspath(__file__))

    # WebSocket relay
    app.router.add_get("/ws", handle_ws)

    # Root → index.html
    async def serve_index(request):
        resp = web.FileResponse(os.path.join(base_dir, "index.html"))
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp

    app.router.add_get("/", serve_index)

    # Static files (JS, CSS, icons, manifest, sw.js …)
    app.router.add_static("/", path=base_dir, show_index=False)

    return app

if __name__ == "__main__":
    logger.info(f"Starting Jarvis Relay Gateway on http://{HOST}:{PORT}")
    app = init_app()
    web.run_app(app, host=HOST, port=PORT)
