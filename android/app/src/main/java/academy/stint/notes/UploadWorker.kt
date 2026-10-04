package academy.stint.notes

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Sends one recording to the CRM. Waits for internet, retries with growing gaps,
 * and deletes the phone's copy only after the CRM confirms it saved the audio.
 */
class UploadWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val file = File(inputData.getString(KEY_FILE) ?: return@withContext Result.failure())
        if (!file.exists()) return@withContext Result.success()
        val meta = runCatching { JSONObject(metaFile(file).readText()) }.getOrElse { JSONObject() }
        try {
            Api(applicationContext).upload(file, meta.optString("started").ifBlank { java.time.Instant.ofEpochMilli(file.lastModified()).toString() },
                meta.optLong("seconds", 0), meta.optString("number").ifBlank { null })
            file.delete(); metaFile(file).delete()
            Result.success()
        } catch (e: ApiError) {
            // 401: signed out — keep the file; it goes up after the next sign-in. 400/413: the CRM refused it.
            when (e.code) {
                400, 413 -> { errorFile(file).writeText(e.message ?: "Refused"); Result.failure() }
                else -> Result.retry()
            }
        } catch (e: IOException) {
            Result.retry()
        }
    }

    companion object {
        private const val KEY_FILE = "file"
        const val TAG = "upload"

        /** Start time, length and optional number saved next to each recording. */
        fun metaFile(audio: File) = File(audio.path + ".json")
        fun errorFile(audio: File) = File(audio.path + ".error")

        fun enqueue(ctx: Context, file: File) {
            val req = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(workDataOf(KEY_FILE to file.absolutePath))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(TAG)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(file.name, ExistingWorkPolicy.KEEP, req)
        }

        /** After signing in again: re-send anything still waiting on the phone. */
        fun resendWaiting(ctx: Context) {
            waiting(ctx).filter { !errorFile(it).exists() }.forEach { enqueue(ctx, it) }
        }

        /** Finished recordings still on the phone (not yet confirmed by the CRM). */
        fun waiting(ctx: Context): List<File> =
            RecorderService.pendingDir(ctx).listFiles { f -> f.name.endsWith(".m4a") && metaFile(f).exists() }?.sortedByDescending { it.name }.orEmpty()
    }
}
