package com.ctocrm.jsmastery.imap

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import javax.net.ssl.SSLSocketFactory

/**
 * Native IMAPS (SSL) client. Public hosts only: iCloud / Yahoo / AOL / custom.
 * Not Proton. Not Tuta. Not Bridge.
 */
class ImapModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val io = Executors.newSingleThreadExecutor()

  override fun getName(): String = "MailImap"

  @ReactMethod
  fun fetchMessages(
    host: String,
    port: Int,
    username: String,
    password: String,
    sinceIso: String?,
    limit: Int,
    promise: Promise,
  ) {
    io.execute {
      try {
        val capped = limit.coerceIn(1, 200)
        val messages = ImapClient().fetch(
          host.trim(),
          if (port > 0) port else 993,
          username,
          password,
          sinceIso,
          capped,
        )
        val arr = Arguments.createArray()
        for (m in messages) {
          val map = Arguments.createMap()
          map.putString("messageId", m.messageId)
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
        promise.reject("IMAP_ERROR", e.message ?: "IMAP failed", e)
      }
    }
  }
}

private data class ImapMessage(
  val messageId: String,
  val from: String,
  val subject: String,
  val date: String,
  val text: String?,
)

private class ImapClient {
  fun fetch(
    host: String,
    port: Int,
    username: String,
    password: String,
    sinceIso: String?,
    limit: Int,
  ): List<ImapMessage> {
    if (host.isEmpty()) throw IOException("IMAP host required")
    val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
    factory.createSocket().use { raw ->
      raw.connect(InetSocketAddress(host, port), 20_000)
      raw.soTimeout = 25_000
      val session = ImapSession(raw as java.net.Socket)
      session.readGreeting()
      session.command("LOGIN ${imapQuote(username)} ${imapQuote(password)}")
      val select = session.command("SELECT INBOX")
      val exists = parseExists(select)
      val seqs = if (!sinceIso.isNullOrBlank()) {
        val since = isoToImapDate(sinceIso)
        val search = session.command("UID SEARCH SINCE $since")
        parseSearchUids(search).takeLast(limit)
      } else {
        emptyList()
      }
      val out = mutableListOf<ImapMessage>()
      if (seqs.isNotEmpty()) {
        for (uid in seqs) {
          val lines = session.command(
            "UID FETCH $uid (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] BODY.PEEK[TEXT])",
          )
          parseFetched(lines, uid.toString())?.let { out.add(it) }
        }
      } else if (exists > 0) {
        val start = (exists - limit + 1).coerceAtLeast(1)
        for (seq in start..exists) {
          val lines = session.command(
            "FETCH $seq (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] BODY.PEEK[TEXT])",
          )
          parseFetched(lines, seq.toString())?.let { out.add(it) }
        }
      }
      try {
        session.command("LOGOUT")
      } catch (_: Exception) {
      }
      return out
    }
  }
}

private class ImapSession(sock: java.net.Socket) {
  private val input = BufferedInputStream(sock.getInputStream())
  private val output = BufferedOutputStream(sock.getOutputStream())
  private var tagN = 0

  fun readGreeting() {
    val line = readLine()
    if (!line.startsWith("* OK") && !line.startsWith("* PREAUTH")) {
      throw IOException("IMAP greeting: $line")
    }
  }

  fun command(command: String): List<String> {
    tagN += 1
    val tag = "A$tagN"
    write("$tag $command\r\n")
    val lines = mutableListOf<String>()
    while (true) {
      val line = readLineMaybeLiteral()
      lines.add(line)
      if (line.startsWith("$tag ")) {
        if (!line.contains(" OK", ignoreCase = false) &&
          !Regex("^$tag OK", RegexOption.IGNORE_CASE).containsMatchIn(line)
        ) {
          throw IOException(line)
        }
        break
      }
    }
    return lines
  }

  private fun write(s: String) {
    output.write(s.toByteArray(StandardCharsets.US_ASCII))
    output.flush()
  }

  private fun readLine(): String {
    val sb = StringBuilder()
    while (true) {
      val b = input.read()
      if (b < 0) throw IOException("IMAP connection closed")
      if (b == '\n'.code) break
      if (b != '\r'.code) sb.append(b.toChar())
    }
    return sb.toString()
  }

  private fun readLineMaybeLiteral(): String {
    val line = readLine()
    val lit = LITERAL.find(line) ?: return line
    val size = lit.groupValues[1].toInt()
    val buf = ByteArray(size)
    var off = 0
    while (off < size) {
      val n = input.read(buf, off, size - off)
      if (n < 0) throw IOException("IMAP literal truncated")
      off += n
    }
    // consume trailing CRLF after literal if present is next line's start;
    // IMAP puts CRLF after literal then continuation. Keep body in-band.
    val body = String(buf, StandardCharsets.UTF_8)
    return "$line\n$body"
  }
}

