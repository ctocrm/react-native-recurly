package com.ctocrm.jsmastery.imap

import android.util.Log
import at.favre.lib.crypto.bcrypt.BCrypt
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import org.json.JSONArray
import org.json.JSONObject

import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/**
 * Tuta client REST. Not IMAP.
 * Login: SaltService GET (ID-mapped JSON) then SessionService POST.
 * KDF is bcrypt (kdfVersion 0) or Argon2id (kdfVersion 1).
 */
class TutaModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val io = Executors.newSingleThreadExecutor()

  override fun getName(): String = "MailTuta"

  @ReactMethod
  fun fetchMessages(
    username: String,
    password: String,
    totp: String?,
    sinceIso: String?,
    limit: Int,
    promise: Promise,
  ) {
    io.execute {
      try {
        val client = TutaClient()
        val session = client.login(username.trim(), password)
        val messages = client.listMail(session, sinceIso, limit.coerceIn(1, 100))
        val arr = Arguments.createArray()
        for (m in messages) {
          val map = Arguments.createMap()
          map.putString("messageId", m.id)
          map.putString("from", m.from)
          map.putString("subject", m.subject)
          map.putString("date", m.date)
          if (m.text != null) map.putString("text", m.text)
          arr.pushMap(map)
        }
        val out = Arguments.createMap()
        out.putArray("messages", arr)
        promise.resolve(out)
      } catch (e: Exception) {
        Log.e(TAG, "Tuta fetch failed", e)
        promise.reject("TUTA_ERROR", e.message ?: "Tuta failed", e)
      }
    }
  }

  companion object {
    const val TAG = "MailTuta"
  }
}

private data class TutaSession(val accessToken: String, val userId: String)
private data class TutaMsg(
  val id: String,
  val from: String,
  val subject: String,
  val date: String,
  val text: String?,
)

private class TutaClient {
  private val base = "https://app.tuta.com"
  // Live web client as of 2026-08-21. v is the sys model version, not the app version.
  private val modelVersion = "154"
  private val clientVersion = "357.260818.1"

  fun login(mailAddress: String, password: String): TutaSession {
    val address = mailAddress.lowercase().trim()
    val saltBody = JSONObject()
      .put("418", "0")
      .put("419", address)
      .toString()
    val saltRes = request(
      "GET",
      "$base/rest/sys/saltservice?_body=${java.net.URLEncoder.encode(saltBody, "UTF-8")}",
      null,
      null,
    )
    val kdfVersion = saltRes.optString("2133", saltRes.optString("kdfVersion", "1"))
    val saltB64 = saltRes.optString("422", saltRes.optString("salt"))
    if (saltB64.isEmpty()) {
      throw IllegalStateException("Tuta SaltService returned no salt")
    }
    val salt = b64(saltB64)
    val passphraseKey = derivePassphraseKey(password, salt, kdfVersion)
    val verifier = createAuthVerifierAsBase64Url(passphraseKey)
    // Live SessionService accepts this ID-mapped shape (401 on bad verifier,
    // 400 if 1218/null optionals are omitted).
    val sessionBody = JSONObject()
      .put("1212", "0")
      .put("1213", address)
      .put("1214", verifier)
      .put("1215", "Linux Firefox")
      .put("1216", JSONObject.NULL)
      .put("1217", JSONObject.NULL)
      .put("1417", JSONObject.NULL)
      .put("1218", JSONArray())
      .toString()

    val session = request("POST", "$base/rest/sys/sessionservice", sessionBody, null)
    val token = session.optString("1221", session.optString("accessToken"))
    val user = session.optString("1223", session.optString("user"))
    if (token.isEmpty()) {
      throw IllegalStateException("Tuta SessionService returned no accessToken")
    }
    Log.i("MailTuta", "Tuta session created for $address user=$user")
    return TutaSession(token, user)

  }

  fun listMail(session: TutaSession, sinceIso: String?, limit: Int): List<TutaMsg> {
    // Bodies are client-encrypted. Metadata listing is a later pass once login is proven.
    return emptyList()
  }

