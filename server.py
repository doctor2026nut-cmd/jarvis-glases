"""
Jarvis Glasses Assistant — Development Server & Relay Prototype (T02 skeleton)
Provides static hosting for mobile web client + WebSocket relay stub for Gemini Live.
"""

import os
import json
import asyncio
from aiohttp import web

HOST = os.getenv("APP_HOST", "0.0.0.0")
PORT = int(os.getenv("APP_PORT", 3000))

async def handle_ws(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    print("[server-ws] Client connected from AI Glasses web prototype")

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                data = json.loads(msg.data)
                action = data.get("action")

                if action == "ping":
                    await ws.send_json({"type": "pong", "time": asyncio.get_event_loop().time()})
                elif action == "tool_result":
                    print(f"[server-ws] Received tool execution result: {data}")
                else:
                    await ws.send_json({"type": "status", "message": f"Action {action} acknowledged"})

            elif msg.type == web.WSMsgType.BINARY:
                # Raw PCM audio frames from microphone
                pass

            elif msg.type == web.WSMsgType.ERROR:
                print(f"[server-ws] Error: {ws.exception()}")
    finally:
        print("[server-ws] Client disconnected")

    return ws

def init_app():
    app = web.Application()
    app.router.add_get("/ws", handle_ws)
    # Serve static assets
    base_dir = os.path.dirname(os.path.abspath(__file__))
    app.router.add_static("/", path=base_dir, show_index=True)
    return app

if __name__ == "__main__":
    print(f"[jarvis-server] Starting on http://{HOST}:{PORT}")
    app = init_app()
    web.run_app(app, host=HOST, port=PORT)
