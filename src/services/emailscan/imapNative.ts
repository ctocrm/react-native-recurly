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

function nativeNamed(
  name: "MailProton" | "MailTuta",
): NativePasswordMail | null {
  const mod = NativeModules[name] as NativePasswordMail | undefined;
  return mod ?? null;
}

function nativeProton(): NativeProton | null {
  return (NativeModules.MailProton as NativeProton | undefined) ?? null;
}

const PROTON_API = "https://mail.proton.me/api";
const PROTON_ALL_MAIL = 5;
const PROTON_SEARCH_TERMS = [
  "subscription",
  "invoice",
  "receipt",
  "renewal",
  "membership",
  "billed",
];

type ProtonListRow = {
  messageId: string;
  from: string;
  subject: string;
  date: string;
  text?: string;
};

function protonIsoFromUnix(time: number): string {
  const ms = time > 0 ? time * 1000 : Date.now();
  return new Date(ms).toISOString();
}

function protonRowFromApi(raw: {
  ID?: string;
  Subject?: string;
  Time?: number;
  Sender?: { Address?: string; Name?: string };
}): ProtonListRow | null {
  const id = raw.ID;
  if (!id) return null;
  const sender = raw.Sender;
  return {
    messageId: id,
    from: sender?.Address || sender?.Name || "",
    subject: raw.Subject || "",
    date: protonIsoFromUnix(raw.Time ?? 0),
  };
}

async function searchProtonSubjects(
  session: ProtonNativeSession,
  mailboxId: string,
  sinceIso: string | null,
  limit: number,
): Promise<NormalizedMessage[]> {
  const sinceMs = sinceIso ? Date.parse(sinceIso) : NaN;
  const seen = new Set<string>();
  const out: NormalizedMessage[] = [];
  for (const term of PROTON_SEARCH_TERMS) {
    if (out.length >= limit) break;
    const url =
      `${PROTON_API}/mail/v4/messages?Page=0&PageSize=${Math.min(limit, 100)}` +
      `&LabelID=${PROTON_ALL_MAIL}&Keyword=${encodeURIComponent(term)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "x-pm-uid": session.uid,
        "x-pm-appversion": "Other",
        "User-Agent": "jsmastery/1.0",
      },
    });
    if (!res.ok) continue;
    const json = (await res.json()) as {
      Messages?: {
        ID?: string;
        Subject?: string;
        Time?: number;
        Sender?: { Address?: string; Name?: string };
      }[];
    };
    for (const raw of json.Messages || []) {
      const row = protonRowFromApi(raw);
      if (!row || seen.has(row.messageId)) continue;
      if (Number.isFinite(sinceMs) && Date.parse(row.date) <= sinceMs) continue;
      seen.add(row.messageId);
      out.push({
        mailboxId,
        messageId: row.messageId,
        from: row.from,
        subject: row.subject,
        date: row.date,
        text: row.text,
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}

function mergeProtonMessages(
  mailboxId: string,
  listed: ProtonListRow[],
  searched: NormalizedMessage[],
): NormalizedMessage[] {
  const seen = new Set<string>();
  const out: NormalizedMessage[] = [];
  for (const m of listed) {
    if (!m.messageId || seen.has(m.messageId)) continue;
    seen.add(m.messageId);
    out.push({
      mailboxId,
      messageId: m.messageId,
      from: m.from,
      subject: m.subject,
      date: m.date,
      text: m.text,
    });
  }
  for (const m of searched) {
    if (!m.messageId || seen.has(m.messageId)) continue;
    seen.add(m.messageId);
    out.push(m);
  }
  return out;
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
      let session = stored;
      if (session?.uid && session.refreshToken) {
        try {
          session = await native.refreshSession(
            session.uid,
            session.refreshToken,
            session.accessToken,
          );
          await persistSession(session);
        } catch {
          session = null;
        }
      }
      if (!session?.uid || !session.accessToken) {
        session = await protonLogin(native, creds);
        await persistSession(session);
      }
      const listed = await native.listWithSession(
        session.uid,
        session.accessToken,
        since?.date ?? null,
        limit,
      );
      const searched = await searchProtonSubjects(
        session,
        mailboxId,
        since?.date ?? null,
        limit,
      );
      return mergeProtonMessages(mailboxId, listed.messages || [], searched);
    },
  };
}

export function createPasswordMailFetcher(
  kind: "proton" | "tuta",
  creds: { username: string; password: string; totp?: string },
  mailboxId: string,
): MessageFetcher {
  if (kind === "proton") {
    return createProtonFetcher(creds, mailboxId, null, async () => undefined);
  }
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
