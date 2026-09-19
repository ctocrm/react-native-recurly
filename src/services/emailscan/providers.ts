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
import { classifySubject } from "./classifier";
import { ensureOnline, feedScanWatchdog } from "./scanWatchdog";
import {
  refreshAccessToken,
  TokenRefreshRejectedError,
  tokenNeedsRefresh,
} from "./oauthRefresh";
import {
  createTokenSession,
  LiveToken,
  type TokenSession,
} from "./oauthSession";
import {
  acquireTokenInteractively,
  acquireTokenSilently,
  buildMsalFailureMessage,
  classifyMsalError,
} from "./msalAuth";
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
  /** MSAL account id (Microsoft accounts only, M2). Present → silent token
   * acquisition goes through MSAL's encrypted cache; the provider refresh
   * token is NOT stored for these accounts (it lives inside MSAL). */
  msalAccountId?: string;
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

// Google's secure-response-handling policy rejects arbitrary custom schemes
// (Error 400: invalid_request on `cadence://auth`). Native Google OAuth
// clients must redirect via the reverse-client-ID scheme instead. The same
// scheme must be registered as an intent filter on MainActivity.
function googleRedirectUri(clientId: string): string {
  const bare = clientId.replace(/\.apps\.googleusercontent\.com$/, "");
  return `com.googleusercontent.apps.${bare}:/oauthredirect`;
}

/**
 * Microsoft accounts authenticate through the official MSAL SDK (M2): the
 * full MSA journey — including any emailed verification-code challenge —
 * runs inside MSAL's managed auth surface. No provider refresh token is
 * stored: the refresh token lives in MSAL's encrypted cache and is consumed
 * via acquireTokenSilent (token reuse when valid). A failed/cancelled
 * attempt is never retried automatically (MSA challenge bombardment,
 * 2026-09-04).
 */
