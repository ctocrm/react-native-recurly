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
import java.math.BigInteger
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/**
 * Proton Mail client REST (same API Proton Android uses).
 * Not IMAP. Not Bridge. Auth is SRP; bodies need OpenPGP on device.
 */
class ProtonModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val io = Executors.newSingleThreadExecutor()

  override fun getName(): String = "MailProton"

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
        val client = ProtonClient()
        val session = client.login(username.trim(), password, totp)
        val messages = client.listMessages(session, sinceIso, limit.coerceIn(1, 100))
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
        promise.reject("PROTON_ERROR", e.message ?: "Proton failed", e)
      }
    }
  }
}

private data class ProtonSession(val uid: String, val accessToken: String)
private data class ProtonMsg(
  val id: String,
  val from: String,
  val subject: String,
  val date: String,
  val text: String?,
)

private class ProtonClient {
  private val api = "https://mail.proton.me/api"

  fun login(username: String, password: String, totp: String?): ProtonSession {
    val info = postJson(
      "$api/auth/v4/info",
      JSONObject().put("Username", username).toString(),
      null,
    )
    val version = info.optInt("Version", 4)
    val saltB64 = info.optString("Salt")
    val modulus = info.optString("Modulus")
    val serverEphemeral = info.optString("ServerEphemeral")
    val srpSession = info.optString("SRPSession")
    if (modulus.isEmpty() || serverEphemeral.isEmpty()) {
      throw IllegalStateException("Proton auth/info missing SRP fields")
    }
    val srp = ProtonSrp.prove(
      password,
      saltB64,
      stripModulus(modulus),
      serverEphemeral,
      version,
    )
    val authBody = JSONObject()
      .put("Username", username)
      .put("ClientEphemeral", srp.clientEphemeral)
      .put("ClientProof", srp.clientProof)
      .put("SRPSession", srpSession)
    val auth = postJson("$api/auth/v4", authBody.toString(), null)
    if (auth.has("TwoFactor") && auth.optInt("TwoFactor") == 1) {
      if (totp.isNullOrBlank()) {
        throw IllegalStateException("Proton 2FA required")
      }
      val uid = auth.optString("UID")
      val token = auth.optString("AccessToken")
      val two = postJson(
        "$api/auth/v4/2fa",
        JSONObject().put("TwoFactorCode", totp).toString(),
        ProtonSession(uid, token),
      )
      return ProtonSession(two.optString("UID", uid), two.optString("AccessToken", token))
    }
    val uid = auth.optString("UID")
    val token = auth.optString("AccessToken")
    if (uid.isEmpty() || token.isEmpty()) {
      throw IllegalStateException("Proton auth returned no session")
    }
    return ProtonSession(uid, token)
  }

  fun listMessages(session: ProtonSession, sinceIso: String?, limit: Int): List<ProtonMsg> {
    val url = "$api/mail/v4/messages?Page=0&PageSize=$limit&LabelID=0"
    val json = getJson(url, session)
    val arr = json.optJSONArray("Messages") ?: return emptyList()
    val out = mutableListOf<ProtonMsg>()
    val sinceMs = sinceIso?.let { parseIsoMs(it) }
    for (i in 0 until arr.length()) {
      val m = arr.getJSONObject(i)
      val time = m.optLong("Time") * 1000
      if (sinceMs != null && time <= sinceMs) continue
      val sender = m.optJSONObject("Sender")
      val from = sender?.optString("Address") ?: sender?.optString("Name") ?: ""
      out.add(
        ProtonMsg(
          id = m.optString("ID"),
          from = from,
          subject = m.optString("Subject"),
          date = java.time.Instant.ofEpochMilli(if (time > 0) time else System.currentTimeMillis()).toString(),
          text = null,
        ),
      )
    }
    return out
  }

  private fun stripModulus(modulus: String): String {
    val start = modulus.indexOf("-----BEGIN PGP SIGNED MESSAGE-----")
    val body = if (start >= 0) modulus.substring(start) else modulus
    val lines = body.lines().filter {
      it.isNotBlank() &&
        !it.startsWith("-----") &&
        !it.startsWith("Hash:") &&
        !it.startsWith("Version:")
    }
    return lines.joinToString("").replace("\\s".toRegex(), "")
  }

