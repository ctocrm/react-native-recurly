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
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import javax.net.ssl.HttpsURLConnection

/**
 * Tuta client REST. Not IMAP.
 * Login: SaltService GET then SessionService POST.
 * List: User → mail group → MailboxGroupRoot → MailBox → Inbox MailSet → Mail.
 * Subjects decrypt on device. Addresses/dates are plaintext. GPL-safe reimplementation.
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

private data class TutaSession(
  val accessToken: String,
  val userId: String,
  val passphraseKey: ByteArray,
)

private data class TutaMsg(
  val id: String,
  val from: String,
  val subject: String,
  val date: String,
  val text: String?,
)

private data class TutaGroupKey(
  val groupId: String,
  val version: String,
  val key: ByteArray,
)

private class TutaClient {
  private val base = "https://app.tuta.com"
  private val modelVersion = "154"
  private val clientVersion = "357.260818.1"
  private val tutanotaV = "102"
  private val mailV = "105"
  private val mailDv = "144"
  private val generatedMinId = "------------"
  private val generatedMaxId = "zzzzzzzzzzzz"
  private val fixedIv = ByteArray(16) { 0x88.toByte() }

  fun login(mailAddress: String, password: String): TutaSession {
    val address = mailAddress.lowercase().trim()
    val saltBody = JSONObject()
      .put("418", "0")
      .put("419", address)
      .toString()
    val saltRes = requestObject(
      "GET",
      "$base/rest/sys/saltservice?_body=${java.net.URLEncoder.encode(saltBody, "UTF-8")}",
      null,
      null,
      modelVersion,
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

    val session = requestObject(
      "POST",
      "$base/rest/sys/sessionservice",
      sessionBody,
      null,
      modelVersion,
      null,
    )
    val token = session.optString("1221", session.optString("accessToken"))
    val user = firstId(session.opt("1223") ?: session.opt("user"))
    if (token.isEmpty()) {
      throw IllegalStateException("Tuta SessionService returned no accessToken")
    }
    if (user.isEmpty()) {
      throw IllegalStateException("Tuta SessionService returned no user id")
    }
    Log.i("MailTuta", "Tuta session created for $address user=$user")
    return TutaSession(token, user, passphraseKey)
  }

  fun listMail(session: TutaSession, sinceIso: String?, limit: Int): List<TutaMsg> {
    val user = requestObject(
      "GET",
      "$base/rest/sys/user/${session.userId}",
      null,
      session,
      modelVersion,
      null,
    )
    val userGroupRaw = firstObject(user.opt("95"))
      ?: throw IllegalStateException("Tuta User missing userGroup")
    val userGroupId = firstId(userGroupRaw.opt("29"))
    val userGroupVer = userGroupRaw.optString("2246", "0")
    val userGroupKey = decryptKey(session.passphraseKey, userGroupRaw.optString("27"))

    val memberships = user.optJSONArray("96") ?: JSONArray()
    var mailGroupId = ""
    var mailGroupEnc = ""
    var mailGroupVer = "0"
    for (i in 0 until memberships.length()) {
      val m = memberships.optJSONObject(i) ?: continue
      if (m.optString("1030") != "5") continue
      mailGroupId = firstId(m.opt("29"))
      mailGroupEnc = m.optString("27")
      mailGroupVer = m.optString("2246", "0")
      break
    }
    if (mailGroupId.isEmpty() || mailGroupEnc.isEmpty()) {
      throw IllegalStateException("Tuta User has no mail group membership")
    }
    val mailGroupKey = decryptKey(userGroupKey, mailGroupEnc)
    val keys = mutableListOf(
      TutaGroupKey(userGroupId, userGroupVer, userGroupKey),
      TutaGroupKey(mailGroupId, mailGroupVer, mailGroupKey),
    )

    val root = requestObject(
      "GET",
      "$base/rest/tutanota/mailboxgrouproot/$mailGroupId",
      null,
      session,
      tutanotaV,
      null,
    )
    val mailboxId = firstId(root.opt("699"))
    if (mailboxId.isEmpty()) {
      throw IllegalStateException("Tuta MailboxGroupRoot missing mailbox id")
    }

    val box = requestObject(
      "GET",
      "$base/rest/tutanota/mailbox/$mailboxId",
      null,
      session,
      tutanotaV,
      null,
    )
    val mailSets = firstObject(box.opt("443"))
    val mailSetListId = firstId(mailSets?.opt("442"))
    if (mailSetListId.isEmpty()) {
      throw IllegalStateException("Tuta MailBox missing mailSets list id")
    }

    val folders = requestArray(
      "GET",
      "$base/rest/tutanota/mailset/$mailSetListId?start=$generatedMinId&count=1000&reverse=false",
      session,
      tutanotaV,
      null,
    )
    var entriesListId = ""
    for (i in 0 until folders.length()) {
      val folder = folders.optJSONObject(i) ?: continue
      if (folder.optString("436") != "1") continue
      entriesListId = firstId(folder.opt("1459"))
      break
    }
    if (entriesListId.isEmpty()) {
      throw IllegalStateException("Tuta Inbox MailSet has no entries list")
    }

    val entries = requestArray(
      "GET",
      "$base/rest/tutanota/mailsetentry/$entriesListId?start=$generatedMaxId&count=$limit&reverse=true",
      session,
      tutanotaV,
      null,
    )
    val sinceMs = sinceIso?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }
    val out = mutableListOf<TutaMsg>()
    for (i in 0 until entries.length()) {
      if (out.size >= limit) break
      val entry = entries.optJSONObject(i) ?: continue
      val mailRef = firstObjectOrArray(entry.opt("1456"))
      val listId = mailRef.first
      val elementId = mailRef.second
      if (listId.isEmpty() || elementId.isEmpty()) continue
      val mail = requestObject(
        "GET",
        "$base/rest/tutanota/mail/$listId/$elementId",
        null,
        session,
        mailV,
        mailDv,
      )
      val mailSk = sessionKey(mail, "587", "102", "1395", keys)
      val subject = decryptString(mail.optString("105"), mailSk)
      val sender = firstObject(mail.opt("111"))
      val fromAddr = sender?.optString("95").orEmpty()
      val fromName = decryptString(sender?.optString("94").orEmpty(), mailSk)
      val from = if (fromName.isNotBlank() && fromAddr.isNotBlank()) {
        "$fromName <$fromAddr>"
      } else {
        fromAddr.ifBlank { fromName }
      }
      val received = mail.optLong("107", 0L)
      if (sinceMs != null && received > 0 && received <= sinceMs) continue
      val date = if (received > 0) {
        java.time.Instant.ofEpochMilli(received).toString()
      } else {
        java.time.Instant.now().toString()
      }
      val id = firstId(mail.opt("99")).ifBlank { "$listId/$elementId" }
      val text = try {
        decryptMailBody(mail, mailSk, session)
      } catch (e: Exception) {
        Log.w("MailTuta", "mail body skipped: ${e.message}")
        ""
      }
      out.add(TutaMsg(id, from, subject, date, text.ifBlank { null }))
    }
    Log.i("MailTuta", "Tuta listed ${out.size} Inbox messages")
    return out
  }

  private fun sessionKey(
    instance: JSONObject,
    ownerGroupAttr: String,
    encKeyAttr: String,
    versionAttr: String,
    keys: List<TutaGroupKey>,
  ): ByteArray? {
    val groupId = firstId(instance.opt(ownerGroupAttr))
    val enc = instance.optString(encKeyAttr)
    if (groupId.isEmpty() || enc.isEmpty()) return null
    val version = instance.optString(versionAttr, "0")
    val groupKey = keys.firstOrNull { it.groupId == groupId && it.version == version }?.key
      ?: keys.firstOrNull { it.groupId == groupId }?.key
      ?: return null
    return try {
      decryptKey(groupKey, enc)
    } catch (e: Exception) {
      Log.w("MailTuta", "session key unwrap failed: ${e.message}")
      null
    }
  }

  private fun decryptMailBody(
    mail: JSONObject,
    mailSk: ByteArray?,
    session: TutaSession,
  ): String {
    val inline = decryptString(mail.optString("115"), mailSk)
    if (inline.isNotBlank()) return inline
    val ref = firstObjectOrArray(mail.opt("1465"))
    if (ref.first.isEmpty() || ref.second.isEmpty() || mailSk == null) return ""
    return try {
      val blob = requestObject(
        "GET",
        "$base/rest/tutanota/maildetailsblob/${ref.first}/${ref.second}",
        null,
        session,
        tutanotaV,
        null,
      )
      longestDecryptedText(blob, mailSk)
    } catch (e: Exception) {
      Log.w("MailTuta", "mail body hop failed: ${e.message}")
      ""
    }
  }

  private fun longestDecryptedText(node: Any?, sessionKey: ByteArray): String {
    var best = ""
    fun walk(value: Any?) {
      when (value) {
        is JSONObject -> {
          val keys = value.keys()
          while (keys.hasNext()) walk(value.opt(keys.next()))
        }
        is JSONArray -> {
          for (i in 0 until value.length()) walk(value.opt(i))
        }
        is String -> {
          if (value.length < 24) return
          val plain = decryptString(value, sessionKey)
          if (plain.length > best.length) best = plain
        }
      }
    }
    walk(node)
    return best
  }

  private fun decryptString(cipherB64: String, sessionKey: ByteArray?): String {
    if (cipherB64.isBlank() || sessionKey == null) return ""
    var last: Exception? = null
    for (cipher in decodeTutaBytes(cipherB64)) {
      try {
        return String(aesDecrypt(sessionKey, cipher, padded = true), StandardCharsets.UTF_8)
      } catch (e: Exception) {
        last = e
      }
    }
    Log.w("MailTuta", "string decrypt failed: ${last?.message}")
    return ""
  }

  // Official decryptKey: AES-CBC, no PKCS padding. AES-128 uses fixed IV.
  // Bytes on the wire may be standard base64, URL-safe, or Tuta base64ext.
  private fun decryptKey(wrappingKey: ByteArray, encoded: String): ByteArray {
    val keys = mutableListOf(wrappingKey)
    if (wrappingKey.size > 16) keys.add(wrappingKey.copyOfRange(0, 16))
    var last: Exception? = null
    for (ciphertext in decodeTutaBytes(encoded)) {
      for (key in keys) {
        try {
          val hasIv = key.size != 16 || ciphertext.size % 2 == 1
          return aesDecrypt(key, ciphertext, padded = false, hasPrependedIv = hasIv)
        } catch (e: Exception) {
          last = e
        }
      }
    }
    throw last ?: IllegalStateException("Tuta key unwrap failed")
  }

  /**
   * Tuta AES-CBC. Odd-length ciphertext: version 1 + HMAC-SHA-256.
   * AES-128 keys: SHA-256 split. AES-256 keys: SHA-512 split.
   */
  private fun aesDecrypt(
    key: ByteArray,
    ciphertext: ByteArray,
    padded: Boolean,
    hasPrependedIv: Boolean = true,
  ): ByteArray {
    val authenticated = ciphertext.size % 2 == 1
    val body: ByteArray
    val encKey: ByteArray
    if (authenticated) {
      if (ciphertext[0].toInt() != 1) {
        throw IllegalStateException("Tuta unknown cipher version ${ciphertext[0]}")
      }
      val hashed = if (key.size == 16) sha256(key) else sha512(key)
      encKey = hashed.copyOfRange(0, key.size)
      val authKey = hashed.copyOfRange(key.size, hashed.size)
      val withoutVersion = ciphertext.copyOfRange(1, ciphertext.size - 32)
      val mac = ciphertext.copyOfRange(ciphertext.size - 32, ciphertext.size)
      val expected = hmacSha256(authKey, withoutVersion)
      if (!expected.contentEquals(mac)) {
        throw IllegalStateException("Tuta HMAC mismatch")
      }
      body = withoutVersion
    } else {
      encKey = key
      body = ciphertext
    }
    val iv: ByteArray
    val blocks: ByteArray
    if (hasPrependedIv) {
      iv = body.copyOfRange(0, 16)
      blocks = body.copyOfRange(16, body.size)
    } else {
      iv = fixedIv
      blocks = body
    }
    val cipher = Cipher.getInstance("AES/CBC/${if (padded) "PKCS5Padding" else "NoPadding"}")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(encKey, "AES"), IvParameterSpec(iv))
    return cipher.doFinal(blocks)
  }

  private fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    return mac.doFinal(data)
  }

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

  private fun createAuthVerifierAsBase64Url(passphraseKey: ByteArray): String {
    val digest = sha256(passphraseKey)
    val std = android.util.Base64.encodeToString(digest, android.util.Base64.NO_WRAP)
    return std.replace('+', '-').replace('/', '_').replace("=", "")
  }

  private fun sha256(data: ByteArray): ByteArray =
    MessageDigest.getInstance("SHA-256").digest(data)

  private fun sha512(data: ByteArray): ByteArray =
    MessageDigest.getInstance("SHA-512").digest(data)

  private fun requestObject(
    method: String,
    url: String,
    body: String?,
    session: TutaSession?,
    version: String,
    dependsOn: String?,
  ): JSONObject {
    val text = requestRaw(method, url, body, session, version, dependsOn)
    if (text.isBlank()) return JSONObject()
    val trimmed = text.trim()
    if (trimmed.startsWith("[")) {
      val arr = JSONArray(trimmed)
      return if (arr.length() > 0 && arr.optJSONObject(0) != null) {
        arr.getJSONObject(0)
      } else {
        JSONObject()
      }
    }
    return JSONObject(trimmed)
  }

  private fun requestArray(
    method: String,
    url: String,
    session: TutaSession,
    version: String,
    dependsOn: String?,
  ): JSONArray {
    val text = requestRaw(method, url, null, session, version, dependsOn)
    if (text.isBlank()) return JSONArray()
    val trimmed = text.trim()
    if (trimmed.startsWith("[")) return JSONArray(trimmed)
    val obj = JSONObject(trimmed)
    return JSONArray().put(obj)
  }

  private fun requestRaw(
    method: String,
    url: String,
    body: String?,
    session: TutaSession?,
    version: String,
    dependsOn: String?,
  ): String {
    val conn = (URL(url).openConnection() as HttpsURLConnection)
    conn.requestMethod = method
    conn.connectTimeout = 20_000
    conn.readTimeout = 25_000
    conn.setRequestProperty("Accept", "application/json")
    conn.setRequestProperty("v", version)
    if (dependsOn != null) conn.setRequestProperty("dv", dependsOn)
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
    return text
  }

  private fun firstId(raw: Any?): String {
    return when (raw) {
      null, JSONObject.NULL -> ""
      is JSONArray -> {
        if (raw.length() == 0) "" else firstId(raw.opt(raw.length() - 1))
      }
      else -> raw.toString().trim().trim('"')
    }
  }

  private fun firstObject(raw: Any?): JSONObject? {
    return when (raw) {
      is JSONObject -> raw
      is JSONArray -> if (raw.length() > 0) raw.optJSONObject(0) else null
      else -> null
    }
  }

  private fun firstObjectOrArray(raw: Any?): Pair<String, String> {
    return when (raw) {
      is JSONArray -> {
        // Tuta IdTuple is often wrapped: [[listId, elementId]]
        if (raw.length() == 1 && raw.optJSONArray(0) != null) {
          firstObjectOrArray(raw.optJSONArray(0))
        } else if (raw.length() >= 2) {
          Pair(raw.optString(0), raw.optString(1))
        } else if (raw.length() == 1) {
          Pair(raw.optString(0), "")
        } else {
          Pair("", "")
        }
      }
      is JSONObject -> Pair(firstId(raw.opt("0") ?: raw.opt("listId")), firstId(raw.opt("1") ?: raw.opt("elementId")))
      is String -> {
        val parts = raw.split("/")
        if (parts.size >= 2) Pair(parts[0], parts[1]) else Pair(raw, "")
      }
      else -> Pair("", "")
    }
  }

  private fun b64(s: String): ByteArray {
    return decodeTutaBytes(s).firstOrNull() ?: ByteArray(0)
  }

  private fun decodeTutaBytes(s: String): List<ByteArray> {
    val trimmed = s.trim()
    if (trimmed.isEmpty()) return emptyList()
    val out = LinkedHashMap<String, ByteArray>()
    fun add(label: String, bytes: ByteArray?) {
      if (bytes != null && bytes.isNotEmpty()) out.putIfAbsent(bytes.contentToString(), bytes)
    }
    add("std", runCatching {
      android.util.Base64.decode(trimmed, android.util.Base64.DEFAULT)
    }.getOrNull())
    add("url", runCatching {
      android.util.Base64.decode(
        trimmed,
        android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING,
      )
    }.getOrNull())
    add("ext", runCatching { decodeBase64Ext(trimmed) }.getOrNull())
    if (out.isEmpty()) {
      Log.w("MailTuta", "Tuta Bytes decode skipped (${trimmed.length} chars)")
      return emptyList()
    }
    return out.values.toList()
  }

  private fun decodeBase64Ext(raw: String): ByteArray {
    val ext = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz"
    val std = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    val mapped = StringBuilder(raw.length)
    for (ch in raw) {
      val idx = ext.indexOf(ch)
      if (idx < 0) throw IllegalArgumentException("not base64ext")
      mapped.append(std[idx])
    }
    when (mapped.length % 4) {
      2 -> mapped.append("==")
      3 -> mapped.append("=")
      1 -> throw IllegalArgumentException("bad base64ext length")
    }
    return android.util.Base64.decode(mapped.toString(), android.util.Base64.DEFAULT)
  }
}
