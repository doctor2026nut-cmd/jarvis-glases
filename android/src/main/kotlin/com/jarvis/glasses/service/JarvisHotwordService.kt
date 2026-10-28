// SPDX-License-Identifier: MIT
// Adapted from openclaw-assistant (c) 2026 yuga-hashimoto
// Cleaned & tailored for Jarvis Glasses Assistant (offline wake word "Джарвис")

package com.jarvis.glasses.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import java.io.File
import java.io.IOException

class JarvisHotwordService : Service(), RecognitionListener {

    companion object {
        private const val TAG = "JarvisHotwordService"
        private const val NOTIFICATION_ID = 2026
        private const val CHANNEL_ID = "jarvis_hotword_channel"
        private const val SAMPLE_RATE = 16000.0f
        
        const val ACTION_WAKEUP_TRIGGERED = "com.jarvis.glasses.ACTION_WAKEUP_TRIGGERED"
        const val WAKE_PHRASE = "джарвис"

        fun start(context: Context) {
            val intent = Intent(context, JarvisHotwordService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, JarvisHotwordService::class.java)
            context.stopService(intent)
        }
    }

    private var speechService: SpeechService? = null
    private var voskModel: Model? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildForegroundNotification())
        initVoskModel()
    }

    private fun initVoskModel() {
        // Load offline Vosk model from internal storage or assets
        val modelPath = File(filesDir, "vosk-model-small-ru")
        if (modelPath.exists()) {
            try {
                voskModel = Model(modelPath.absolutePath)
                // Restrict recognition grammar to reduce CPU usage and eliminate false positives
                val grammar = "[\"$WAKE_PHRASE\", \"[unk]\"]"
                val rec = Recognizer(voskModel, SAMPLE_RATE, grammar)
                speechService = SpeechService(rec, SAMPLE_RATE)
                speechService?.startListening(this)
                Log.i(TAG, "Jarvis wake word detector started with phrase: $WAKE_PHRASE")
            } catch (e: IOException) {
                Log.e(TAG, "Failed to initialize Vosk: ${e.message}", e)
            }
        } else {
            Log.w(TAG, "Model directory not found at ${modelPath.absolutePath}. Waiting for asset unpack.")
        }
    }

    override fun onPartialResult(hypothesis: String?) {
        hypothesis?.let { checkWakePhrase(it) }
    }

    override fun onResult(hypothesis: String?) {
        hypothesis?.let { checkWakePhrase(it) }
    }

    override fun onFinalResult(hypothesis: String?) {}

    override fun onError(e: Exception?) {
        Log.e(TAG, "Vosk recognition error: ${e?.message}")
        // Auto-recover listener after transient error
        try {
            speechService?.stop()
            speechService?.startListening(this)
        } catch (recoverErr: Exception) {
            Log.e(TAG, "Recovery failed", recoverErr)
        }
    }

    override fun onTimeout() {}

    private fun checkWakePhrase(jsonStr: String) {
        try {
            val json = JSONObject(jsonStr)
            val text = json.optString("partial", json.optString("text", "")).lowercase()
            if (text.contains(WAKE_PHRASE) || text.contains("jarvis")) {
                Log.i(TAG, ">>> Wake word detected: $text! Triggering assistant session.")
                broadcastWakeup()
            }
        } catch (_: Exception) {}
    }

    private fun broadcastWakeup() {
        val intent = Intent(ACTION_WAKEUP_TRIGGERED)
        sendBroadcast(intent)
    }

    private fun buildForegroundNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Jarvis Assistant")
            .setContentText("Слушаю активацию «Джарвис» через очки...")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Jarvis Wake Word Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        speechService?.stop()
        speechService?.shutdown()
        voskModel?.close()
        super.onDestroy()
    }
}