  /**
   * Tuta KDF:
   *  - "0" bcrypt: SHA-256(password) then bcrypt cost 8, first 16 bytes
   *  - "1" Argon2id: t=4, m=32768 KiB, p=1, 32-byte key (OWASP / tutao defaults)
   */
  private fun derivePassphraseKey(password: String, salt: ByteArray, kdfVersion: String): ByteArray {
    return when (kdfVersion) {
      "0" -> {
        val prehashed = sha256(password.toByteArray(StandardCharsets.UTF_8))
        val hashed = BCrypt.withDefaults().hashRaw(8, salt, prehashed).rawHash
        hashed.copyOfRange(0, 16)
      }
      "1" -> {
        val params = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
          .withSalt(salt)
          .withIterations(4)
          .withMemoryAsKB(32 * 1024)
          .withParallelism(1)
          .withVersion(Argon2Parameters.ARGON2_VERSION_13)
          .build()
        val gen = Argon2BytesGenerator()
        gen.init(params)
        val out = ByteArray(32)
        gen.generateBytes(password.toByteArray(StandardCharsets.UTF_8), out)
        out
      }
      else -> throw IllegalStateException("Tuta unknown kdfVersion $kdfVersion")
    }
  }

  /** SHA-256 of the passphrase key, then base64url (tutao createAuthVerifierAsBase64Url). */
  private fun createAuthVerifierAsBase64Url(passphraseKey: ByteArray): String {
    val digest = sha256(passphraseKey)
    val std = android.util.Base64.encodeToString(
      digest,
      android.util.Base64.NO_WRAP,
    )
    return std.replace('+', '-').replace('/', '_').replace("=", "")
  }

  private fun sha256(data: ByteArray): ByteArray =
    MessageDigest.getInstance("SHA-256").digest(data)

  private fun request(
    method: String,
    url: String,
    body: String?,
    session: TutaSession?,
  ): JSONObject {
    val conn = (URL(url).openConnection() as HttpsURLConnection)
    conn.requestMethod = method
    conn.connectTimeout = 20_000
    conn.readTimeout = 25_000
    conn.setRequestProperty("Accept", "application/json")
    conn.setRequestProperty("v", modelVersion)
    conn.setRequestProperty("cv", clientVersion)
    conn.setRequestProperty("cp", "web")

    if (body != null && method != "GET") {
      conn.setRequestProperty("Content-Type", "application/json")
    }
    if (session != null) {
      conn.setRequestProperty("accessToken", session.accessToken)
    }
    if (body != null && method != "GET") {
      conn.doOutput = true
      OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { it.write(body) }
    }
    val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
    val text = if (stream == null) {
      ""
    } else {
      BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).use { it.readText() }
    }
    if (conn.responseCode !in 200..299) {
      val extra = if (text.isBlank()) {
        "(empty body, error-id ${conn.getHeaderField("error-id")})"
      } else {
        text
      }
      Log.w("MailTuta", "HTTP ${conn.responseCode}: $extra")
      if (conn.responseCode == 474) {
        throw IllegalStateException(
          "Tuta rejected this client version (HTTP 474). Not a password error. $extra",
        )
      }
      if (conn.responseCode == 401 || conn.responseCode == 403) {
        throw IllegalStateException(
          "Tuta rejected the password (HTTP ${conn.responseCode}). $extra",
        )
      }
      throw IllegalStateException("Tuta HTTP ${conn.responseCode}: $extra")
    }
    return if (text.isBlank()) JSONObject() else JSONObject(text)
  }

  private fun b64(s: String): ByteArray {
    val trimmed = s.trim()
    val flags =
      android.util.Base64.URL_SAFE or
        android.util.Base64.NO_WRAP or
        android.util.Base64.NO_PADDING
    return try {
      android.util.Base64.decode(trimmed, android.util.Base64.DEFAULT)
    } catch (_: IllegalArgumentException) {
      android.util.Base64.decode(trimmed, flags)
    }
  }
}
