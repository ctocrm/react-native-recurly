/**
 * JS bridge to the Android MailImap native module (SSL IMAPS).
 * Public hosts only. Not Proton. Not Tuta.
 */
import { feedScanWatchdog } from "./scanWatchdog";
import { NativeModules, Platform } from "react-native";
import { requestProtonCaptcha } from "./protonCaptcha";
import type { MessageFetcher, NormalizedMessage } from "./types";

/**
 * Phase L root-cause fix: recover the HTML body from the native `text`
 * payload. The native bridges never emit an `html` field — Proton delivers
 * its decrypted body as a FULL MIME DOCUMENT (the text/html part is
 * quoted-printable or base64 encoded inside `text`), Tuta delivers the
 * MailBody as raw HTML, and IMAP yields the raw body text. The Phase C
 * extractor (`extractEmailIconUrls`) reads ONLY `message.html`, so without
 * this recovery the proton/tuta/imap legs could never surface brand-sent
 * icon seeds. Pure single-string ops, per-message, nothing retained —
 * OOM-safe by the same construction as the classifier (R19).
 */

/** Upper bound on the string we scan for MIME structure (defensive). */
const MIME_MAX_SCAN_CHARS = 2_000_000;

/** Decode UTF-8 bytes (as a 0-255 char-code string) into a JS string. */
function utf8FromBinary(bin: string): string {
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i) & 0xff;
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b < 0xf0 && i + 2 < bytes.length) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else if (i + 3 < bytes.length) {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      const o = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (o >> 10), 0xdc00 + (o & 0x3ff));
      i += 4;
    } else {
      i += 1;
    }
  }
  return out;
}

/** quoted-printable → UTF-8 text (drops soft breaks, decodes =XX bytes). */
function decodeQuotedPrintable(input: string): string {
  const collapsed = input.replace(/=\r?\n/g, "");
  const bin = collapsed.replace(
    /=([0-9A-Fa-f]{2})/g,
    (_m: string, h: string) => String.fromCharCode(parseInt(h, 16)),
  );
  return utf8FromBinary(bin);
}

/** base64 → UTF-8 text; null when undecodable. */
function decodeBase64ToUtf8(input: string): string | null {
  const compact = input.replace(/[^A-Za-z0-9+/=]/g, "");
  if (compact.length < 4) return null;
  const atobFn = typeof globalThis.atob === "function" ? globalThis.atob : null;
  if (!atobFn) return null;
  try {
    return utf8FromBinary(atobFn(compact));
  } catch {
    return null;
  }
}

