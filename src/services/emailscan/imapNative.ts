/**
 * JS bridge to the Android MailImap native module (SSL IMAPS).
 * Public hosts only. Not Proton. Not Tuta.
 */
import { NativeModules, Platform } from "react-native";
import { requestProtonCaptcha } from "./protonCaptcha";
import type { MessageFetcher, NormalizedMessage } from "./types";

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
    async fetchMessages({ since, limit }) {
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
      ): Promise<NormalizedMessage[]> => {
        const out: NormalizedMessage[] = [];
        const seen = new Set<string>();
        // R11: sinceIso stays FIXED as the incremental lower bound (scan
        // cursor); untilIso is the exclusive newer bound that steps the
        // cursor BACKWARD through history one chunk at a time. The old code
        // advanced a single cursor to the batch's NEWEST date, so batch 2+
        // always returned 0 and only the newest CHUNK (75) was ever staged.
        const sinceIso: string | null = since?.date ?? null;
        let untilIso: string | null = null;
        for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
          const listed = await native.listWithSession(
            session.uid,
            session.accessToken,
            sinceIso,
            untilIso,
            CHUNK,
            creds.password,
          );
          const raw = listed.messages || [];
          const fresh = raw
            .map((m): NormalizedMessage => ({
              mailboxId,
              messageId: m.messageId,
              from: m.from,
              subject: m.subject,
              date: m.date,
              text: m.text,
            }))
            .filter((m) => !seen.has(m.messageId));
          if (fresh.length === 0) break;
          for (const m of fresh) {
            seen.add(m.messageId);
            out.push(m);
          }
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
          `[MailProton-js] batches staged, messages=${out.length} (chunk=${CHUNK})`,
        );
        return out;
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
    async fetchMessages({ since, limit }) {
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
      return (result.messages || []).map((m): NormalizedMessage => ({
        mailboxId,
        messageId: m.messageId,
        from: m.from,
        subject: m.subject,
        date: m.date,
        text: m.text,
      }));
    },
  };
}

export function createImapFetcher(
  creds: ImapSocketCreds,
  mailboxId: string,
): MessageFetcher {
  return {
    async fetchMessages({ since, limit }) {
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
      return (result.messages || []).map((m): NormalizedMessage => ({
        mailboxId,
        messageId: m.messageId,
        from: m.from,
        subject: m.subject,
        date: m.date,
        text: m.text,
      }));
    },
  };
}
