/**
 * Live mail providers. Shared classifier does not live here.
 * Tokens go in SecureStore. No client secrets in source.
 *
 * IMAP scan uses the Android MailImap SSL socket (H2). Public hosts only.
 * Not Proton. Not Tuta.
 */
import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import { runPersistedScan } from "./persist";
import type {
  IncrementalScanResult,
  MailProvider,
  MailProviderId,
  MessageFetcher,
  NormalizedMessage,
} from "./types";

export class MailConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConnectError";
  }
}

export class MailScanUnverifiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailScanUnverifiedError";
  }
}

export interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

interface TokenBlob {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  accountHint?: string;
  uid?: string;
}

/** SecureStore keys may only use A-Z a-z 0-9 . - _ */
function secureStoreKey(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]/g, "_");
}

function tokenKey(mailboxId: string): string {
  return `mail_tokens_${secureStoreKey(mailboxId)}`;
}

function imapKey(mailboxId: string): string {
  return `mail_imap_${secureStoreKey(mailboxId)}`;
}

export function mailboxIdFor(
  providerId: MailProviderId,
  hint?: string,
): string {
  return hint ? `${providerId}:${hint}` : providerId;
}

async function loadTokens(mailboxId: string): Promise<TokenBlob | null> {
  const raw = await SecureStore.getItemAsync(tokenKey(mailboxId));
  return raw ? (JSON.parse(raw) as TokenBlob) : null;
}

async function saveTokens(mailboxId: string, tokens: TokenBlob): Promise<void> {
  await SecureStore.setItemAsync(tokenKey(mailboxId), JSON.stringify(tokens));
}

function passwordKey(providerId: "proton" | "tuta", mailboxId: string): string {
  return `mail_password_${providerId}_${secureStoreKey(mailboxId)}`;
}

export interface PasswordMailCredentials {
  username: string;
  password: string;
  totp?: string;
}

export async function savePasswordMailCredentials(
  providerId: "proton" | "tuta",
  mailboxId: string,
  creds: PasswordMailCredentials,
): Promise<void> {
  await SecureStore.setItemAsync(
    passwordKey(providerId, mailboxId),
    JSON.stringify(creds),
  );
}

export async function loadPasswordMailCredentials(
  providerId: "proton" | "tuta",
  mailboxId: string,
): Promise<PasswordMailCredentials | null> {
  const raw = await SecureStore.getItemAsync(
    passwordKey(providerId, mailboxId),
  );
  return raw ? (JSON.parse(raw) as PasswordMailCredentials) : null;
}

export async function saveImapCredentials(
  mailboxId: string,
  creds: ImapCredentials,
): Promise<void> {
  await SecureStore.setItemAsync(imapKey(mailboxId), JSON.stringify(creds));
}

export async function loadImapCredentials(
  mailboxId: string,
): Promise<ImapCredentials | null> {
  const raw = await SecureStore.getItemAsync(imapKey(mailboxId));
  return raw ? (JSON.parse(raw) as ImapCredentials) : null;
}