/** Find the text/html leaf inside a MIME document (depth-capped recursion). */
function mimeHtmlPart(body: string, depth: number): string | null {
  if (depth > 3) return null;
  const bm =
    body.match(/boundary="([^"]+)"/i) ?? body.match(/boundary=([^\s;"]+)/i);
  if (!bm) return null;
  const delim = `--${bm[1]}`;
  const chunks = body.split(delim);
  for (let c = 1; c < chunks.length; c += 1) {
    const chunk = chunks[c];
    if (chunk.startsWith("--")) continue; // closing boundary marker
    const headerEnd = chunk.search(/\r?\n\r?\n/);
    if (headerEnd < 0) continue;
    const headers = chunk.slice(0, headerEnd);
    const payload = chunk.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
    if (/content-type:\s*text\/html/i.test(headers)) {
      if (/quoted-printable/i.test(headers)) return decodeQuotedPrintable(payload);
      if (/base64/i.test(headers)) return decodeBase64ToUtf8(payload) ?? payload;
      return payload.trim();
    }
    if (/content-type:\s*multipart\//i.test(headers)) {
      const nested = mimeHtmlPart(`${headers}\n\n${payload}`, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Best-effort HTML recovery from the native body text. Returns undefined
 * for plain-text bodies (correct negative — no invented HTML).
 */
export function htmlFromNativeText(
  text?: string | null,
): string | undefined {
  if (!text || text.length < 24) return undefined;
  const scan =
    text.length > MIME_MAX_SCAN_CHARS ? text.slice(0, MIME_MAX_SCAN_CHARS) : text;
  // Tuta-style: the body IS html already.
  if (/^\s*<[!a-z]/i.test(scan)) return scan;
  // Proton-style: the decrypted body is a MIME document.
  if (/content-type:/i.test(scan) && /boundary=/i.test(scan)) {
    const html = mimeHtmlPart(scan, 0);
    if (html && /<\/?[a-z][\s\S]*>/i.test(html)) return html;
  }
  return undefined;
}

export interface ImapSocketCreds {
  host: string;
  port: number;
  username: string;
  password: string;
}

interface NativeImap {
  fetchMessages(
    host: string,
    port: number,
    username: string,
    password: string,
    sinceIso: string | null,
    limit: number,
  ): Promise<{
    messages: {
      messageId: string;
      from: string;
      subject: string;
      date: string;
      text?: string;
    }[];
  }>;
}

function nativeImap(): NativeImap | null {
  const mod = NativeModules.MailImap as NativeImap | undefined;
  return mod ?? null;
}

interface NativePasswordMail {
  fetchMessages(
    username: string,
    password: string,
    totp: string | null,
    sinceIso: string | null,
    limit: number,
  ): Promise<{
    messages: {
      messageId: string;
      from: string;
      subject: string;
      date: string;
      text?: string;
    }[];
  }>;
}

export type ProtonNativeSession = {
  uid: string;
  accessToken: string;
  refreshToken: string;
};

interface NativeProton {
  login(
    username: string,
    password: string,
    totp: string | null,
    hvToken: string | null,
    hvType: string | null,
  ): Promise<ProtonNativeSession>;
  refreshSession(
    uid: string,
    refreshToken: string,
    accessToken: string | null,
  ): Promise<ProtonNativeSession>;
  listWithSession(
    uid: string,
    accessToken: string,
    sinceIso: string | null,
    untilIso: string | null,
    limit: number,
    password: string,
  ): Promise<{
    messages: {
      messageId: string;
      from: string;
      subject: string;
      date: string;
      text?: string;
    }[];
  }>;
}

function nativeNamed(
  name: "MailProton" | "MailTuta",
): NativePasswordMail | null {
  const mod = NativeModules[name] as NativePasswordMail | undefined;
  return mod ?? null;
}

function nativeProton(): NativeProton | null {
  return (NativeModules.MailProton as NativeProton | undefined) ?? null;
}

type HvInfo = { webUrl?: string; hvToken?: string; methods?: string };

function hvFromError(error: unknown): HvInfo | null {
  const err = error as {
    code?: string;
    userInfo?: HvInfo;
    nativeStackAndroid?: unknown;
  } & HvInfo;
  const info = err?.userInfo ?? err;
  const webUrl = info?.webUrl;
  if (!webUrl) return null;
  if (err?.code && err.code !== "PROTON_HV") return null;
  return {
    webUrl,
    hvToken: info.hvToken,
    methods: info.methods,
  };
}

async function protonLogin(
  native: NativeProton,
  creds: { username: string; password: string; totp?: string },
  hv?: { token: string; type: string } | null,
): Promise<ProtonNativeSession> {
  try {
    return await native.login(
      creds.username,
      creds.password,
      creds.totp ?? null,
      hv?.token ?? null,
      hv?.type ?? null,
    );
  } catch (error) {
    const challenge = hvFromError(error);
    if (!challenge?.webUrl) throw error;
    const solved = await requestProtonCaptcha({
      webUrl: challenge.webUrl,
      hvToken: challenge.hvToken ?? "",
      methods: challenge.methods ?? "captcha",
    });
    return native.login(
      creds.username,
      creds.password,
      creds.totp ?? null,
      solved.token,
      solved.type || "captcha",
    );
  }
}

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string } | null | undefined)?.code;
}

const PROTON_RECONNECT_MESSAGE =
  "Proton session expired — reconnect the mailbox (Edit → Reconnect) to scan it.";