private val LITERAL = Regex("\\{(\\d+)\\}\\s*$")

private fun imapQuote(s: String): String {
  val escaped = s.replace("\\", "\\\\").replace("\"", "\\\"")
  return "\"$escaped\""
}

private fun parseExists(lines: List<String>): Int {
  val re = Regex("^\\* (\\d+) EXISTS", RegexOption.IGNORE_CASE)
  for (line in lines) {
    val m = re.find(line) ?: continue
    return m.groupValues[1].toInt()
  }
  return 0
}

private fun parseSearchUids(lines: List<String>): List<Long> {
  val out = mutableListOf<Long>()
  for (line in lines) {
    if (!line.uppercase(Locale.US).startsWith("* SEARCH")) continue
    val parts = line.substringAfter("SEARCH").trim().split(Regex("\\s+"))
    for (p in parts) {
      p.toLongOrNull()?.let { out.add(it) }
    }
  }
  return out
}

private fun parseFetched(lines: List<String>, fallbackId: String): ImapMessage? {
  val joined = lines.joinToString("\n")
  val headers = extractSection(joined, "HEADER") ?: extractSection(joined, "RFC822.HEADER") ?: ""
  val text = extractSection(joined, "TEXT")
  val headerMap = parseHeaders(headers)
  val from = headerMap["from"] ?: ""
  val subject = headerMap["subject"] ?: ""
  val date = normalizeDate(headerMap["date"])
  val id = headerMap["message-id"]?.trim()?.removeSurrounding("<", ">") ?: fallbackId
  if (from.isEmpty() && subject.isEmpty() && text.isNullOrEmpty()) return null
  val clipped = text?.take(12_000)
  return ImapMessage(
    messageId = id.ifEmpty { fallbackId },
    from = from,
    subject = subject,
    date = date,
    text = clipped,
  )
}

private fun extractSection(blob: String, name: String): String? {
  val idx = blob.indexOf("BODY[")
  if (idx < 0) {
    val alt = blob.indexOf(name, ignoreCase = true)
    if (alt < 0) return null
  }
  val marker = Regex("BODY\\[[^\\]]*${Regex.escape(name)}[^\\]]*\\]\\s*", RegexOption.IGNORE_CASE)
  val m = marker.find(blob) ?: return null
  val after = blob.substring(m.range.last + 1)
  val lit = Regex("^\\{(\\d+)\\}\\s*\\n").find(after)
  if (lit != null) {
    val size = lit.groupValues[1].toInt()
    val start = lit.range.last + 1
    return after.substring(start, (start + size).coerceAtMost(after.length))
  }
  if (after.startsWith("\"")) {
    val end = after.indexOf('"', 1)
    if (end > 0) return after.substring(1, end)
  }
  val nl = after.indexOf("\n)")
  return if (nl > 0) after.substring(0, nl) else after.take(4000)
}

private fun parseHeaders(raw: String): Map<String, String> {
  val map = mutableMapOf<String, String>()
  val unfolded = raw.replace(Regex("\\r?\\n[ \\t]+"), " ")
  for (line in unfolded.split(Regex("\\r?\\n"))) {
    val c = line.indexOf(':')
    if (c <= 0) continue
    val key = line.substring(0, c).trim().lowercase(Locale.US)
    val value = line.substring(c + 1).trim()
    map[key] = value
  }
  return map
}

private fun isoToImapDate(iso: String): String {
  val day = iso.take(10)
  val fmtIn = SimpleDateFormat("yyyy-MM-dd", Locale.US)
  fmtIn.timeZone = TimeZone.getTimeZone("UTC")
  val fmtOut = SimpleDateFormat("dd-MMM-yyyy", Locale.US)
  fmtOut.timeZone = TimeZone.getTimeZone("UTC")
  return try {
    fmtOut.format(fmtIn.parse(day) ?: Date())
  } catch (_: Exception) {
    fmtOut.format(Date())
  }
}

private fun normalizeDate(raw: String?): String {
  if (raw.isNullOrBlank()) return Date().toInstant().toString()
  return try {
    val fmt = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss Z", Locale.US)
    fmt.parse(raw)?.toInstant()?.toString() ?: Date().toInstant().toString()
  } catch (_: Exception) {
    Date().toInstant().toString()
  }
}