function present(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export function oauthClientId(providerId: MailProviderId): string | undefined {
  switch (providerId) {
    case "gmail":
    case "workspace":
      return (
        present(process.env.EXPO_PUBLIC_GOOGLE_MAIL_CLIENT_ID) ||
        present(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID)
      );
    case "outlook":
    case "office365":
      return (
        present(process.env.EXPO_PUBLIC_MICROSOFT_MAIL_CLIENT_ID) ||
        present(process.env.EXPO_PUBLIC_ONEDRIVE_CLIENT_ID)
      );
    case "zoho":
      return present(process.env.EXPO_PUBLIC_ZOHO_CLIENT_ID);
    case "fastmail":
      return present(process.env.EXPO_PUBLIC_FASTMAIL_CLIENT_ID);
    default:
      return undefined;
  }
}

interface OAuthSpec {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
  extraParams?: Record<string, string>;
}

function oauthSpec(providerId: MailProviderId): OAuthSpec {
  switch (providerId) {
    case "gmail":
    case "workspace":
      return {
        authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenEndpoint: "https://oauth2.googleapis.com/token",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        extraParams: {
          access_type: "offline",
          prompt: "consent",
          ...(providerId === "workspace" ? { hd: "*" } : {}),
        },
      };
    case "outlook":
    case "office365":
      return {
        authorizationEndpoint:
          "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        tokenEndpoint:
          "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        scopes: ["Mail.Read", "offline_access", "User.Read"],
      };
    case "zoho":
      return {
        authorizationEndpoint: "https://accounts.zoho.com/oauth/v2/auth",
        tokenEndpoint: "https://accounts.zoho.com/oauth/v2/token",
        scopes: ["ZohoMail.messages.READ"],
        extraParams: { access_type: "offline", prompt: "consent" },
      };
    case "fastmail":
      return {
        authorizationEndpoint: "https://api.fastmail.com/oauth/authorize",
        tokenEndpoint: "https://api.fastmail.com/oauth/refresh",
        scopes: ["https://www.fastmail.com/dev/protocol-jmap"],
      };
    default:
      throw new MailConnectError("IMAP does not use OAuth");
  }
}

export async function promptOAuth(
  providerId: MailProviderId,
  userId: string,
): Promise<TokenBlob> {
  const clientId = oauthClientId(providerId);
  if (!clientId) {
    throw new MailConnectError(
      `${providerId} OAuth is not configured (missing public client id).`,
    );
  }
  const spec = oauthSpec(providerId);
  // Leftover live scheme until Clerk lists cadence://. Do not drop jsmastery:// first.
  const redirectUri = AuthSession.makeRedirectUri({ scheme: "jsmastery" });
  const request = new AuthSession.AuthRequest({
    clientId,
    scopes: spec.scopes,
    redirectUri,
    extraParams: spec.extraParams,
    usePKCE: true,
  });
  const result = await request.promptAsync({
    authorizationEndpoint: spec.authorizationEndpoint,
  });
  if (result.type !== "success") {
    throw new MailConnectError(
      result.type === "cancel" || result.type === "dismiss"
        ? "Sign-in cancelled"
        : `OAuth failed (${result.type})`,
    );
  }
  const params = result.params;
  const accessToken = params.access_token || params.accessToken;
  if (!accessToken) {
    throw new MailConnectError("OAuth returned no access token");
  }
  return {
    accessToken,
    refreshToken: params.refresh_token || params.refreshToken,
    expiresAt: params.expires_in
      ? Date.now() + Number.parseInt(params.expires_in, 10) * 1000
      : undefined,
  };
}

async function accountHintFromToken(
  providerId: MailProviderId,
  accessToken: string,
): Promise<string> {
  try {
    if (providerId === "gmail" || providerId === "workspace") {
      const res = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (res.ok) {
        const json = (await res.json()) as { emailAddress?: string };
        if (json.emailAddress) return json.emailAddress;
      }
    }
    if (providerId === "outlook" || providerId === "office365") {
      const res = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const json = (await res.json()) as {
          mail?: string;
          userPrincipalName?: string;
        };
        if (json.mail) return json.mail;
        if (json.userPrincipalName) return json.userPrincipalName;
      }
    }
  } catch {
    // fall through
  }
  return `${providerId}-${Date.now()}`;
}

const SUBJECT_QUERY =
  "subject:(welcome OR registered OR verify OR subscription OR renewal OR membership OR invoice OR receipt OR statement OR password OR login OR order)";

function decodeB64Url(data: string): string {
  const pad = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return globalThis.atob ? globalThis.atob(pad) : pad;
  } catch {
    return pad;
  }
}

function headerOf(
  headers: { name: string; value: string }[] | undefined,
  name: string,
): string {
  return (
    headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    ""
  );
}

function gmailBody(payload: any): { text?: string; html?: string } {
  if (!payload) return {};
  if (payload.body?.data && payload.mimeType === "text/plain") {
    return { text: decodeB64Url(payload.body.data) };
  }
  if (payload.body?.data && payload.mimeType === "text/html") {
    return { html: decodeB64Url(payload.body.data) };
  }
  const parts = payload.parts || [];
  let text: string | undefined;
  let html: string | undefined;
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      text = decodeB64Url(part.body.data);
    } else if (part.mimeType === "text/html" && part.body?.data) {
      html = decodeB64Url(part.body.data);
    }
  }
  return { text, html };
}

function gmailAttachments(payload: any): NormalizedMessage["attachments"] {
  const out: NonNullable<NormalizedMessage["attachments"]> = [];
  const walk = (node: any) => {
    if (!node) return;
    if (node.filename && node.filename.length > 0) {
      out.push({
        filename: node.filename,
        mimeType: node.mimeType,
      });
    }
    for (const child of node.parts || []) walk(child);
  };
  walk(payload);
  return out.length ? out : undefined;
}