  private fun postJson(url: String, body: String, session: ProtonSession?): JSONObject {
    val conn = (URL(url).openConnection() as HttpsURLConnection)
    conn.requestMethod = "POST"
    conn.connectTimeout = 20_000
    conn.readTimeout = 25_000
    conn.setRequestProperty("Content-Type", "application/json")
    conn.setRequestProperty("x-pm-appversion", "Other")
    conn.setRequestProperty("User-Agent", "jsmastery/1.0")
    if (session != null) {
      conn.setRequestProperty("Authorization", "Bearer ${session.accessToken}")
      conn.setRequestProperty("x-pm-uid", session.uid)
    }
    conn.doOutput = true
    OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { it.write(body) }
    return read(conn)
  }

  private fun getJson(url: String, session: ProtonSession): JSONObject {
    val conn = (URL(url).openConnection() as HttpsURLConnection)
    conn.requestMethod = "GET"
    conn.connectTimeout = 20_000
    conn.readTimeout = 25_000
    conn.setRequestProperty("Authorization", "Bearer ${session.accessToken}")
    conn.setRequestProperty("x-pm-uid", session.uid)
    conn.setRequestProperty("x-pm-appversion", "Other")
    conn.setRequestProperty("User-Agent", "jsmastery/1.0")
    return read(conn)
  }

  private fun read(conn: HttpURLConnection): JSONObject {
    val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
    val text = BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).use { it.readText() }
    if (conn.responseCode !in 200..299) {
      throw IllegalStateException("Proton HTTP ${conn.responseCode}: $text")
    }
    return JSONObject(text)
  }
}

private data class SrpProof(val clientEphemeral: String, val clientProof: String)

/**
 * Proton-style SRP (version 4). See ProtonMail/go-srp. Not a generic RFC 5054 client.
 */
private object ProtonSrp {
  private val g = BigInteger.valueOf(2)

  fun prove(
    password: String,
    saltB64: String,
    modulusB64: String,
    serverEphemeralB64: String,
    version: Int,
  ): SrpProof {
    val n = BigInteger(1, b64(modulusB64))
    val B = BigInteger(1, b64(serverEphemeralB64))
    val salt = b64(saltB64)
    val a = BigInteger(1, SecureRandom().generateSeed(32)).mod(n)
    val A = g.modPow(a, n)
    val hashedPassword = hashedSecret(version, password, salt)
    val x = BigInteger(1, expandHash(hashedPassword))
    val u = BigInteger(1, expandHash(pad(A, n) + pad(B, n)))
    val k = BigInteger(1, expandHash(pad(n) + pad(g, n)))
    val base = B.subtract(k.multiply(g.modPow(x, n))).mod(n)
    val S = base.modPow(a.add(u.multiply(x)), n)
    val clientProof = b64enc(expandHash(pad(A, n) + pad(B, n) + pad(S, n)))
    return SrpProof(b64enc(pad(A, n)), clientProof)
  }

  private fun hashedSecret(version: Int, password: String, salt: ByteArray): ByteArray {
    val pw = password.toByteArray(StandardCharsets.UTF_8)
    val inner = sha512(pw + salt)
    return if (version >= 4) sha512(inner) else inner
  }

  private fun expandHash(data: ByteArray): ByteArray {
    val h = sha512(data)
    return h + sha512(h)
  }

  private fun sha512(data: ByteArray): ByteArray =
    MessageDigest.getInstance("SHA-512").digest(data)

  private fun pad(v: BigInteger, n: BigInteger = v): ByteArray {
    val bytes = v.toByteArray()
    val unsigned = if (bytes.isNotEmpty() && bytes[0] == 0.toByte()) {
      bytes.copyOfRange(1, bytes.size)
    } else bytes
    val size = (n.bitLength() + 7) / 8
    if (unsigned.size >= size) return unsigned.copyOfRange(unsigned.size - size, unsigned.size)
    val out = ByteArray(size)
    System.arraycopy(unsigned, 0, out, size - unsigned.size, unsigned.size)
    return out
  }

  private fun b64(s: String): ByteArray = android.util.Base64.decode(s, android.util.Base64.DEFAULT)
  private fun b64enc(b: ByteArray): String =
    android.util.Base64.encodeToString(b, android.util.Base64.NO_WRAP)
}

private fun parseIsoMs(iso: String): Long {
  return try {
    java.time.Instant.parse(iso).toEpochMilli()
  } catch (_: Exception) {
    0L
  }
}
