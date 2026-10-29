"""
Utility script to send messages, APK files, and project bundles to Roman via Telegram.
"""

import os
import sys
import json
import urllib.request
import urllib.error

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
TOKEN = "9199913363:AAEQFv4LO0ymvQfVLZd88izma0XFBI_uPfY"

def get_chat_id():
    # 1. Check env
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if chat_id:
        return chat_id
    
    # 2. Check getUpdates
    try:
        url = f"https://api.telegram.org/bot{TOKEN}/getUpdates"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read().decode())
            results = data.get("result", [])
            if results:
                # Get last chat_id
                for item in reversed(results):
                    msg = item.get("message") or item.get("channel_post")
                    if msg and "chat" in msg:
                        cid = str(msg["chat"]["id"])
                        print(f"[telegram] Found active chat_id from update: {cid}")
                        return cid
    except Exception as e:
        print(f"[telegram] Error checking updates: {e}")
    return None

def send_message(text, chat_id=None):
    cid = chat_id or get_chat_id()
    if not cid:
        print("[telegram] No chat_id found. Please write /start to @smartglassne_bot")
        return False
    
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    payload = json.dumps({"chat_id": cid, "text": text, "parse_mode": "HTML"}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            print(f"[telegram] Message sent: {data.get('ok')}")
            return True
    except Exception as e:
        print(f"[telegram] Send message error: {e}")
        return False

def send_document(file_path, caption="", chat_id=None):
    cid = chat_id or get_chat_id()
    if not cid:
        print("[telegram] No chat_id found. Please write /start to @smartglassne_bot")
        return False
    
    if not os.path.exists(file_path):
        print(f"[telegram] File not found: {file_path}")
        return False
    
    filename = os.path.basename(file_path)
    file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
    print(f"[telegram] Sending {filename} ({file_size_mb:.2f} MB) to {cid}...")

    boundary = "----JarvisTelegramBoundary2026"
    body = []

    body.append(f"--{boundary}".encode())
    body.append(f'Content-Disposition: form-data; name="chat_id"'.encode())
    body.append(b"")
    body.append(str(cid).encode())

    body.append(f"--{boundary}".encode())
    body.append(f'Content-Disposition: form-data; name="caption"'.encode())
    body.append(b"")
    body.append(caption.encode("utf-8"))

    body.append(f"--{boundary}".encode())
    body.append(f'Content-Disposition: form-data; name="document"; filename="{filename}"'.encode())
    body.append(b"Content-Type: application/octet-stream")
    body.append(b"")
    with open(file_path, "rb") as f:
        body.append(f.read())

    body.append(f"--{boundary}--".encode())
    body.append(b"")

    data = b"\r\n".join(body)
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{TOKEN}/sendDocument",
        data=data,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
            print(f"[telegram] Document sent successfully: {data.get('ok')}")
            return True
    except Exception as e:
        print(f"[telegram] Send document error: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) > 1:
        fpath = sys.argv[1]
        cap = sys.argv[2] if len(sys.argv) > 2 else "Файл от Джарвиса"
        send_document(fpath, cap)
    else:
        cid = get_chat_id()
        if cid:
            send_message("🤖 Джарвис на связи! Бот активирован и готов отправлять APK и обновления.")