export function createGmailFetcher(
  accessToken: string,
  mailboxId: string,
): MessageFetcher {
  return {
    async fetchMessages({ since, limit }) {
      const qParts = [SUBJECT_QUERY];
      if (since?.date) {
        const day = since.date.slice(0, 10).replace(/-/g, "/");
        qParts.push(`after:${day}`);
      }
      const params = new URLSearchParams({
        q: qParts.join(" "),
        maxResults: String(Math.min(limit, 100)),
      });
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!listRes.ok) {
        throw new MailScanUnverifiedError(
          `Gmail list failed (${listRes.status})`,
        );
      }
      const listJson = (await listRes.json()) as {
        messages?: { id: string }[];
      };
      const ids = (listJson.messages || []).map((m) => m.id);
      const messages: NormalizedMessage[] = [];
      for (const id of ids) {
        const getRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!getRes.ok) continue;
        const raw = await getRes.json();
        const headers = raw.payload?.headers as
          { name: string; value: string }[] | undefined;
        const body = gmailBody(raw.payload);
        const internal = raw.internalDate
          ? new Date(Number(raw.internalDate)).toISOString()
          : new Date().toISOString();
        messages.push({
          mailboxId,
          messageId: raw.id,
          from: headerOf(headers, "From"),
          subject: headerOf(headers, "Subject"),
          date: internal,
          text: body.text,
          html: body.html,
          attachments: gmailAttachments(raw.payload),
        });
      }
      return messages;
    },
  };
}

export function createGraphFetcher(
  accessToken: string,
  mailboxId: string,
): MessageFetcher {
  return {
    async fetchMessages({ since, limit }) {
      const filters = [
        "contains(subject,'welcome')",
        "contains(subject,'subscription')",
        "contains(subject,'renewal')",
        "contains(subject,'invoice')",
        "contains(subject,'receipt')",
        "contains(subject,'password')",
        "contains(subject,'order')",
      ];
      const params = new URLSearchParams({
        $top: String(Math.min(limit, 50)),
        $select: "id,subject,from,receivedDateTime,body,hasAttachments",
        $filter: since?.date
          ? `receivedDateTime gt ${since.date}`
          : `(${filters.join(" or ")})`,
      });
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) {
        throw new MailScanUnverifiedError(`Graph list failed (${res.status})`);
      }
      const json = (await res.json()) as {
        value?: {
          id: string;
          subject?: string;
          from?: { emailAddress?: { address?: string; name?: string } };
          receivedDateTime?: string;
          body?: { contentType?: string; content?: string };
        }[];
      };
      return (json.value || []).map((m) => {
        const addr = m.from?.emailAddress?.address || "";
        const name = m.from?.emailAddress?.name;
        const html =
          m.body?.contentType?.toLowerCase() === "html"
            ? m.body.content
            : undefined;
        const text =
          m.body?.contentType?.toLowerCase() === "text"
            ? m.body.content
            : undefined;
        return {
          mailboxId,
          messageId: m.id,
          from: name ? `${name} <${addr}>` : addr,
          subject: m.subject || "",
          date: m.receivedDateTime || new Date().toISOString(),
          text,
          html,
        };
      });
    },
  };
}

export function createZohoFetcher(
  accessToken: string,
  mailboxId: string,
): MessageFetcher {
  return {
    async fetchMessages({ since, limit }) {
      const accRes = await fetch("https://mail.zoho.com/api/accounts", {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      });
      if (!accRes.ok) {
        throw new MailScanUnverifiedError(
          `Zoho accounts failed (${accRes.status})`,
        );
      }
      const accJson = (await accRes.json()) as {
        data?: { accountId?: string }[];
      };
      const accountId = accJson.data?.[0]?.accountId;
      if (!accountId) {
        throw new MailScanUnverifiedError("Zoho session missing account");
      }
      const searchKey = since?.date
        ? `after:${since.date.slice(0, 10)}`
        : "subject:welcome OR subject:subscription OR subject:renewal OR subject:invoice OR subject:receipt OR subject:password OR subject:order";
      const params = new URLSearchParams({
        searchKey,
        limit: String(Math.min(limit, 50)),
      });
      const res = await fetch(
        `https://mail.zoho.com/api/accounts/${accountId}/messages/search?${params}`,
        { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } },
      );
      if (!res.ok) {
        throw new MailScanUnverifiedError(`Zoho search failed (${res.status})`);
      }
      const json = (await res.json()) as {
        data?: {
          messageId?: string;
          fromAddress?: string;
          sender?: string;
          subject?: string;
          receivedTime?: string | number;
          summary?: string;
        }[];
      };
      return (json.data || []).map((m) => {
        const received =
          typeof m.receivedTime === "number"
            ? new Date(m.receivedTime).toISOString()
            : m.receivedTime || new Date().toISOString();
        return {
          mailboxId,
          messageId: String(m.messageId || ""),
          from: m.sender
            ? `${m.sender} <${m.fromAddress || ""}>`
            : m.fromAddress || "",
          subject: m.subject || "",
          date: received,
          text: m.summary,
        };
      });
    },
  };
}

