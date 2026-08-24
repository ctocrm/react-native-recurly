package com.ctocrm.jsmastery.imap

import android.util.Log
import at.favre.lib.crypto.bcrypt.BCrypt
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.openpgp.PGPCompressedData
import org.bouncycastle.openpgp.PGPEncryptedDataList
import org.bouncycastle.openpgp.PGPLiteralData
import org.bouncycastle.openpgp.PGPObjectFactory
import org.bouncycastle.openpgp.PGPOnePassSignatureList
import org.bouncycastle.openpgp.PGPPrivateKey
import org.bouncycastle.openpgp.PGPPublicKeyEncryptedData
import org.bouncycastle.openpgp.PGPSecretKey
import org.bouncycastle.openpgp.PGPSecretKeyRing
import org.bouncycastle.openpgp.PGPSecretKeyRingCollection
import org.bouncycastle.openpgp.PGPUtil
import org.bouncycastle.openpgp.operator.jcajce.JcaKeyFingerprintCalculator
import org.bouncycastle.openpgp.operator.jcajce.JcaPGPDigestCalculatorProviderBuilder
import org.bouncycastle.openpgp.operator.jcajce.JcePBESecretKeyDecryptorBuilder
import org.bouncycastle.openpgp.operator.jcajce.JcePublicKeyDataDecryptorFactoryBuilder
import org.json.JSONArray
import org.json.JSONObject

import java.io.BufferedReader
import java.io.ByteArrayInputStream
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.math.BigInteger
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Security
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/**
 * Proton Mail client REST (same API Proton Android uses).
 * Not IMAP. Not Bridge. Auth is Proton SRP (go-srp compatible).
 * Bodies decrypt on device with official mailbox-password + OpenPGP.
 */
class ProtonModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val io = Executors.newSingleThreadExecutor()

  override fun getName(): String = "MailProton"

  @ReactMethod
  fun login(
    username: String,
    password: String,
    totp: String?,
    hvToken: String?,
    hvType: String?,
    promise: Promise,
  ) {
    io.execute {
      try {
        val session = ProtonClient().login(
          username.trim(),
          password,
          totp,
          hvToken?.takeIf { it.isNotBlank() },
          hvType?.takeIf { it.isNotBlank() },
        )
        promise.resolve(protonSessionToMap(session))
      } catch (e: ProtonHvRequired) {
        promise.reject("PROTON_HV", e.message, e.toMap())
      } catch (e: Exception) {
        Log.e(TAG, "Proton login failed", e)
        promise.reject("PROTON_ERROR", e.message ?: "Proton login failed", e)
      }
    }
  }

  @ReactMethod
  fun refreshSession(
    uid: String,
    refreshToken: String,
    accessToken: String?,
    promise: Promise,
  ) {
    io.execute {
      try {
        val session = ProtonClient().refresh(uid, refreshToken, accessToken.orEmpty())
        promise.resolve(protonSessionToMap(session))
      } catch (e: Exception) {
        Log.e(TAG, "Proton refresh failed", e)
        promise.reject("PROTON_ERROR", e.message ?: "Proton refresh failed", e)
      }
    }
  }

  @ReactMethod
  fun listWithSession(
    uid: String,
    accessToken: String,
    sinceIso: String?,
    limit: Int,
    password: String?,
    promise: Promise,
  ) {
    io.execute {
      try {
        val messages = ProtonClient().listMessages(
          ProtonSession(uid, accessToken, ""),
          sinceIso,
          limit.coerceIn(1, 500),
          password,
        )
        promise.resolve(protonMessagesToMap(messages))
      } catch (e: Exception) {
        Log.e(TAG, "Proton list failed", e)
        promise.reject("PROTON_ERROR", e.message ?: "Proton list failed", e)
      }
    }
  }

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
        val session = client.login(username.trim(), password, totp, null, null)
        val messages = client.listMessages(session, sinceIso, limit.coerceIn(1, 500), password)
        promise.resolve(protonMessagesToMap(messages))
      } catch (e: ProtonHvRequired) {
        promise.reject("PROTON_HV", e.message, e.toMap())
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

private fun protonSessionToMap(session: ProtonSession): WritableMap {
  val map = Arguments.createMap()
  map.putString("uid", session.uid)
  map.putString("accessToken", session.accessToken)
  map.putString("refreshToken", session.refreshToken)
  return map
}

private fun protonMessagesToMap(messages: List<ProtonMsg>): WritableMap {
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
  return out
}

internal class ProtonHvRequired(
  val webUrl: String,
  val hvToken: String,
  val methods: String,
) : IllegalStateException(
  "Proton asked for a CAPTCHA (not a password error).",
) {
  fun toMap(): WritableMap {
    val map = Arguments.createMap()
    map.putString("webUrl", webUrl)
    map.putString("hvToken", hvToken)
    map.putString("methods", methods)
    return map
  }
}

internal data class ProtonSession(
  val uid: String,
  val accessToken: String,
  val refreshToken: String = "",
)

private data class ProtonMsg(
  val id: String,
  val from: String,
  val subject: String,
  val date: String,
  var text: String?,
  val addressId: String,
)

private data class MailboxPass(
  val full: String,
  val last31: String,
)

private data class UnlockedProtonKeys(
  val userKeyCount: Int,
  val addrKeyCount: Int,
  val privateKeys: List<PGPPrivateKey>,
)

private class ProtonClient {
  private val api = "https://mail.proton.me/api"

  fun login(
    username: String,
    password: String,
    totp: String?,
    hvToken: String?,
    hvType: String?,
  ): ProtonSession {
    val info = postJson(
      "$api/auth/v4/info",
      JSONObject().put("Username", username).toString(),
      null,
      null,
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
    val auth = postJson("$api/auth/v4", authBody.toString(), null, hvToken, hvType)
    if (auth.has("TwoFactor") && auth.optInt("TwoFactor") == 1) {
      if (totp.isNullOrBlank()) {
        throw IllegalStateException("Proton 2FA required")
      }
      val uid = auth.optString("UID")
      val token = auth.optString("AccessToken")
      val refresh = auth.optString("RefreshToken")
      val two = postJson(
        "$api/auth/v4/2fa",
        JSONObject().put("TwoFactorCode", totp).toString(),
        ProtonSession(uid, token, refresh),
        null,
        null,
      )
      return sessionFromAuth(two, uid, token, refresh)
    }
    return sessionFromAuth(auth, "", "", "")
  }

  fun refresh(uid: String, refreshToken: String, accessToken: String): ProtonSession {
    val body = JSONObject()
      .put("UID", uid)
      .put("RefreshToken", refreshToken)
      .put("ResponseType", "token")
      .put("GrantType", "refresh_token")
      .put("RedirectURI", "https://protonmail.ch")
      .put("State", java.util.UUID.randomUUID().toString().replace("-", ""))
    if (accessToken.isNotEmpty()) {
      body.put("AccessToken", accessToken)
    }
    val auth = postJson("$api/auth/v4/refresh", body.toString(), null, null, null)
    return sessionFromAuth(auth, uid, accessToken, refreshToken)
  }

  private fun sessionFromAuth(
    auth: JSONObject,
    fallbackUid: String,
    fallbackAccess: String,
    fallbackRefresh: String,
  ): ProtonSession {
    val uid = auth.optString("UID", fallbackUid)
    val token = auth.optString("AccessToken", fallbackAccess)
    val refresh = auth.optString("RefreshToken", fallbackRefresh)
    if (uid.isEmpty() || token.isEmpty()) {
      throw IllegalStateException("Proton auth returned no session")
    }
    return ProtonSession(uid, token, refresh)
  }

  fun listMessages(
    session: ProtonSession,
    sinceIso: String?,
    limit: Int,
    password: String?,
  ): List<ProtonMsg> {
    ensureBc()
    val cap = limit.coerceIn(1, 500)
    val pageSize = minOf(cap, 150)
    val labelId = "15"
    val out = mutableListOf<ProtonMsg>()
    val sinceMs = sinceIso?.let { parseIsoMs(it) }
    var page = 0
    var total = -1
    var pages = 0
    while (out.size < cap) {
      var pageJson: JSONObject? = null
      var staleTries = 0
      while (staleTries < 5) {
        val url = "$api/mail/v4/messages?Page=$page&PageSize=$pageSize&LabelID=$labelId"
        val fetched = getJson(url, session)
        pageJson = fetched
        staleTries += 1
        if (!jsonTruthy(fetched, "Stale")) break
      }
      val pageJsonSafe = pageJson ?: break
      pages += 1
      if (total < 0) total = pageJsonSafe.optInt("Total", -1)
      val arr = pageJsonSafe.optJSONArray("Messages") ?: break
      if (arr.length() == 0) break
      for (i in 0 until arr.length()) {
        if (out.size >= cap) break
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
            date = java.time.Instant.ofEpochMilli(
              if (time > 0) time else System.currentTimeMillis(),
            ).toString(),
            text = null,
            addressId = m.optString("AddressID"),
          ),
        )
      }
      if (arr.length() < pageSize) break
      if (total >= 0 && (page + 1) * pageSize >= total) break
      page += 1
    }
    Log.i(
      ProtonModule.TAG,
      "Proton listed ${out.size} of $total label=$labelId pages=$pages",
    )
    logPatternCounts(out)
    if (!password.isNullOrBlank()) {
      decryptListedBodies(session, password, out)
    }
    return out
  }

  private fun decryptListedBodies(
    session: ProtonSession,
    password: String,
    messages: MutableList<ProtonMsg>,
  ) {
    val unlocked = try {
      unlockKeys(session, password)
    } catch (e: Exception) {
      Log.w(ProtonModule.TAG, "Proton unlock failed: ${e.message}")
      Log.i(
        ProtonModule.TAG,
        "Proton unlocked userKeys=0 addrKeys=0 mode=fail",
      )
      Log.i(
        ProtonModule.TAG,
        "Proton decrypted 0 of ${messages.size} bodies fail=${messages.size}",
      )
      return
    }
    Log.i(
      ProtonModule.TAG,
      "Proton unlocked userKeys=${unlocked.userKeyCount} addrKeys=${unlocked.addrKeyCount} mode=one",
    )
    if (unlocked.privateKeys.isEmpty()) {
      Log.i(
        ProtonModule.TAG,
        "Proton decrypted 0 of ${messages.size} bodies fail=${messages.size}",
      )
      return
    }
    var decrypted = 0
    var fail = 0
    var loggedFail = false
    for (i in messages.indices) {
      val msg = messages[i]
      try {
        val full = getJson("$api/mail/v4/messages/${msg.id}", session)
        val message = full.optJSONObject("Message") ?: full
        val body = message.optString("Body")
        val text = decryptPgpMessage(body, unlocked.privateKeys)
        if (text.isBlank()) {
          fail += 1
          continue
        }
        messages[i] = msg.copy(text = text)
        decrypted += 1
      } catch (e: Exception) {
        fail += 1
        if (!loggedFail) {
          loggedFail = true
          Log.w(ProtonModule.TAG, "Proton body decrypt failed: ${e.message}")
        }
      }
    }
    Log.i(
      ProtonModule.TAG,
      "Proton decrypted $decrypted of ${messages.size} bodies fail=$fail",
    )
  }

  private fun unlockKeys(session: ProtonSession, password: String): UnlockedProtonKeys {
    val userJson = getJson("$api/core/v4/users", session)
    val user = userJson.optJSONObject("User") ?: userJson
    val userKeys = user.optJSONArray("Keys") ?: JSONArray()
    val addrJson = getJson("$api/core/v4/addresses", session)
    val addresses = addrJson.optJSONArray("Addresses") ?: JSONArray()
    val saltsJson = getJson("$api/core/v4/keys/salts", session)
    val salts = saltsJson.optJSONArray("KeySalts") ?: JSONArray()

    val sharedPasses = linkedSetOf<String>()
    sharedPasses.add(password)
    for (i in 0 until userKeys.length()) {
      val keyId = userKeys.getJSONObject(i).optString("ID")
      val pair = mailboxPassForKey(password, salts, keyId)
      if (pair.last31.isNotEmpty()) sharedPasses.add(pair.last31)
      if (pair.full.isNotEmpty()) sharedPasses.add(pair.full)
    }

    val userPriv = mutableListOf<PGPPrivateKey>()
    var userCount = 0
    for (i in 0 until userKeys.length()) {
      val key = userKeys.getJSONObject(i)
      if (key.has("Active") && !jsonTruthy(key, "Active")) continue
      val armored = key.optString("PrivateKey")
      val pair = mailboxPassForKey(password, salts, key.optString("ID"))
      val tries = linkedSetOf<String>()
      tries.addAll(sharedPasses)
      if (pair.last31.isNotEmpty()) tries.add(pair.last31)
      if (pair.full.isNotEmpty()) tries.add(pair.full)
      val unlocked = unlockArmoredPrivateKey(armored, tries)
      if (unlocked.isNotEmpty()) {
        userCount += 1
        userPriv.addAll(unlocked)
      }
    }
    if (userCount == 0) {
      Log.w(
        ProtonModule.TAG,
        "Proton could not unlock any user key (two-password mode or bad key pass)",
      )
    }

    val allPriv = userPriv.toMutableList()
    var addrCount = 0
    for (a in 0 until addresses.length()) {
      val addr = addresses.getJSONObject(a)
      val keys = addr.optJSONArray("Keys") ?: continue
      for (i in 0 until keys.length()) {
        val key = keys.getJSONObject(i)
        if (key.has("Active") && !jsonTruthy(key, "Active")) continue
        val armored = key.optString("PrivateKey")
        val token = key.optString("Token")
        val tries = sharedPasses.toMutableSet()
        if (token.isNotBlank() && userPriv.isNotEmpty()) {
          try {
            val tokenPass = decryptPgpMessage(token, userPriv)
            if (tokenPass.isNotBlank()) tries.add(tokenPass)
          } catch (e: Exception) {
            Log.w(ProtonModule.TAG, "Proton address token unwrap failed: ${e.message}")
          }
        }
        val unlocked = unlockArmoredPrivateKey(armored, tries)
        if (unlocked.isNotEmpty()) {
          addrCount += 1
          allPriv.addAll(unlocked)
        }
      }
    }
    return UnlockedProtonKeys(userCount, addrCount, allPriv.distinctBy { it.keyID })
  }

  private fun mailboxPassForKey(
    password: String,
    salts: JSONArray,
    keyId: String,
  ): MailboxPass {
    if (keyId.isBlank()) return MailboxPass("", "")
    for (i in 0 until salts.length()) {
      val salt = salts.getJSONObject(i)
      if (salt.optString("ID") != keyId) continue
      val keySaltB64 = salt.optString("KeySalt")
      if (keySaltB64.isBlank()) return MailboxPass("", "")
      val keySalt = try {
        ProtonSrp.decodeB64(keySaltB64)
      } catch (_: Exception) {
        return MailboxPass("", "")
      }
      if (keySalt.size != 16) {
        Log.w(ProtonModule.TAG, "Proton key salt is ${keySalt.size} bytes (need 16)")
        return MailboxPass("", "")
      }
      return ProtonSrp.mailboxPassword(password, keySalt)
    }
    return MailboxPass("", "")
  }

  private fun unlockArmoredPrivateKey(
    armored: String,
    passphrases: Collection<String>,
  ): List<PGPPrivateKey> {
    if (armored.isBlank()) return emptyList()
    val out = mutableListOf<PGPPrivateKey>()
    val rings = secretKeyRings(armored)
    val candidates = passphrases.toMutableList()
    candidates.add("")
    for (ring in rings) {
      val keys = ring.secretKeys
      while (keys.hasNext()) {
        val secret = keys.next() as PGPSecretKey
        var unlocked: PGPPrivateKey? = null
        for (pass in candidates) {
          try {
            val decryptor = JcePBESecretKeyDecryptorBuilder(
              JcaPGPDigestCalculatorProviderBuilder()
                .setProvider(BouncyCastleProvider.PROVIDER_NAME)
                .build(),
            ).setProvider(BouncyCastleProvider.PROVIDER_NAME).build(pass.toCharArray())
            unlocked = secret.extractPrivateKey(decryptor)
            if (unlocked != null) break
          } catch (_: Exception) {
            // try next passphrase
          }
        }
        if (unlocked != null) out.add(unlocked)
      }
    }
    return out
  }

  private fun secretKeyRings(armored: String): List<PGPSecretKeyRing> {
    val decoder = PGPUtil.getDecoderStream(
      ByteArrayInputStream(armored.toByteArray(StandardCharsets.US_ASCII)),
    )
    val factory = PGPObjectFactory(decoder, JcaKeyFingerprintCalculator())
    val out = mutableListOf<PGPSecretKeyRing>()
    var obj = factory.nextObject()
    while (obj != null) {
      when (obj) {
        is PGPSecretKeyRing -> out.add(obj)
        is PGPSecretKeyRingCollection -> {
          val rings = obj.keyRings
          while (rings.hasNext()) {
            val ring = rings.next()
            if (ring is PGPSecretKeyRing) out.add(ring)
          }
        }
      }
      obj = factory.nextObject()
    }
    return out
  }

  private fun decryptPgpMessage(armoredOrRaw: String, keys: List<PGPPrivateKey>): String {
    val raw = armoredOrRaw.trim()
    if (raw.isEmpty() || keys.isEmpty()) {
      throw IllegalStateException("empty ciphertext or no keys")
    }
    val inputBytes = if (raw.startsWith("-----BEGIN")) {
      raw.toByteArray(StandardCharsets.US_ASCII)
    } else {
      try {
        android.util.Base64.decode(raw, android.util.Base64.DEFAULT)
      } catch (_: Exception) {
        raw.toByteArray(StandardCharsets.UTF_8)
      }
    }
    val decoder = PGPUtil.getDecoderStream(ByteArrayInputStream(inputBytes))
    var factory = PGPObjectFactory(decoder, JcaKeyFingerprintCalculator())
    var obj = factory.nextObject()
    var encList: PGPEncryptedDataList? = null
    while (obj != null) {
      if (obj is PGPEncryptedDataList) {
        encList = obj
        break
      }
      obj = factory.nextObject()
    }
    if (encList == null) throw IllegalStateException("no encrypted data")
    var encrypted: PGPPublicKeyEncryptedData? = null
    var priv: PGPPrivateKey? = null
    var clear: java.io.InputStream? = null
    val packets = mutableListOf<PGPPublicKeyEncryptedData>()
    val rawPackets = encList.encryptedDataObjects
    while (rawPackets.hasNext()) {
      val pked = rawPackets.next() as? PGPPublicKeyEncryptedData ?: continue
      packets.add(pked)
    }
    fun open(pked: PGPPublicKeyEncryptedData, key: PGPPrivateKey): java.io.InputStream {
      return pked.getDataStream(
        JcePublicKeyDataDecryptorFactoryBuilder()
          .setProvider(BouncyCastleProvider.PROVIDER_NAME)
          .build(key),
      )
    }
    for (pked in packets) {
      val match = keys.firstOrNull { it.keyID == pked.keyID }
      if (match != null) {
        try {
          clear = open(pked, match)
          encrypted = pked
          priv = match
          break
        } catch (_: Exception) {
          // try next packet
        }
      }
    }
    if (clear == null) {
      outer@ for (pked in packets) {
        for (candidate in keys) {
          try {
            clear = open(pked, candidate)
            encrypted = pked
            priv = candidate
            break@outer
          } catch (_: Exception) {
            // try next key
          }
        }
      }
    }
    if (clear == null || encrypted == null || priv == null) {
      throw IllegalStateException("no matching OpenPGP key")
    }
    factory = PGPObjectFactory(clear, JcaKeyFingerprintCalculator())
    obj = factory.nextObject()
    if (obj is PGPCompressedData) {
      factory = PGPObjectFactory(obj.dataStream, JcaKeyFingerprintCalculator())
      obj = factory.nextObject()
    }
    if (obj is PGPOnePassSignatureList) {
      obj = factory.nextObject()
    }
    if (obj is PGPLiteralData) {
      return obj.inputStream.readBytes().toString(StandardCharsets.UTF_8)
    }
    throw IllegalStateException("no literal data")
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

  private fun postJson(
    url: String,
    body: String,
    session: ProtonSession?,
    hvToken: String?,
    hvType: String?,
  ): JSONObject {
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
    if (!hvToken.isNullOrBlank() && !hvType.isNullOrBlank()) {
      conn.setRequestProperty("x-pm-human-verification-token", hvToken)
      conn.setRequestProperty("x-pm-human-verification-token-type", hvType)
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
      val parsed = try {
        JSONObject(text)
      } catch (_: Exception) {
        null
      }
      val apiCode = parsed?.optInt("Code") ?: 0
      val apiError = parsed?.optString("Error").orEmpty()
      if (
        apiCode == 9001 ||
        apiError.contains("CAPTCHA", ignoreCase = true) ||
        apiError.contains("Human Verification", ignoreCase = true)
      ) {
        val details = parsed?.optJSONObject("Details")
        val hvToken = details?.optString("HumanVerificationToken").orEmpty()
        val methodsArr = details?.optJSONArray("HumanVerificationMethods")
        val methods = if (methodsArr == null || methodsArr.length() == 0) {
          "captcha"
        } else {
          buildString {
            for (i in 0 until methodsArr.length()) {
              if (i > 0) append(",")
              append(methodsArr.optString(i))
            }
          }
        }
        val webUrl = details?.optString("WebUrl").orEmpty().ifEmpty {
          if (hvToken.isNotEmpty()) {
            "https://verify.proton.me/?methods=$methods&token=$hvToken"
          } else {
            ""
          }
        }
        throw ProtonHvRequired(webUrl, hvToken, methods)
      }
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
    val modulusBytes = decodeB64(modulusB64)
    val serverEphemeralBytes = decodeB64(serverEphemeralB64)
    val salt = decodeB64(saltB64)
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

  fun mailboxPassword(password: String, keySalt: ByteArray): MailboxPass {
    val raw = BCrypt.with(BCrypt.Version.VERSION_2Y).hashRaw(
      10,
      keySalt,
      password.toByteArray(StandardCharsets.UTF_8),
    )
    val hash23 = if (raw.rawHash.size > 23) raw.rawHash.copyOfRange(0, 23) else raw.rawHash
    val crypted = (
      "\$2y\$10\$" + goBcryptB64(keySalt) + goBcryptB64(hash23)
    ).toByteArray(StandardCharsets.US_ASCII)
    val full = String(crypted, StandardCharsets.US_ASCII)
    val last31 = if (crypted.size >= 31) {
      String(crypted.copyOfRange(crypted.size - 31, crypted.size), StandardCharsets.US_ASCII)
    } else {
      full
    }
    return MailboxPass(full, last31)
  }

  fun decodeB64(s: String): ByteArray {
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
    val raw = BCrypt.with(BCrypt.Version.VERSION_2Y).hashRaw(
      10,
      saltWithProton,
      password.toByteArray(StandardCharsets.UTF_8),
    )
    val hash23 = if (raw.rawHash.size > 23) raw.rawHash.copyOfRange(0, 23) else raw.rawHash
    val crypted = (
      "\$2y\$10\$" + goBcryptB64(saltWithProton) + goBcryptB64(hash23)
    ).toByteArray(StandardCharsets.US_ASCII)
    return expandHash(crypted + modulus)
  }

  private fun goBcryptB64(data: ByteArray): String {
    val alphabet = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    val sb = StringBuilder()
    var i = 0
    while (i < data.size) {
      val remaining = data.size - i
      val b0 = data[i].toInt() and 0xff
      val b1 = if (remaining > 1) data[i + 1].toInt() and 0xff else 0
      val b2 = if (remaining > 2) data[i + 2].toInt() and 0xff else 0
      val triple = (b0 shl 16) or (b1 shl 8) or b2
      sb.append(alphabet[(triple ushr 18) and 0x3f])
      sb.append(alphabet[(triple ushr 12) and 0x3f])
      if (remaining > 1) sb.append(alphabet[(triple ushr 6) and 0x3f])
      if (remaining > 2) sb.append(alphabet[triple and 0x3f])
      i += 3
    }
    return sb.toString()
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

  private fun toInt(arr: ByteArray): BigInteger {
    val reversed = ByteArray(arr.size)
    for (i in arr.indices) {
      reversed[arr.size - 1 - i] = arr[i]
    }
    return BigInteger(1, reversed)
  }

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

private fun ensureBc() {
  val existing = Security.getProvider(BouncyCastleProvider.PROVIDER_NAME)
  if (existing is BouncyCastleProvider) return
  if (existing != null) {
    Security.removeProvider(BouncyCastleProvider.PROVIDER_NAME)
  }
  Security.insertProviderAt(BouncyCastleProvider(), 1)
}

private fun jsonTruthy(obj: JSONObject, key: String): Boolean {
  if (!obj.has(key) || obj.isNull(key)) return false
  return when (val v = obj.opt(key)) {
    is Boolean -> v
    is Number -> v.toInt() != 0
    is String -> v == "1" || v.equals("true", ignoreCase = true)
    else -> false
  }
}

private val ACCOUNT_RE =
  Regex(
    """\b(welcome|registered|verify(?:\s+your)?\s+email|account\s+created|account\s+creation|new\s+account|confirm\s+your\s+(?:email|account)|thanks\s+for\s+(?:signing|joining)|you(?:'re| are) in|discover\s+the\s+power|secure\s+\w+\s+mailbox)\b""",
    RegexOption.IGNORE_CASE,
  )
private val SECURITY_RE =
  Regex(
    """\b(password\s+reset|reset\s+your\s+password|login\s+alert|new\s+device|new\s+sign[- ]?in|two[- ]factor|2fa|verification\s+code|security\s+alert|suspicious\s+(?:login|activity))\b""",
    RegexOption.IGNORE_CASE,
  )
private val RECURRING_RE =
  Regex(
    """\b(subscription|membership|renewal|renews|renewed|billed\s+(?:monthly|yearly|annually)|monthly\s+(?:plan|membership)|annual\s+(?:plan|membership)|your\s+prime\s+membership)\b""",
    RegexOption.IGNORE_CASE,
  )
private val SPARSE_RE =
  Regex(
    """\b(invoice|usage|statement|in[- ]?app\s+purchase|\biap\b|order|receipt|one[- ]off|overage)\b""",
    RegexOption.IGNORE_CASE,
  )
private val DROP_RE =
  Regex(
    """\b(newsletter|weekly\s+digest|shipping\s+(?:update|confirmation)|your\s+(?:package|order)\s+has\s+shipped|unsubscribe|digest)\b""",
    RegexOption.IGNORE_CASE,
  )
private val OTP_ONLY_RE =
  Regex(
    """\b(one[- ]time\s+(?:pass(?:word|code)|code)|otp|verification\s+code|your\s+code\s+is)\b""",
    RegexOption.IGNORE_CASE,
  )

private fun classifyProtonSubject(subject: String): String {
  val s = subject.trim()
  if (s.isEmpty()) return "emptySubject"
  if (DROP_RE.containsMatchIn(s) && !RECURRING_RE.containsMatchIn(s)) return "drop"
  if (
    OTP_ONLY_RE.containsMatchIn(s) &&
    !ACCOUNT_RE.containsMatchIn(s) &&
    !SECURITY_RE.containsMatchIn(s) &&
    !SPARSE_RE.containsMatchIn(s) &&
    !RECURRING_RE.containsMatchIn(s)
  ) {
    return "drop"
  }
  if (RECURRING_RE.containsMatchIn(s)) return "recurring"
  if (SPARSE_RE.containsMatchIn(s)) return "sparse"
  if (SECURITY_RE.containsMatchIn(s)) return "security"
  if (ACCOUNT_RE.containsMatchIn(s)) return "account"
  return "drop"
}

private fun logPatternCounts(messages: List<ProtonMsg>) {
  var recurring = 0
  var sparse = 0
  var account = 0
  var security = 0
  var drop = 0
  var emptySubject = 0
  for (m in messages) {
    when (classifyProtonSubject(m.subject)) {
      "recurring" -> recurring += 1
      "sparse" -> sparse += 1
      "account" -> account += 1
      "security" -> security += 1
      "emptySubject" -> emptySubject += 1
      else -> drop += 1
    }
  }
  Log.i(
    ProtonModule.TAG,
    "Proton patterns recurring=$recurring sparse=$sparse account=$account security=$security drop=$drop emptySubject=$emptySubject",
  )
}
