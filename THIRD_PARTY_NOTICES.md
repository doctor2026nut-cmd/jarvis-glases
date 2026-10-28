# Third-Party Notices & Licenses

This project incorporates architectural patterns, clean algorithms, and reference designs from the following open-source projects. We gratefully acknowledge the original authors.

---

### 1. openclaw-assistant
- **Source:** https://github.com/yuga-hashimoto/openclaw-assistant
- **Author:** Yuga Hashimoto
- **License:** MIT License
- **Copyright:** (c) 2026 yuga-hashimoto
- **Adopted Components:**
  - Vosk offline hotword recognition architecture for Android foreground service (`HotwordService`).
  - Audio focus and microphone recovery patterns for continuous background listening.
- **Modifications:**
  - Removed VoiceVox and complex Japanese TTS bindings.
  - Stripped non-reproducible Firebase/Crashlytics dependencies and unstable open issues.
  - Adapted wake word grammar specifically for "джарвис" / "jarvis".

---

### 2. RokidAIAssistant
- **Source:** https://github.com/zero2005x/RokidAIAssistant
- **License:** Apache License 2.0
- **Copyright:** (c) 2025-2026 zero2005x
- **Adopted Components:**
  - Android Bluetooth audio routing (SCO / A2DP) and media button / tap broadcast receiver.
  - Foreground Service lifecycle management for companion glasses applications.
- **Modifications:**
  - Removed Rokid CXR proprietary SDK dependencies, display overlays, and camera streaming modules (since our target AI glasses operate purely as a Bluetooth audio/tap wearable).

---

### 3. VisionClaw
- **Source:** https://github.com/Intent-Lab/VisionClaw
- **Author:** Intent-Lab
- **License / Terms:** Wearables Device Access Toolkit / Developer Terms & Apache-compatible gateway patterns.
- **Adopted Components:**
  - WebSocket protocol and payload dispatching architecture for voice agent gateway.
  - Function Calling execution flow (model request -> client/gateway execution -> function response feedback).
  - Interruption / barge-in playback handling.
- **Modifications:**
  - Removed Meta Ray-Ban camera frame capture, visual token processing, and LiveKit WebRTC video dependencies.
  - Tailored specifically for pure audio streaming and the Jarvis I CLUB knowledge engine.