export function createJmapFetcher(
  accessToken: string,
  mailboxId: string,
): MessageFetcher {
  return {
    async fetchMessages({ since, limit }) {
      const sessionRes = await fetch("https://api.fastmail.com/jmap/session", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!sessionRes.ok) {
        throw new MailScanUnverifiedError(
          `Fastmail session failed (${sessionRes.status})`,
        );
      }
      const session = await sessionRes.json();
      const apiUrl = session.apiUrl as string;
      const accountId = Object.keys(session.accounts || {})[0];
      if (!apiUrl || !accountId) {
        throw new MailScanUnverifiedError("Fastmail session missing account");
      }
      const query: unknown[] = [
        [
          "Email/query",
          {
            accountId,
            filter: since?.date
              ? { after: since.date }
              : {
                  operator: "OR",
                  conditions: [
                    { subject: "welcome" },
                    { subject: "registered" },
                    { subject: "verify" },
                    { subject: "subscription" },
                    { subject: "renewal" },
                    { subject: "membership" },
                    { subject: "invoice" },
                    { subject: "receipt" },
                    { subject: "statement" },
                    { subject: "password" },
                    { subject: "login" },
                    { subject: "order" },
                  ],
                },
            sort: [{ property: "receivedAt", isAscending: false }],
            limit: Math.min(limit, 50),
          },
          "0",
        ],
        [
          "Email/get",
          {
            accountId,
            "#ids": { resultOf: "0", name: "Email/query", path: "/ids" },
            properties: [
              "id",
              "subject",
              "from",
              "receivedAt",
              "preview",
              "textBody",
              "htmlBody",
              "attachments",
            ],
          },
          "1",
        ],
      ];
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
          methodCalls: query,
        }),
      });
      if (!res.ok) {
        throw new MailScanUnverifiedError(`JMAP get failed (${res.status})`);
      }
      const json = await res.json();
      const getCall = (json.methodResponses || []).find(
        (c: unknown[]) => c[0] === "Email/get",
      );
      const list = getCall?.[1]?.list || [];
      return list.map((m: any) => {
        const fromObj = m.from?.[0];
        const from = fromObj
          ? `${fromObj.name || ""} <${fromObj.email || ""}>`.trim()
          : "";
        return {
          mailboxId,
          messageId: m.id,
          from,
          subject: m.subject || "",
          date: m.receivedAt || new Date().toISOString(),
          text: m.preview,
        };
      });
    },
  };
}

async function fetcherFor(
  providerId: MailProviderId,
  userId: string,
  mailboxId: string,
): Promise<MessageFetcher> {
  if (providerId === "imap") {
    const creds = await loadImapCredentials(mailboxId);
    if (!creds) {
      throw new MailConnectError("IMAP is not connected");
    }
    const { createImapFetcher } = await import("./imapNative");
    const inner = createImapFetcher(creds, mailboxId);
    return {
      async fetchMessages(opts) {
        try {
          return await inner.fetchMessages(opts);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "IMAP fetch failed";
          throw new MailScanUnverifiedError(message);
        }
      },
    };
  }
  if (providerId === "proton") {
    const creds = await loadPasswordMailCredentials("proton", mailboxId);
    if (!creds) {
      throw new MailConnectError("proton is not connected");
    }
    const stored = await loadTokens(mailboxId);
    const { createProtonFetcher } = await import("./imapNative");
    const inner = createProtonFetcher(
      creds,
      mailboxId,
      stored?.uid && stored.accessToken
        ? {
            uid: stored.uid,
            accessToken: stored.accessToken,
            refreshToken: stored.refreshToken ?? "",
          }
        : null,
      async (session) => {
        await saveTokens(mailboxId, {
          uid: session.uid,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          accountHint: creds.username,
        });
      },
    );
    return {
      async fetchMessages(opts) {
        try {
          return await inner.fetchMessages(opts);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "proton fetch failed";
          throw new MailScanUnverifiedError(message);
        }
      },
    };
  }
  if (providerId === "tuta") {
    const creds = await loadPasswordMailCredentials("tuta", mailboxId);
    if (!creds) {
      throw new MailConnectError("tuta is not connected");
    }
    const { createPasswordMailFetcher } = await import("./imapNative");
    const inner = createPasswordMailFetcher("tuta", creds, mailboxId);
    return {
      async fetchMessages(opts) {
        try {
          return await inner.fetchMessages(opts);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "tuta fetch failed";
          throw new MailScanUnverifiedError(message);
        }
      },
    };
  }

  const tokens = await loadTokens(mailboxId);
  if (!tokens?.accessToken) {
    throw new MailConnectError("Not connected");
  }
  if (providerId === "gmail" || providerId === "workspace") {
    return createGmailFetcher(tokens.accessToken, mailboxId);
  }
  if (providerId === "outlook" || providerId === "office365") {
    return createGraphFetcher(tokens.accessToken, mailboxId);
  }
  if (providerId === "fastmail") {
    return createJmapFetcher(tokens.accessToken, mailboxId);
  }
  if (providerId === "zoho") {
    return createZohoFetcher(tokens.accessToken, mailboxId);
  }
  return {
    async fetchMessages() {
      throw new MailScanUnverifiedError(
        `${providerId} scan is implemented but not live-tested in Phase 4.`,
      );
    },
  };
}

