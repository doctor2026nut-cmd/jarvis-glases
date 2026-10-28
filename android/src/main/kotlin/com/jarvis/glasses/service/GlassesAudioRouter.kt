// SPDX-License-Identifier: Apache-2.0
// Adapted from RokidAIAssistant (c) 2025-2026 zero2005x
// Pure Bluetooth headset & glasses audio routing (SCO & Media Button tap receiver)

package com.jarvis.glasses.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.util.Log
import android.view.KeyEvent

class GlassesAudioRouter(
    private val context: Context,
    private val onGlassesTap: () -> Unit
) {
    companion object {
        private const val TAG = "GlassesAudioRouter"
    }

    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var isScoConnected = false

    private val mediaButtonReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            if (Intent.ACTION_MEDIA_BUTTON == intent?.action) {
                val keyEvent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
                }

                if (keyEvent?.action == KeyEvent.ACTION_DOWN) {
                    when (keyEvent.keyCode) {
                        KeyEvent.KEYCODE_HEADSETHOOK,
                        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
                        KeyEvent.KEYCODE_MEDIA_PLAY -> {
                            Log.i(TAG, "Hardware tap detected on glasses/headset frame!")
                            onGlassesTap()
                        }
                    }
                }
            }
        }
    }

    fun start() {
        // Register hardware tap listener
        val filter = IntentFilter(Intent.ACTION_MEDIA_BUTTON)
        context.registerReceiver(mediaButtonReceiver, filter)
        routeAudioToBluetoothGlasses()
    }

    fun routeAudioToBluetoothGlasses() {
        try {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            if (audioManager.isBluetoothScoAvailableOffCall) {
                audioManager.startBluetoothSco()
                audioManager.isBluetoothScoOn = true
                isScoConnected = true
                Log.i(TAG, "Bluetooth SCO audio routed to AI glasses")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start Bluetooth SCO: ${e.message}")
        }
    }

    fun stop() {
        try {
            context.unregisterReceiver(mediaButtonReceiver)
        } catch (_: Exception) {}

        if (isScoConnected) {
            audioManager.stopBluetoothSco()
            audioManager.isBluetoothScoOn = false
            audioManager.mode = AudioManager.MODE_NORMAL
        }
    }
}
