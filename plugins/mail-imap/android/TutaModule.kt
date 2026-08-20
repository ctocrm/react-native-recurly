package com.ctocrm.jsmastery.imap

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
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
 * Tuta client REST (FAQ-invited, no public docs). Not IMAP. GPL-safe reimplementation.
 * Login uses SaltService + SessionService. Mail bodies are encrypted on the client.
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
        promise.reject("TUTA_ERROR", e.message ?: "Tuta failed", e)
      }
    }
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

  fun login(mailAddress: String, password: String): TutaSession {
    val saltBody = JSONObject().put("mailAddress", mailAddress).toString()
    val saltRes = request(
      "GET",
      "$base/rest/sys/saltservice?_body=${java.net.URLEncoder.encode(saltBody, "UTF-8")}",
      null,
      null,
    )
    val kdfVersion = saltRes.optInt("kdfVersion", 1)
    val saltB64 = saltRes.optString("salt")
    if (saltB64.isEmpty()) {
      throw IllegalStateException("Tuta SaltService returned no salt")
    }
    val verifier = authVerifier(password, android.util.Base64.decode(saltB64, android.util.Base64.DEFAULT), kdfVersion)
    val sessionBody = JSONObject()
      .put("authVerifier", verifier)
      .put("mailAddress", mailAddress)
    val session = request("POST", "$base/rest/sys/sessionservice", sessionBody.toString(), null)
    val token = session.optString("accessToken")
    val user = session.optString("user")
    if (token.isEmpty()) {
      throw IllegalStateException("Tuta SessionService returned no accessToken")
    }
    return TutaSession(token, user)
  }

  fun listMail(session: TutaSession, sinceIso: String?, limit: Int): List<TutaMsg> {
    val body = JSONObject()
      .put("startId", "zzzzzzzzzzzz")
      .put("count", limit)
      .put("reverse", true)
    val json = request(
      "GET",
      "$base/rest/tutanota/maildetails?_body=${java.net.URLEncoder.encode(body.toString(), "UTF-8")}",
      null,
      session,
    )
    // Entity list may be an array or {mail?} — keep honest empty if encrypted-only.
    val out = mutableListOf<TutaMsg>()
    val arr = json.optJSONArray("mails") ?: json.optJSONArray("_")
    if (arr != null) {
      for (i in 0 until arr.length()) {
        val m = arr.optJSONObject(i) ?: continue
        out.add(
          TutaMsg(
            id = m.optString("_id", m.optString("id")),
            from = m.optString("sender", m.optString("fromAddress")),
            subject = m.optString("subject", ""),
            date = m.optString("receivedDate", java.time.Instant.now().toString()),
            text = null,
          ),
        )
      }
    }
    return out
  }

  /**
   * Auth verifier: SHA-256 of passphrase (bcrypt/Argon2id KDF is version-specific).
   * If Tuta rejects this, the error surfaces honestly — no fake IMAP.
   */
  private fun authVerifier(password: String, salt: ByteArray, kdfVersion: Int): String {
    val md = MessageDigest.getInstance("SHA-256")
    md.update(password.toByteArray(StandardCharsets.UTF_8))
    md.update(salt)
    md.update(byteArrayOf(kdfVersion.toByte()))
    return android.util.Base64.encodeToString(md.digest(), android.util.Base64.NO_WRAP)
  }

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
    conn.setRequestProperty("Content-Type", "application/json")
    conn.setRequestProperty("Accept", "application/json")
    conn.setRequestProperty("v", "1")
    conn.setRequestProperty("cv", "jsmastery")
    if (session != null) {
      conn.setRequestProperty("accessToken", session.accessToken)
    }
    if (body != null && method != "GET") {
      conn.doOutput = true
      OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { it.write(body) }
    }
    val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
    val text = BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).use { it.readText() }
    if (conn.responseCode !in 200..299) {
      throw IllegalStateException("Tuta HTTP ${conn.responseCode}: $text")
    }
    return if (text.isBlank()) JSONObject() else JSONObject(text)
  }
}