async function msalTokenBlob(): Promise<TokenBlob> {
  try {
    const result = await acquireTokenInteractively();
    return {
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
      msalAccountId: result.accountId,
    };
  } catch (error) {
    throw new MailConnectError(buildMsalFailureMessage(error, "Microsoft"));
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
  // Microsoft accounts go through the official MSAL SDK (M2): the full MSA
  // journey — including any emailed verification-code challenge — runs in
  // MSAL's managed surface. See msalTokenBlob above.
  if (providerId === "outlook" || providerId === "office365") {
    return msalTokenBlob();
  }
  const spec = oauthSpec(providerId);
  // Google requires the reverse-client-ID redirect (secure-response-handling
  // policy); every other provider keeps the cadence:// custom scheme.
  const redirectUri =
    providerId === "gmail" || providerId === "workspace"
      ? googleRedirectUri(clientId)
      : AuthSession.makeRedirectUri({
          scheme: "cadence",
          native: "cadence://auth",
        });
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
  let accessToken = params.access_token || params.accessToken;
  let refreshToken = params.refresh_token || params.refreshToken;
  let expiresAt = params.expires_in
    ? Date.now() + Number.parseInt(params.expires_in, 10) * 1000
    : undefined;

  if (!accessToken && params.code) {
    // PKCE / authorization-code flow: the redirect carries `code`, not an
    // access token. Exchange it at the provider's token endpoint. SDK 54 has
    // no `codeVerifier` field on token requests, so it rides via extraParams.
    if (!request.codeVerifier) {
      throw new MailConnectError(
        "OAuth PKCE verifier missing for code exchange.",
      );
    }
    const token = await AuthSession.exchangeCodeAsync(
      {
        clientId,
        code: params.code,
        redirectUri,
        scopes: spec.scopes,
        extraParams: { code_verifier: request.codeVerifier },
      },
      { tokenEndpoint: spec.tokenEndpoint },
    );
    accessToken = token.accessToken;
    refreshToken = token.refreshToken ?? refreshToken;
    expiresAt = token.expiresIn ? Date.now() + token.expiresIn * 1000 : expiresAt;
  }

  if (!accessToken) {
    throw new MailConnectError("OAuth returned no access token");
  }
  return { accessToken, refreshToken, expiresAt };
}

async function accountHintFromToken(
  providerId: MailProviderId,
  accessToken: string,
): Promise<string> {
  try {
    if (providerId === "gmail" || providerId === "workspace") {
      const res = await fetchWithTimeout(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (res.ok) {
        const json = (await res.json()) as { emailAddress?: string };
        if (json.emailAddress) return json.emailAddress;
      }
    }
    if (providerId === "outlook" || providerId === "office365") {
      const res = await fetchWithTimeout("https://graph.microsoft.com/v1.0/me", {
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

/** Provider scan errors must surface the reason: pull the API's error
 * message out of the response body (Gmail/Graph nest it under `error`). */
async function providerErrorReason(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as {
      error?: { message?: string } | string;
      error_description?: string;
      message?: string;
    };
    if (typeof json.error === "object" && json.error?.message) {
      return json.error.message;
    }
    if (typeof json.error === "string") {
      return json.error_description
        ? `${json.error} (${json.error_description})`
        : json.error;
    }
    if (json.message) return json.message;
  } catch {
    // Non-JSON body - nothing useful to surface.
  }
  return "";
}

/**
 * R17: the ONE authed-request path for the OAuth JSON fetchers (Graph, Zoho,
 * JMAP — Gmail keeps its own quota-paced loop but uses the same session).
 * Proactive: `session.valid()` refreshes BEFORE the request when remaining
 * token life is under the request margin, so an expiring token can never
 * reach the provider (the 2026-09-06 Gmail mid-leg 401 class). Reactive
 * backstop: a 401 still forces one refresh and one replay, bounded per
 * request, for early server-side revocation.
 */
async function fetchWithSession(
  session: TokenSession,
  url: string,
  init: RequestInit | undefined,
  scheme: (token: string) => string,
  label: string,
): Promise<Response> {
  const token = await session.valid();
  const res = await fetchWithTimeout(url, {
    ...init,
    headers: { ...init?.headers, Authorization: scheme(token) },
  });
  if (res.status !== 401) return res;
  console.log(
    `[${label}] 401 — access token rejected; refreshing and retrying once`,
  );
  const next = await session.force();
  if (!next || next === token) return res;
  return fetchWithTimeout(url, {
    ...init,
    headers: { ...init?.headers, Authorization: scheme(next) },
  });
}

export function createGmailFetcher(
  /** R17: expiry-aware session — proactive refresh + 401 backstop. */
  session: TokenSession,
  mailboxId: string,
): MessageFetcher {
  // Gmail API quota (2026-09-05: the Workspace leg died with a 403 "Total
  // Query Cost / Units per minute per user" because list + per-message
  // metadata GETs + body GETs fired back-to-back). Pace every Gmail call to
  // MIN_INTERVAL_MS between request starts, and treat a quota 403/429 as
  // retryable after a ~60s backoff (once) instead of failing the whole leg.
  // Live evidence for 500ms: at 250ms the leg clipped the per-minute ceiling
  // every ~2min (four backoff-recoveries in 9min); 500ms stays under it —
  // slightly slower calls, but no 60s stalls.
  const MIN_INTERVAL_MS = 500;
  const QUOTA_BACKOFF_MS = 60_000;
  const MAX_BACKOFF_MS = 120_000;
  let nextSlot = 0;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function gmailApi(url: string): Promise<Response> {
    let refreshed = false;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      // R17: proactive — a token within the request margin of expiry is
      // refreshed BEFORE the request fires, so the provider never has to
      // 401 us (the 2026-09-06 page-21 mid-leg 401 class).
      const token = await session.valid();
      const wait = nextSlot - Date.now();
      if (wait > 0) await sleep(wait);
      nextSlot = Date.now() + MIN_INTERVAL_MS;
      const res = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Backstop only: early server-side revocation. Bounded once per
      // request so a dead session still fails boundedly.
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        console.log(
          "[MailGmail] 401 — access token rejected; refreshing and retrying once",
        );
        const next = await session.force();
        if (next && next !== token) {
          attempt -= 1; // replay the same attempt; quota budget untouched
          continue;
        }
      }
      if (res.ok) return res;
      const reason = await providerErrorReason(res);
      const quotaLimited =
        res.status === 429 ||
        (res.status === 403 &&
          /quota|rate ?limit|rate ?exceeded|userRateLimitExceeded/i.test(
            reason,
          ));
      if (!quotaLimited) return res;
      if (attempt === 2) {
        throw new MailScanUnverifiedError(
          "Gmail API quota exceeded — Google is rate limiting this app for your account. Try the scan again in a few minutes.",
        );
      }
      const retryAfter = Number(res.headers?.get?.("retry-after"));
      const backoffMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, MAX_BACKOFF_MS)
          : QUOTA_BACKOFF_MS;
      console.log(
        `[MailGmail] quota limited (${res.status}) — backing off ${Math.round(
          backoffMs / 1000,
        )}s, then one retry`,
      );
      // F-4: a quota backoff is server-acknowledged progress (the API told
      // us to wait); feed so a legitimate ≤120s backoff cannot be
      // stall-killed by the no-progress clock.
      feedScanWatchdog();
      await sleep(backoffMs);
    }
    // Unreachable: the loop either returns or throws.
    throw new MailScanUnverifiedError("Gmail API request failed");
  }

  return {
    async fetchMessages({ since, limit }, onChunk) {
      const pageLimit = Math.min(limit, 100);
      const qParts = [SUBJECT_QUERY];
      if (since?.date) {
        const day = since.date.slice(0, 10).replace(/-/g, "/");
        qParts.push(`after:${day}`);
      }
      let pageToken: string | undefined;
      let pages = 0;
      let listed = 0;
      let bodies = 0;
      // Phase K: provider-reported listing total for the in-app gauge.
      let estimate: number | null = null;
      // Proton/Tuta staging: list ids paged, screen on cheap metadata, and
      // pull full bodies only for subjects the classifier will actually use
      // (recurring/sparse need bodies; drop/account/security never do).
      do {
        const params = new URLSearchParams({
          q: qParts.join(" "),
          maxResults: String(pageLimit),
        });
        if (pageToken) params.set("pageToken", pageToken);
        const listRes = await gmailApi(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
        );
        if (!listRes.ok) {
          const reason = await providerErrorReason(listRes);
          throw new MailScanUnverifiedError(
            `Gmail list failed (${listRes.status})${reason ? `: ${reason}` : ""}`,
          );
        }
        const listJson = (await listRes.json()) as {
          messages?: { id: string }[];
          nextPageToken?: string;
          resultSizeEstimate?: number;
        };
        pageToken = listJson.nextPageToken;
        if (typeof listJson.resultSizeEstimate === "number") {
          estimate = listJson.resultSizeEstimate;
        }
        pages += 1;
        const ids = (listJson.messages || []).map((m) => m.id);
        listed += ids.length;
        // R14 breadcrumbs: any future stall's last log line pinpoints the
        // park point (which page, how deep into the screening loop).
        console.log(`[MailGmail] page ${pages}: +${ids.length} ids (total ${listed})`);

        // R19-OOM: bodies accumulate for ONE page only, then flush to the
        // scan before the next page is listed.
        const pageMsgs: NormalizedMessage[] = [];
        let screened = 0;
        for (const id of ids) {
          screened += 1;
          if (screened % 25 === 0) {
            console.log(`[MailGmail] screening ${screened}/${ids.length} on page ${pages}`);
          }
          const metaRes = await gmailApi(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Id&metadataHeaders=Precedence`,
          );
          if (!metaRes.ok) continue;
          const meta = (await metaRes.json()) as {
            id?: string;
            labelIds?: string[];
            payload?: { headers?: { name: string; value: string }[] };
          };
          const headers = meta.payload?.headers ?? [];
          const subject = headerOf(headers, "Subject");
          const cls = classifySubject(subject);
          if (cls !== "recurring" && cls !== "sparse") continue;

          // R27: provider hints are optional scoring weights. Gmail's system
          // category (CATEGORY_PROMOTIONS…) rides on the metadata response,
          // and the bulk-sender headers (RFC 8058; Google sender guidelines)
          // are only returned when named in metadataHeaders. Absent = unset —
          // other providers classify without them.
          const gmailCategory = (meta.labelIds ?? []).find((l) =>
            l.startsWith("CATEGORY_"),
          );
          const listUnsubscribe = headerOf(headers, "List-Unsubscribe");
          const listId = headerOf(headers, "List-Id");
          const precedence = headerOf(headers, "Precedence");
          const hints =
            gmailCategory || listUnsubscribe || listId || precedence
              ? {
                  gmailCategory: gmailCategory || undefined,
                  listUnsubscribe: Boolean(listUnsubscribe),
                  listId: listId || undefined,
                  precedence: precedence || undefined,
                }
              : undefined;

          const fullRes = await gmailApi(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          );
          if (!fullRes.ok) continue;
          const raw = await fullRes.json();
          const body = gmailBody(raw.payload);
          const parsed = new Date(headerOf(headers, "Date"));
          pageMsgs.push({
            mailboxId,
            messageId: meta.id || id,
            from: headerOf(headers, "From"),
            subject,
            date: Number.isNaN(parsed.getTime())
              ? new Date().toISOString()
              : parsed.toISOString(),
            text: body.text,
            html: body.html,
            attachments: gmailAttachments(raw.payload),
            hints,
          });
          bodies += 1;
        }
        await onChunk(pageMsgs, { listed, total: estimate });
        // F-4 (2026-09-14 baseline): INITIAL_SCAN_LIMIT was passed down but
        // only capped the page size — a mailbox with more matches listed
        // forever (witnessed: 2000+ ids listed against limit=500, the leg
        // ran 52 minutes). Bound the walk: stop once listed reaches limit.
      } while (pageToken && listed < limit);
      if (pageToken) {
        console.log(
          `[MailGmail] limit ${limit} reached — truncating listing at ${listed} ids (more pages existed)`,
        );
      }
      console.log(
        `[MailGmail] listed ${listed} pages=${pages} bodies=${bodies} of ${listed}`,
      );
    },
  };
}

export function createGraphFetcher(
  /** R17: expiry-aware session — proactive refresh + 401 backstop. */
  session: TokenSession,
  mailboxId: string,
): MessageFetcher {
  return {
    async fetchMessages({ since, limit }, onChunk) {
      let pages = 0;
      let listed = 0;
      let bodies = 0;
      let graphTotal: number | null = null;
      // Proton/Tuta staging: Graph's list returns screening fields directly
      // ($select — no separate metadata pass), pages are followed via
      // @odata.nextLink, and bodies ($select=body) load only for subjects the
      // classifier will actually use.
      let url: string | null =
        (() => {
          const params = new URLSearchParams({
            $top: String(Math.min(limit, 100)),
            // R27: internetMessageHeaders rides the list call — Graph returns
            // a SUBSET of internet headers there (no extra request). Bulk
            // hints (List-Unsubscribe/List-Id/Precedence) are parsed when
            // present; absence is neutral, never a negative.
            $select:
              "id,subject,from,receivedDateTime,internetMessageHeaders",
            // Phase K: ask for @odata.count so the gauge has a real total.
            $count: "true",
          });
          if (since?.date) {
            params.set("$filter", `receivedDateTime gt ${since.date}`);
          }
          return `https://graph.microsoft.com/v1.0/me/messages?${params}`;
        })();
      while (url) {
        const res = await fetchWithSession(
          session,
          url,
          undefined,
          (t) => `Bearer ${t}`,
          "MailGraph",
        );
        if (!res.ok) {
          const reason = await providerErrorReason(res);
          throw new MailScanUnverifiedError(
            `Graph list failed (${res.status})${reason ? `: ${reason}` : ""}`,
          );
        }
        const json = (await res.json()) as {
          value?: {
            id: string;
            subject?: string;
            from?: { emailAddress?: { address?: string; name?: string } };
            receivedDateTime?: string;
            internetMessageHeaders?: { name?: string; value?: string }[];
          }[];
          "@odata.nextLink"?: string;
          "@odata.count"?: number;
        };
        url = json["@odata.nextLink"] ?? null;
        if (typeof json["@odata.count"] === "number") {
          graphTotal = json["@odata.count"];
        }
        pages += 1;
        const items = json.value || [];
        listed += items.length;

        // R19-OOM: bodies accumulate for ONE page only, then flush to the
        // scan (which classifies and stores stripped copies immediately).
        // Never hold the whole leg's bodies — that is what exhausted the
        // Java heap mid-leg on 2026-09-07.
        const pageMsgs: NormalizedMessage[] = [];
        // R27: bulk-sender hints from the list response's header subset.
        const graphHeader = (
          headers: { name?: string; value?: string }[] | undefined,
          name: string,
        ): string | undefined =>
          headers?.find(
            (h) => (h.name ?? "").toLowerCase() === name.toLowerCase(),
          )?.value;
        for (const m of items) {
          const addr = m.from?.emailAddress?.address || "";
          const name = m.from?.emailAddress?.name;
          const from = name ? `${name} <${addr}>` : addr;
          const subject = m.subject || "";
          const cls = classifySubject(subject);
          if (cls !== "recurring" && cls !== "sparse") continue;

          const gListUnsub = graphHeader(
            m.internetMessageHeaders,
            "List-Unsubscribe",
          );
          const gListId = graphHeader(m.internetMessageHeaders, "List-Id");
          const gPrecedence = graphHeader(
            m.internetMessageHeaders,
            "Precedence",
          );
          const hints =
            gListUnsub || gListId || gPrecedence
              ? {
                  listUnsubscribe: Boolean(gListUnsub),
                  listId: gListId || undefined,
                  precedence: gPrecedence || undefined,
                }
              : undefined;

          const bodyRes = await fetchWithSession(
            session,
            `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(
              m.id,
            )}?$select=body`,
            undefined,
            (t) => `Bearer ${t}`,
            "MailGraph",
          );
          if (!bodyRes.ok) continue;
          const bj = (await bodyRes.json()) as {
            body?: { contentType?: string; content?: string };
          };
          const html =
            bj.body?.contentType?.toLowerCase() === "html"
              ? bj.body.content
              : undefined;
          const text =
            bj.body?.contentType?.toLowerCase() === "text"
              ? bj.body.content
              : undefined;
          pageMsgs.push({
            mailboxId,
            messageId: m.id,
            from,
            subject,
            date: m.receivedDateTime || new Date().toISOString(),
            text,
            html,
            hints,
          });
          bodies += 1;
        }
        await onChunk(pageMsgs, { listed, total: graphTotal });
        // F-4: same limit enforcement as the Gmail loop — Graph walked
        // @odata.nextLink without ever checking the requested limit.
        if (listed >= limit) url = null;
      }
      if (url) {
        console.log(
          `[MailGraph] limit ${limit} reached — truncating listing at ${listed} ids (more pages existed)`,
        );
      }
      console.log(
        `[MailGraph] listed ${listed} pages=${pages} bodies=${bodies} of ${listed}`,
      );
    },
  };
}

export function createZohoFetcher(
  /** R17: expiry-aware session — Zoho tokens expire in 1h; this fetcher
   * previously had NO refresh path at all (the next live 401 waiting to
   * happen). */
  session: TokenSession,
  mailboxId: string,
): MessageFetcher {
  return {
    async fetchMessages({ since, limit }, onChunk) {
      const accRes = await fetchWithSession(
        session,
        "https://mail.zoho.com/api/accounts",
        undefined,
        (t) => `Zoho-oauthtoken ${t}`,
        "MailZoho",
      );
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
      const res = await fetchWithSession(
        session,
        `https://mail.zoho.com/api/accounts/${accountId}/messages/search?${params}`,
        undefined,
        (t) => `Zoho-oauthtoken ${t}`,
        "MailZoho",
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
      // R19-OOM: stream the single search batch; bounded by the search limit.
      // Phase K: Zoho's search API exposes no listing total — count only.
      const rows = json.data || [];
      await onChunk(
        rows.map((m) => {
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
        }),
        { listed: rows.length, total: null },
      );
    },
  };
}

export function createJmapFetcher(
  /** R17: expiry-aware session (passthrough for Fastmail's long-lived
   * tokens — no expiresAt means `valid()` never refreshes). */
  session: TokenSession,
  mailboxId: string,
): MessageFetcher {
  return {
    async fetchMessages({ since, limit }, onChunk) {
      const sessionRes = await fetchWithSession(
        session,
        "https://api.fastmail.com/jmap/session",
        undefined,
        (t) => `Bearer ${t}`,
        "MailJmap",
      );
      if (!sessionRes.ok) {
        throw new MailScanUnverifiedError(
          `Fastmail session failed (${sessionRes.status})`,
        );
      }
      const jmapSession = await sessionRes.json();
      const apiUrl = jmapSession.apiUrl as string;
      const accountId = Object.keys(jmapSession.accounts || {})[0];
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
            // Phase K: best-effort total — honored only if the bridge supports it.
            calculateTotal: true,
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
      const res = await fetchWithSession(
        session,
        apiUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
            methodCalls: query,
          }),
        },
        (t) => `Bearer ${t}`,
        "MailJmap",
      );
      if (!res.ok) {
        throw new MailScanUnverifiedError(`JMAP get failed (${res.status})`);
      }
      const json = await res.json();
      const getCall = (json.methodResponses || []).find(
        (c: unknown[]) => c[0] === "Email/get",
      );
      const list = getCall?.[1]?.list || [];
      // Phase K: JMAP Email/query reports `total` when calculateTotal was
      // requested AND the bridge honors it; otherwise unknown (null).
      const queryCall = (json.methodResponses || []).find(
        (c: unknown[]) => c[0] === "Email/query",
      );
      const queryTotal = queryCall?.[1]?.total;
      const jmapTotal: number | null =
        typeof queryTotal === "number" ? queryTotal : null;
      // R19-OOM: stream the single Email/get batch; bounded by the query limit.
      await onChunk(
        list.map((m: any) => {
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
        }),
        { listed: list.length, total: jmapTotal },
      );
    },
  };
}

/**
 * fetch that can never hang: rejects after `timeoutMs` (default 20s) AND
 * aborts the underlying request natively so a timed-out call cannot leak
 * its socket. A black-holed socket must surface as a per-mailbox error
 * instead of freezing the whole scan loop (R9: the 2026-09-03 18-min scan
 * hang).
 *
 * F-4 (2026-09-14 baseline): settled HTTP calls NO LONGER feed the R14
 * watchdog. A page walk completes one metadata call every couple of
 * seconds while real ingestion is wedged, so per-call feeding kept the
 * 180s no-progress clock alive through a 13-minute stall (the leg only
 * "resumed" when the wedge lifted). Progress is fed per flushed chunk in
 * runIncrementalScan — data that reached the scan, not sockets that moved.
 */
async function fetchOnce(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * fetchWithTimeout (R9/R12/R14) + the R15 offline gate: never fetch into a
 * dead network. Offline -> pause on the native reconnect event (user sees a
 * Toast; the leg resumes where it stopped). If the network dies MID-request,
 * wait for reconnection and retry the same request once. Only a pause that
 * outlasts ONLINE_WAIT_MS fails the leg - boundedly, like every other path.
 */
async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 20_000,
): Promise<Response> {
  if (!(await ensureOnline())) {
    throw new Error(
      "network offline - scan paused too long; try again when you are back online",
    );
  }
  try {
    return await fetchOnce(url, init, timeoutMs);
  } catch (error) {
    if (!(await ensureOnline())) throw error;
    return await fetchOnce(url, init, timeoutMs);
  }
}

// A Google/Microsoft access token lives ~3600s. R1 refreshes when already
// expired, but a long scan leg outlives a token that is merely "not yet
// expired" at leg start (2026-09-06: a ~35min Gmail leg 401'd 34s after a
// token with 34min of remaining life). Legs therefore demand a larger
// remaining-lifetime margin: refresh unless at least this much is left.
const OAUTH_LEG_MIN_LIFETIME_MS = 40 * 60_000;

/**
 * Refresh-before-list glue: if the stored access token is expired (or within
 * the skew margin) and a refresh token exists, mint a fresh one at the
 * provider's token endpoint and persist it. A rejected refresh token can only
 * be fixed by a fresh interactive sign-in, so that surfaces as an explicit
 * reconnect error; transient failures (network, 5xx) fall back to the stored
 * token and let the actual list call report any error.
 */
async function ensureFreshOAuthTokens(
  providerId: MailProviderId,
  mailboxId: string,
  tokens: TokenBlob,
  opts?: { force?: boolean; minRemainingMs?: number },
): Promise<TokenBlob> {
  // MSAL accounts (M2): token reuse when valid — acquireTokenSilent serves
  // MSAL's encrypted cache and refreshes internally; interaction-required
  // maps to the same honest reconnect error as a rejected refresh token.
  // No auto-retries (see msalAuth.ts).
  if (
    (providerId === "outlook" || providerId === "office365") &&
    tokens.msalAccountId
  ) {
    try {
      const result = await acquireTokenSilently(tokens.msalAccountId);
      const next: TokenBlob = {
        ...tokens,
        accessToken: result.accessToken,
        expiresAt: result.expiresAt ?? tokens.expiresAt,
      };
      await saveTokens(mailboxId, next);
      console.log(`[MailOAuth] ${providerId} MSAL silent token ok (${mailboxId})`);
      return next;
    } catch (error) {
      const kind = classifyMsalError(error);
      if (kind === "reconnect") {
        throw new MailScanUnverifiedError(
          `${providerId} sign-in expired — reconnect the mailbox (Edit → Reconnect) to scan it.`,
        );
      }
      console.log(
        `[MailOAuth] ${providerId} MSAL silent acquisition failed (${kind}); using stored token`,
      );
      return tokens;
    }
  }
  const stale = tokenNeedsRefresh(tokens, Date.now(), opts?.minRemainingMs);
  if (!tokens.refreshToken) {
    console.log(
      `[MailScan] ${providerId} ${mailboxId} token ${stale ? "expired but no refresh token" : "fresh"} — using as-is`,
    );
    return tokens;
  }
  if (!stale && !opts?.force) {
    console.log(`[MailScan] ${providerId} ${mailboxId} token fresh — using as-is`);
    return tokens;
  }
  const clientId = oauthClientId(providerId);
  if (!clientId) return tokens;
  console.log(
    `[MailScan] ${providerId} ${mailboxId} token ${
      opts?.force
        ? "rejected mid-leg — force refresh"
        : "expired or below leg lifetime margin"
    } — refreshing`,
  );
  try {
    const refreshed = await refreshAccessToken({
      tokenEndpoint: oauthSpec(providerId).tokenEndpoint,
      clientId,
      refreshToken: tokens.refreshToken,
    });
    const next: TokenBlob = {
      ...tokens,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
      expiresAt: refreshed.expiresAt ?? tokens.expiresAt,
    };
    await saveTokens(mailboxId, next);
    console.log(`[MailOAuth] ${providerId} access token refreshed (${mailboxId})`);
    return next;
  } catch (error) {
    if (error instanceof TokenRefreshRejectedError) {
      throw new MailScanUnverifiedError(
        `${providerId} sign-in expired — reconnect the mailbox (Edit → Reconnect) to scan it.`,
      );
    }
    console.log(
      `[MailOAuth] ${providerId} token refresh failed; retrying with stored token`,
    );
    return tokens;
  }
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
      async fetchMessages(opts, onChunk) {
        try {
          return await inner.fetchMessages(opts, onChunk);
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
      async fetchMessages(opts, onChunk) {
        try {
          return await inner.fetchMessages(opts, onChunk);
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
    const inner = createPasswordMailFetcher(creds, mailboxId);
    return {
      async fetchMessages(opts, onChunk) {
        try {
          return await inner.fetchMessages(opts, onChunk);
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
  console.log(`[MailScan] fetcherFor ${providerId} ${mailboxId}`);
  // Refresh-before-list: OAuth access tokens expire long before a typical
  // re-scan; without this every scan after ~1h failed with a provider 401.
  // The leg-lifetime margin additionally refreshes a token whose REMAINING
  // life is shorter than a typical long leg, not just one already expired.
  const fresh = await ensureFreshOAuthTokens(providerId, mailboxId, tokens, {
    minRemainingMs: OAUTH_LEG_MIN_LIFETIME_MS,
  });
  // R17: every OAuth fetcher runs on an expiry-aware token session. A token
  // within REQUEST_LIFETIME_MARGIN_MS of expiry is refreshed BEFORE the next
  // request fires (single-flight; the refresh persists via
  // ensureFreshOAuthTokens so loadTokens picks up rotation), so the provider
  // never has to 401 us. The 401 backstop inside the fetchers remains for
  // early server-side revocation; a rejected refresh token still surfaces
  // the explicit reconnect error mid-leg - honest and bounded.
  const refreshMidLeg = async (): Promise<LiveToken | null> => {
    const latest = (await loadTokens(mailboxId)) ?? tokens;
    const next = await ensureFreshOAuthTokens(providerId, mailboxId, latest, {
      force: true,
    });
    return next.accessToken
      ? { accessToken: next.accessToken, expiresAt: next.expiresAt }
      : null;
  };
  const session = createTokenSession(
    { accessToken: fresh.accessToken, expiresAt: fresh.expiresAt },
    refreshMidLeg,
  );
  if (providerId === "gmail" || providerId === "workspace") {
    return createGmailFetcher(session, mailboxId);
  }
  if (providerId === "outlook" || providerId === "office365") {
    return createGraphFetcher(session, mailboxId);
  }
  if (providerId === "fastmail") {
    return createJmapFetcher(session, mailboxId);
  }
  if (providerId === "zoho") {
    return createZohoFetcher(session, mailboxId);
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
        onLegProgress: opts?.onLegProgress,
        deep: opts?.deep,
        onListProgress: opts?.onListProgress,
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