export function createMailProvider(
  providerId: MailProviderId,
  userId: string,
): MailProvider {
  return {
    id: providerId,
    async connect() {
      if (providerId === "imap") {
        throw new MailConnectError("IMAP uses the IMAP form, not OAuth");
      }
      if (providerId === "proton" || providerId === "tuta") {
        throw new MailConnectError(
          `${providerId} uses the password sheet, not OAuth`,
        );
      }
      await connectOAuthAndRecord(providerId, userId);
    },
    async disconnect() {
      throw new MailConnectError("Use disconnectMailbox(mailboxId)");
    },
    async isConnected() {
      const { listMailboxesAsync } = await import("./persist");
      const boxes = await listMailboxesAsync();
      return boxes.some((b) => b.providerId === providerId);
    },
    async scan(opts) {
      const box = opts?.mailboxId;
      if (!box) {
        throw new MailConnectError("scan needs a mailboxId");
      }
      const fetcher = await fetcherFor(providerId, userId, box);
      return runPersistedScan({
        mailboxId: box,
        providerId,
        fetcher,
      });
    },
  };
}

export async function connectOAuthAndRecord(
  providerId: MailProviderId,
  userId: string,
): Promise<string> {
  const tokens = await promptOAuth(providerId, userId);
  const hint = await accountHintFromToken(providerId, tokens.accessToken);
  const mailboxId = mailboxIdFor(providerId, hint);
  await saveTokens(mailboxId, { ...tokens, accountHint: hint });
  const { saveMailboxAsync } = await import("./persist");
  await saveMailboxAsync({
    mailboxId,
    providerId,
    cursor: {
      mailboxId,
      lastMessageDate: null,
      lastMessageId: null,
      parserVersion: 1,
    },
    messages: {},
  });
  return mailboxId;
}

export async function disconnectMailbox(
  mailboxId: string,
  providerId: MailProviderId,
): Promise<void> {
  if (providerId === "proton" || providerId === "tuta") {
    await SecureStore.deleteItemAsync(passwordKey(providerId, mailboxId));
    if (providerId === "proton") {
      await SecureStore.deleteItemAsync(tokenKey(mailboxId));
    }
  } else if (providerId === "imap") {
    await SecureStore.deleteItemAsync(imapKey(mailboxId));
  } else {
    await SecureStore.deleteItemAsync(tokenKey(mailboxId));
  }
  const { clearMailboxAsync } = await import("./persist");
  await clearMailboxAsync(mailboxId);
}

export async function connectImapAndRecord(
  creds: ImapCredentials,
  label?: string,
): Promise<string> {
  const mailboxId = mailboxIdFor("imap", creds.username);
  await saveImapCredentials(mailboxId, creds);
  const { saveMailboxAsync } = await import("./persist");
  await saveMailboxAsync({
    mailboxId,
    providerId: "imap",
    cursor: {
      mailboxId,
      lastMessageDate: null,
      lastMessageId: null,
      parserVersion: 1,
    },
    messages: {},
  });
  return mailboxId;
}

export async function connectPasswordMailAndRecord(
  providerId: "proton" | "tuta",
  creds: PasswordMailCredentials,
): Promise<string> {
  const mailboxId = mailboxIdFor(providerId, creds.username);
  await savePasswordMailCredentials(providerId, mailboxId, creds);
  const { saveMailboxAsync } = await import("./persist");
  await saveMailboxAsync({
    mailboxId,
    providerId,
    cursor: {
      mailboxId,
      lastMessageDate: null,
      lastMessageId: null,
      parserVersion: 1,
    },
    messages: {},
  });
  return mailboxId;
}

export type { IncrementalScanResult };
