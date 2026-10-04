package academy.stint.notes

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Login details kept in the app's private storage. */
class Store(ctx: Context) {
    private val p = ctx.getSharedPreferences("stint", Context.MODE_PRIVATE)
    var server: String
        get() = p.getString("server", null) ?: BuildConfig.DEFAULT_SERVER
        set(v) = p.edit().putString("server", v.trim().trimEnd('/')).apply()
    var access: String? get() = p.getString("access", null); set(v) = p.edit().putString("access", v).apply()
    var refresh: String? get() = p.getString("refresh", null); set(v) = p.edit().putString("refresh", v).apply()
    var expiresAt: Long get() = p.getLong("expires", 0); set(v) = p.edit().putLong("expires", v).apply()
    var name: String? get() = p.getString("name", null); set(v) = p.edit().putString("name", v).apply()
    var email: String? get() = p.getString("email", null); set(v) = p.edit().putString("email", v).apply()
    val signedIn get() = refresh != null

    fun signOut() = p.edit().remove("access").remove("refresh").remove("expires").remove("name").remove("email").apply()
}

class ApiError(val code: Int, message: String) : IOException(message)

/** Talks to the CRM (mobile sign-in, notes list) and /api/recordings/upload. Run on a background thread. */
class Api(ctx: Context) {
    val store = Store(ctx)
    private val json = "application/json".toMediaType()

    private fun call(req: Request): JSONObject {
        http.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            val obj = runCatching { JSONObject(body) }.getOrElse { JSONObject() }
            if (!res.isSuccessful) throw ApiError(res.code, obj.optString("error").ifBlank { "The CRM answered ${res.code}." })
            return obj
        }
    }

    private fun url(path: String): String {
        val s = store.server
        if (!s.startsWith("http")) throw ApiError(0, "Set the CRM address first.")
        return s + path
    }

    private fun saveSession(o: JSONObject) {
        store.access = o.getString("access_token")
        store.refresh = o.getString("refresh_token")
        store.expiresAt = o.optLong("expires_at", 0)
    }

    fun login(server: String, email: String, password: String) {
        store.server = server
        val body = JSONObject().put("email", email).put("password", password).toString().toRequestBody(json)
        val o = call(Request.Builder().url(url("/api/mobile/login")).post(body).build())
        saveSession(o)
        store.name = o.optString("name")
        store.email = o.optString("email")
    }

    /** A login token that is valid for at least another minute; refreshes it when needed. */
    @Synchronized
    fun token(force: Boolean = false): String {
        val refresh = store.refresh ?: throw ApiError(401, "Sign in again.")
        val now = System.currentTimeMillis() / 1000
        if (!force && store.access != null && store.expiresAt - now > 60) return store.access!!
        val body = JSONObject().put("refresh_token", refresh).toString().toRequestBody(json)
        saveSession(call(Request.Builder().url(url("/api/mobile/refresh")).post(body).build()))
        return store.access!!
    }

    /** Calls with the login token; on 401 refreshes once and tries again. */
    private fun authed(build: (Request.Builder) -> Request.Builder): JSONObject {
        fun go(t: String) = call(build(Request.Builder()).header("Authorization", "Bearer $t").build())
        return try { go(token()) } catch (e: ApiError) { if (e.code == 401) go(token(force = true)) else throw e }
    }

    fun notes(): JSONObject = authed { it.url(url("/api/mobile/notes")) }
    fun note(id: String): JSONObject = authed { it.url(url("/api/mobile/notes?id=$id")) }

    fun upload(file: File, startedAt: String, durationSec: Long, number: String?): JSONObject = authed {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("audio", file.name, file.asRequestBody("audio/mp4".toMediaType()))
            .addFormDataPart("called_at", startedAt)
            .addFormDataPart("duration_sec", durationSec.toString())
            .addFormDataPart("direction", "talk")
            .addFormDataPart("consent", "yes")
        if (!number.isNullOrBlank()) form.addFormDataPart("number", number)
        it.url(url("/api/recordings/upload")).post(form.build() as RequestBody)
    }

    companion object {
        // Uploads wait while the CRM transcribes and summarises (up to 5 minutes).
        val http: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(5, TimeUnit.MINUTES)
            .readTimeout(6, TimeUnit.MINUTES)
            .build()
    }
}
