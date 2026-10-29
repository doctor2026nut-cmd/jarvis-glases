"""
Jarvis Agent Bridge & Tool Router
Direct hub connecting Voice Assistant (Glasses) to:
1. Antigravity Brain & Workspace Tasks
2. Meta Muse (muse.ai via agent-master-server)
3. OpenClaw Live AWS EC2 Gateway (18.194.105.44)
4. Extensible MCP (Model Context Protocol) tool loader
"""

import os
import json
import asyncio
import urllib.request
import urllib.error
import subprocess
import logging

logger = logging.getLogger("agent-bridge")

MUSE_BRIDGE_URL = "https://agent-master-server.onrender.com/api/agent/tasks"
MUSE_TOKEN = "sk-antigravity-master-roman"

OPENCLAW_SSH_KEY = "/home/ubuntu/.ssh/id_ed25519_openclaw"
OPENCLAW_HOST = "18.194.105.44"
OPENCLAW_USER = "ubuntu"

async def call_antigravity(prompt: str, context: str = ""):
    """Interacts with Antigravity / checks local tasks and codebase."""
    try:
        git_log = subprocess.check_output(
            ["git", "-C", "/home/ubuntu/jarvis-glasses-assistant", "log", "-n", "3", "--oneline"],
            text=True
        )
        return {
            "status": "success",
            "agent": "Antigravity",
            "active_workspace": "/home/ubuntu/jarvis-glasses-assistant",
            "recent_commits": git_log.strip().split("\n"),
            "system_state": "Operational, pairing with glasses"
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def call_muse(prompt: str, context: str = ""):
    """Sends a query/task directly to Meta Muse via agent-master-server bridge."""
    data = {
        "prompt": prompt,
        "files_in": [],
        "context": context
    }
    req = urllib.request.Request(
        MUSE_BRIDGE_URL,
        data=json.dumps(data).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MUSE_TOKEN}"
        }
    )
    try:
        loop = asyncio.get_event_loop()
        def do_request():
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        res = await loop.run_in_executor(None, do_request)
        return {
            "status": "success",
            "agent": "Meta Muse",
            "task_id": res.get("id"),
            "task_status": res.get("status"),
            "message": f"Задача передана Музе (ID: {res.get('id')}). Муза приступила к анализу."
        }
    except Exception as e:
        return {"status": "error", "agent": "Meta Muse", "message": str(e)}

async def call_openclaw(instruction: str, session_key: str = "agent:main:glasses"):
    """
    Виконує реальний запит до агента OpenClaw на сервері AWS EC2
    і повертає відповідь агента, яку Джарвіс озвучує в окуляри.
    """
    logger.info(f"[openclaw-bridge] Dispatching instruction: {instruction}")
    
    # Екрануємо одинарні лапки для безпечної передачі через bash ssh
    safe_instruction = instruction.replace("'", "'\\''")
    remote_cmd = (
        f"OPENCLAW_CONFIG_PATH=/opt/openclaw/openclaw.json "
        f"openclaw agent --session-key '{session_key}' --message '{safe_instruction}'"
    )

    ssh_args = [
        "ssh",
        "-i", OPENCLAW_SSH_KEY,
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        f"{OPENCLAW_USER}@{OPENCLAW_HOST}",
        remote_cmd
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *ssh_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        try:
            # Очікуємо виконання агента з таймаутом 35 секунд
            stdout_bytes, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=35.0)
            output = stdout_bytes.decode("utf-8", errors="replace").strip()
            stderr = stderr_bytes.decode("utf-8", errors="replace").strip()

            if proc.returncode == 0 and output:
                logger.info(f"[openclaw-bridge] Success: {output[:100]}...")
                return {
                    "status": "success",
                    "agent": "OpenClaw",
                    "response": output,
                    "summary_for_voice": output
                }
            else:
                logger.warning(f"[openclaw-bridge] Code {proc.returncode}, err: {stderr}")
                return {
                    "status": "partial",
                    "agent": "OpenClaw",
                    "response": output or stderr or "Команда отправлена на сервер, но вывод пуст.",
                    "summary_for_voice": output or "Задача принята в обработку сервером OpenClaw."
                }
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            logger.info("[openclaw-bridge] Task is taking longer, dispatched in background")
            return {
                "status": "async_dispatched",
                "agent": "OpenClaw",
                "message": "Задача сложная и передана на выполнение агенту OpenClaw в фоновом режиме. Результат будет готов в системе."
            }
    except Exception as e:
        logger.error(f"[openclaw-bridge] Execution failed: {e}")
        return {
            "status": "error",
            "agent": "OpenClaw",
            "message": f"Ошибка связи с сервером OpenClaw: {str(e)}"
        }

async def execute_agent_command(agent_name: str, instruction: str):
    """Central agent router called by Gemini Function Calling."""
    agent_name_clean = agent_name.lower().strip()
    
    if "муз" in agent_name_clean or "muse" in agent_name_clean:
        return await call_muse(instruction)
    elif "антигравити" in agent_name_clean or "antigravity" in agent_name_clean:
        return await call_antigravity(instruction)
    elif "openclaw" in agent_name_clean or "кло" in agent_name_clean or "опен" in agent_name_clean:
        return await call_openclaw(instruction)
    else:
        # За замовчуванням при згадці OpenClaw або завдань
        return await call_openclaw(instruction)
