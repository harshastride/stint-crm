package academy.stint.notes

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject
import java.io.File
import java.time.Instant

/**
 * Records a conversation on the phone's mic. Runs as a foreground service with a notification,
 * so it keeps recording with the screen off or the app in the background.
 * On stop, the file is handed to UploadWorker, which sends it to the CRM.
 */
class RecorderService : Service() {

    data class Live(val startedElapsed: Long, val number: String?)

    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt: Instant? = null
    private val meter = android.os.Handler(android.os.Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start(intent.getStringExtra(EXTRA_NUMBER))
            ACTION_STOP -> stop()
        }
        return START_NOT_STICKY
    }

    private fun start(number: String?) {
        if (recorder != null) return
        ServiceCompat.startForeground(
            this, NOTE_ID, notification(),
            if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0,
        )
        val out = File(pendingDir(this), "note-${System.currentTimeMillis()}.m4a")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()
        try {
            r.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1)
            r.setAudioSamplingRate(16000)
            r.setAudioEncodingBitRate(48000) // about 21 MB per hour
            r.setOutputFile(out.absolutePath)
            r.prepare()
            r.start()
        } catch (e: Exception) {
            r.release(); out.delete()
            problem.value = "Couldn't start the mic: ${e.message}"
            stopSelf(); return
        }
        recorder = r; file = out; startedAt = Instant.now()
        meter.post(object : Runnable {
            override fun run() {
                val rec = recorder ?: run { level.value = 0f; return }
                // 0..1, on a curve so normal speech moves the bars visibly
                level.value = (runCatching { rec.maxAmplitude }.getOrDefault(0) / 32767f).coerceIn(0f, 1f).let { Math.sqrt(it.toDouble()).toFloat() }
                meter.postDelayed(this, 90)
            }
        })
        live.value = Live(SystemClock.elapsedRealtime(), number)
    }

    private fun stop() {
        val r = recorder
        val f = file
        val began = startedAt
        val number = live.value?.number
        val elapsed = live.value?.let { (SystemClock.elapsedRealtime() - it.startedElapsed) / 1000 } ?: 0
        recorder = null; file = null; startedAt = null
        live.value = null
        if (r != null && f != null && began != null) {
            val ok = runCatching { r.stop() }.isSuccess // fails if stopped within a second
            r.release()
            if (ok && elapsed >= 2) {
                UploadWorker.metaFile(f).writeText(
                    JSONObject().put("started", began.toString()).put("seconds", elapsed).put("number", number ?: "").toString(),
                )
                UploadWorker.enqueue(this, f)
            } else { f.delete(); problem.value = "Too short to save." }
        }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        if (recorder != null) stop()
        super.onDestroy()
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Recording", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, RecorderService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_mic)
            .setContentTitle("Recording a note")
            .setContentText("Tap Stop when the conversation ends.")
            .setOngoing(true)
            .setUsesChronometer(true)
            .setContentIntent(open)
            .addAction(0, "Stop", stop)
            .build()
    }

    companion object {
        const val ACTION_START = "start"
        const val ACTION_STOP = "stop"
        const val EXTRA_NUMBER = "number"
        private const val CHANNEL = "recording"
        private const val NOTE_ID = 7

        private val live = MutableStateFlow<Live?>(null)
        val state: StateFlow<Live?> = live
        /** Mic loudness 0..1 while recording, for the live waveform. */
        val level = MutableStateFlow(0f)
        /** Last problem to show on screen (mic busy, too short). */
        val problem = MutableStateFlow<String?>(null)

        fun pendingDir(ctx: Context) = File(ctx.filesDir, "pending").apply { mkdirs() }

        fun start(ctx: Context, number: String?) = ctx.startForegroundService(
            Intent(ctx, RecorderService::class.java).setAction(ACTION_START).putExtra(EXTRA_NUMBER, number),
        )

        fun stop(ctx: Context) = ctx.startService(Intent(ctx, RecorderService::class.java).setAction(ACTION_STOP))
    }
}
