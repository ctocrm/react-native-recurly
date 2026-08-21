package com.ctocrm.jsmastery.imap

import android.util.Log
import at.favre.lib.crypto.bcrypt.BCrypt
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
 * Not IMAP. Not Bridge. Auth is Proton SRP (go-srp compatible).
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
        Log.e(TAG, "Proton fetch failed", e)
        promise.reject("PROTON_ERROR", e.message ?: "Proton failed", e)
      }
    }
  }

  companion object {
    const val TAG = "MailProton"
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
    if (saltB64.isEmpty() || modulus.isEmpty() || serverEphemeral.isEmpty()) {
      throw IllegalStateException(
        "Proton did not return login parameters for this address. Check the email (use . not ,).",
      )
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
    val end = body.indexOf("-----BEGIN PGP SIGNATURE-----")
    val signed = if (end >= 0) body.substring(0, end) else body
    val lines = signed.lines().filter {
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
      Log.w("MailProton", "HTTP ${conn.responseCode}: $text")
      if (conn.responseCode == 401 || conn.responseCode == 422) {
        throw IllegalStateException(
          "Proton rejected the password or 2FA code (HTTP ${conn.responseCode}).",
        )
      }
      throw IllegalStateException("Proton HTTP ${conn.responseCode}: $text")
    }
    return JSONObject(text)
  }
}

private data class SrpProof(val clientEphemeral: String, val clientProof: String)

/**
 * Proton SRP matching ProtonMail/go-srp (not RFC 5054).
 * Version 4: bcrypt $2y$10$ of password with salt||"proton", then 256-byte expandHash,
 * little-endian modular exponentiation.
 */
private object ProtonSrp {
  private val g = BigInteger.valueOf(2)
  private val random = SecureRandom()

  fun prove(
    password: String,
    saltB64: String,
    modulusB64: String,
    serverEphemeralB64: String,
    version: Int,
  ): SrpProof {
    val modulusBytes = b64(modulusB64)
    val serverEphemeralBytes = b64(serverEphemeralB64)
    val salt = b64(saltB64)
    val bitLength = modulusBytes.size * 8
    if (bitLength != 2048) {
      throw IllegalStateException("Proton SRP modulus size $bitLength is not 2048")
    }
    val hashedPassword = hashPassword(version, password, salt, modulusBytes)
    val n = toInt(modulusBytes)
    val b = toInt(serverEphemeralBytes)
    val x = toInt(hashedPassword)
    val k = toInt(expandHash(fromInt(bitLength, g) + fromInt(bitLength, n))).mod(n)
    val nMinusOne = n.subtract(BigInteger.ONE)
    var a: BigInteger
    var clientEphemeral: ByteArray
    var u: BigInteger
    val lower = BigInteger.valueOf((bitLength * 2).toLong())
    do {
      do {
        a = BigInteger(bitLength, random).mod(nMinusOne)
      } while (a < lower || a >= nMinusOne)
      clientEphemeral = fromInt(bitLength, g.modPow(a, n))

      u = toInt(expandHash(clientEphemeral + serverEphemeralBytes))
    } while (u == BigInteger.ZERO)

    val base = b.subtract(k.multiply(g.modPow(x, n))).mod(n)
    val exponent = a.add(u.multiply(x)).mod(nMinusOne)
    val shared = fromInt(bitLength, base.modPow(exponent, n))
    val clientProof = expandHash(clientEphemeral + serverEphemeralBytes + shared)
    return SrpProof(b64enc(clientEphemeral), b64enc(clientProof))
  }

  private fun hashPassword(
    version: Int,
    password: String,
    salt: ByteArray,
    modulus: ByteArray,
  ): ByteArray {
    if (version < 3) {
      throw IllegalStateException("Proton auth version $version is not supported")
    }
    val saltWithProton = salt + "proton".toByteArray(StandardCharsets.US_ASCII)
    if (saltWithProton.size != 16) {
      throw IllegalStateException(
        "Proton bcrypt salt is ${saltWithProton.size} bytes after adding proton (need 16)",
      )
    }
    val crypted = BCrypt.with(BCrypt.Version.VERSION_2Y).hash(
      10,
      saltWithProton,
      password.toByteArray(StandardCharsets.UTF_8),
    )
    return expandHash(crypted + modulus)
  }

  private fun expandHash(data: ByteArray): ByteArray {
    val md = MessageDigest.getInstance("SHA-512")
    val out = ByteArray(256)
    for (i in 0..3) {
      md.reset()
      md.update(data)
      md.update(i.toByte())
      val part = md.digest()
      System.arraycopy(part, 0, out, i * 64, 64)
    }
    return out
  }

  /** go-srp toInt: reverse bytes then interpret as big-endian integer. */
  private fun toInt(arr: ByteArray): BigInteger {
    val reversed = ByteArray(arr.size)
    for (i in arr.indices) {
      reversed[arr.size - 1 - i] = arr[i]
    }
    return BigInteger(1, reversed)
  }

  /** go-srp fromInt: big-endian bytes of num, reversed into bitLength/8 buffer. */
  private fun fromInt(bitLength: Int, num: BigInteger): ByteArray {
    val size = bitLength / 8
    val arr = num.toByteArray()
    val unsigned = if (arr.isNotEmpty() && arr[0] == 0.toByte()) {
      arr.copyOfRange(1, arr.size)
    } else arr
    val reversed = ByteArray(size)
    val n = minOf(unsigned.size, size)
    for (i in 0 until n) {
      reversed[i] = unsigned[unsigned.size - 1 - i]
    }
    return reversed
  }

  private fun b64(s: String): ByteArray {
    val trimmed = s.trim()
    val urlSafe =
      android.util.Base64.URL_SAFE or
        android.util.Base64.NO_WRAP or
        android.util.Base64.NO_PADDING
    return try {
      android.util.Base64.decode(trimmed, android.util.Base64.DEFAULT)
    } catch (_: IllegalArgumentException) {
      try {
        android.util.Base64.decode(trimmed, urlSafe)
      } catch (_: IllegalArgumentException) {
        throw IllegalStateException("Proton login data was not valid base64")
      }
    }
  }

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