export function createProtonFetcher(
  creds: { username: string; password: string; totp?: string },
  mailboxId: string,
  stored: ProtonNativeSession | null,
  persistSession: (session: ProtonNativeSession) => Promise<void>,
): MessageFetcher {
  return {
    async fetchMessages({ since, limit }, onChunk) {
      const native = nativeProton();
      if (!native || Platform.OS !== "android") {
        throw new Error("proton fetch needs the native MailProton module.");
      }

      // Proton/Tuta staging with a bounded bridge payload: decrypt+return the
      // mailbox in chunks so no single native->JS response is whole-mailbox
      // sized (R10: a 443-message one-shot payload exhausted the Java heap).
      const CHUNK = 75;
      const MAX_BATCHES = 40;
      const stage = async (
        session: ProtonNativeSession,
      ): Promise<void> => {
        const seen = new Set<string>();
        let staged = 0;
        // R11: sinceIso stays FIXED as the incremental lower bound (scan
        // cursor); untilIso is the exclusive newer bound that steps the
        // cursor BACKWARD through history one chunk at a time. The old code
        // advanced a single cursor to the batch's NEWEST date, so batch 2+
        // always returned 0 and only the newest CHUNK (75) was ever staged.
        const sinceIso: string | null = since?.date ?? null;
        let untilIso: string | null = null;
        for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
          feedScanWatchdog();
          const listed = await native.listWithSession(
            session.uid,
            session.accessToken,
            sinceIso,
            untilIso,
            CHUNK,
            creds.password,
          );
          const raw = listed.messages || [];
          // L2-A DIAGNOSTIC (temporary): tuta staging census — which subjects
          // are staged, so the July 14 "New invoice for Tuta" pickup can be
          // traced through classification.
          const subjects = raw
            .map((m) => m.subject ?? "(none)")
            .slice(0, 12);
          if (raw.length > 0) {
            console.log(
              `[L2-PROBE-T] tuta staged n=${raw.length} subjects=${JSON.stringify(subjects)}`,
            );
          }
          const fresh = raw
            .map((m): NormalizedMessage => ({
              mailboxId,
              messageId: m.messageId,
              from: m.from,
              subject: m.subject,
              date: m.date,
              text: m.text,
              html: htmlFromNativeText(m.text),
            }))
            .filter((m) => !seen.has(m.messageId));
          if (fresh.length === 0) break;
          for (const m of fresh) {
            seen.add(m.messageId);
          }
          // R19-OOM: flush per native chunk — the bridge payload is already
          // chunked; the JS side must not re-accumulate the whole mailbox.
          await onChunk(fresh, {
            listed: seen.size,
            // The native bridge exposes no listing total — count only.
            total: null,
          });
          staged += fresh.length;
          // Terminate on the RAW count: untilIso is a non-strict upper bound,
          // so the boundary message itself is re-returned next batch (and
          // deduped above) — raw stays at CHUNK while the window has more.
          if (raw.length < CHUNK) break;
          const dates = raw.map((m) => m.date).filter(Boolean).sort();
          if (dates.length === 0) break;
          const nextUntil = dates[0]; // oldest date of this batch
          if (nextUntil === untilIso) break;
          untilIso = nextUntil;
        }
        console.log(
          `[MailProton-js] batches staged, messages=${staged} (chunk=${CHUNK})`,
        );
      };

      let session = stored?.uid && stored.accessToken ? stored : null;

      // P2: the refresh token is single-use — spend it only when the server
      // actually rejects the access token, then retry the staged fetch once.
      // Never silently replay the password after a dead session (P1).
      if (session) {
        try {
          return await stage(session);
        } catch (error) {
          if (codeOf(error) !== "PROTON_SESSION_DEAD") throw error;
          if (!session.refreshToken) throw new Error(PROTON_RECONNECT_MESSAGE);
          console.log("[MailProton-js] access token rejected — refreshing session");
          try {
            session = await native.refreshSession(
              session.uid,
              session.refreshToken,
              session.accessToken,
            );
          } catch (refreshError) {
            if (codeOf(refreshError) === "PROTON_ABUSE") throw refreshError;
            throw new Error(PROTON_RECONNECT_MESSAGE);
          }
          await persistSession(session);
          console.log("[MailProton-js] access token refreshed");
          return await stage(session);
        }
      }

      // No stored session (first scan after connect): login with credentials.
      session = await protonLogin(native, creds);
      await persistSession(session);
      return await stage(session);
    },
  };
}

export function createPasswordMailFetcher(
  creds: { username: string; password: string; totp?: string },
  mailboxId: string,
): MessageFetcher {
  return {
    async fetchMessages({ since, limit }, onChunk) {
      const native = nativeNamed("MailTuta");
      if (!native || Platform.OS !== "android") {
        throw new Error("tuta fetch needs the native MailTuta module.");
      }
      const result = await native.fetchMessages(
        creds.username,
        creds.password,
        creds.totp ?? null,
        since?.date ?? null,
        limit,
      );
      const msgs = (result.messages || []).map((m): NormalizedMessage => ({
        mailboxId,
        messageId: m.messageId,
        from: m.from,
        subject: m.subject,
        date: m.date,
        text: m.text,
        html: htmlFromNativeText(m.text),
      }));
      // R19-OOM: single native batch streamed straight to the scan.
      // Phase K: the native bridge exposes no listing total — count only.
      await onChunk(msgs, { listed: msgs.length, total: null });
    },
  };
}

export function createImapFetcher(
  creds: ImapSocketCreds,
  mailboxId: string,
): MessageFetcher {
  return {
    async fetchMessages({ since, limit }, onChunk) {
      const native = nativeImap();
      if (!native || Platform.OS !== "android") {
        throw new Error(
          "IMAP fetch needs the native MailImap module (Android SSL socket).",
        );
      }
      const result = await native.fetchMessages(
        creds.host,
        creds.port || 993,
        creds.username,
        creds.password,
        since?.date ?? null,
        limit,
      );
      const msgs = (result.messages || []).map((m): NormalizedMessage => ({
        mailboxId,
        messageId: m.messageId,
        from: m.from,
        subject: m.subject,
        date: m.date,
        text: m.text,
        html: htmlFromNativeText(m.text),
      }));
      // R19-OOM: single native batch streamed straight to the scan.
      // Phase K: the native bridge exposes no listing total — count only.
      await onChunk(msgs, { listed: msgs.length, total: null });
    },
  };
}
