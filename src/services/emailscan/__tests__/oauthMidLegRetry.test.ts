/**
 * Mid-leg OAuth 401 handling (R16). Live evidence 2026-09-06: the Workspace
 * Gmail leg ran ~35min; the access token minted 14:04 expired 15:04 and page
 * 21's list call 401'd ("Gmail list failed (401)"). The R1 leg-start refresh
 * only rejects tokens already expired at leg start — a token with 34 minutes
 * of remaining life passes that check and still dies mid-leg.
 *
 * Covered here:
 * - Gmail list 401 -> one forced token refresh -> replay succeeds, leg completes
 * - the replay (and later calls in the leg) carry the NEW bearer token
 * - a 401 that survives the refresh fails boundedly with exactly one refresh
 * - no refresh hook wired -> 401 fails boundedly (pre-R16 behavior pinned)
 * - Graph list 401 -> one refresh -> replay succeeds
 */

import {
  createGmailFetcher,
  createGraphFetcher,
  MailScanUnverifiedError,
} from "../providers";

// providers.ts pulls in native modules its Gmail/Graph fetchers never touch.
// Mock them so the suite runs in plain node (these paths only need fetch).
jest.mock("../persist", () => ({ runPersistedScan: jest.fn() }));
jest.mock("expo-auth-session", () => ({}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock("../oauthRefresh", () => ({
  refreshAccessToken: jest.fn(),
  tokenNeedsRefresh: jest.fn(),
  TokenRefreshRejectedError: class TokenRefreshRejectedError extends Error {},
}));
jest.mock("../msalAuth", () => ({
  acquireTokenInteractively: jest.fn(),
  acquireTokenSilently: jest.fn(),
  buildMsalFailureMessage: jest.fn(() => ""),
  classifyMsalError: jest.fn(() => "unknown"),
}));

const GMAIL_LIST_URL = "gmail/v1/users/me/messages?";
const GMAIL_META_URL = "format=metadata";
const GMAIL_FULL_URL = "format=full";
const GRAPH_URL = "graph.microsoft.com/v1.0/me/messages";

interface FetchCall {
  url: string;
  auth: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

function listBody(ids: string[]) {
  return { messages: ids.map((id) => ({ id })) };
}

function metaBody() {
  return {
    id: "msg-1",
    payload: {
      headers: [
        { name: "Subject", value: "Your Prime membership renewal" },
        { name: "From", value: "Amazon Prime <noreply@amazon.com>" },
        { name: "Date", value: "2026-08-01T12:00:00.000Z" },
      ],
    },
  };
}

function gmailFullBody() {
  const text = "Your Prime membership renews for $14.99 /mo.";
  const data = Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { payload: { mimeType: "text/plain", body: { data } } };
}

function graphListBody() {
  return {
    value: [
      {
        id: "m1",
        subject: "Your Prime membership renewal",
        from: {
          emailAddress: { address: "noreply@amazon.com", name: "Amazon Prime" },
        },
        receivedDateTime: "2026-08-01T12:00:00.000Z",
      },
    ],
  };
}

describe("mid-leg OAuth 401 (R16)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  function installFetch(
    handler: (url: string, callNumber: number) => Response,
  ): FetchCall[] {
    const calls: FetchCall[] = [];
    global.fetch = jest.fn(
      (url: string, init?: { headers?: Record<string, string> }) => {
        calls.push({ url, auth: init?.headers?.Authorization ?? "" });
        return Promise.resolve(handler(url, calls.length));
      },
    ) as unknown as typeof fetch;
    return calls;
  }

  test("Gmail list 401 refreshes once, replays with the new token, leg completes", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const refresh = jest.fn(async () => "token-2");
    const calls = installFetch((url, n) => {
      if (url.includes(GMAIL_LIST_URL) && n === 1) {
        return jsonResponse(401, { error: "invalid credentials" });
      }
      if (url.includes(GMAIL_LIST_URL)) return jsonResponse(200, listBody(["msg-1"]));
      if (url.includes(GMAIL_META_URL)) return jsonResponse(200, metaBody());
      if (url.includes(GMAIL_FULL_URL)) return jsonResponse(200, gmailFullBody());
      return jsonResponse(404, {});
    });

    const fetcher = createGmailFetcher("token-1", "workspace-1", refresh);
    const promise = fetcher.fetchMessages({
      mailboxId: "workspace-1",
      since: null,
      limit: 100,
    });
    for (let i = 0; i < 12; i += 1) {
      await jest.advanceTimersByTimeAsync(10_000);
    }
    const result = await promise;

    expect(refresh).toHaveBeenCalledTimes(1);
    // list(401 with token-1) -> replay(list with token-2) -> meta -> full
    expect(calls).toHaveLength(4);
    expect(calls[0].auth).toBe("Bearer token-1");
    expect(calls[1].auth).toBe("Bearer token-2");
    expect(calls[2].auth).toBe("Bearer token-2");
    expect(calls[3].auth).toBe("Bearer token-2");
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe("Your Prime membership renewal");
  });

  test("Gmail 401 that survives the refresh fails boundedly after exactly one refresh", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const refresh = jest.fn(async () => "token-2");
    const calls = installFetch(() =>
      jsonResponse(401, { error: "invalid credentials" }),
    );

    const fetcher = createGmailFetcher("token-1", "workspace-1", refresh);
    const promise = fetcher.fetchMessages({
      mailboxId: "workspace-1",
      since: null,
      limit: 100,
    });
    const outcome = promise.then(
      () => "resolved",
      (error: unknown) => error,
    );
    for (let i = 0; i < 12; i += 1) {
      await jest.advanceTimersByTimeAsync(10_000);
    }
    const error = await outcome;

    expect(error).toBeInstanceOf(MailScanUnverifiedError);
    expect((error as Error).message).toContain("Gmail list failed (401)");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2); // original + one replay, then stop
  });

  test("Gmail 401 with no refresh hook fails boundedly (pre-R16 behavior)", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const calls = installFetch(() =>
      jsonResponse(401, { error: "invalid credentials" }),
    );

    const fetcher = createGmailFetcher("token-1", "workspace-1");
    const promise = fetcher.fetchMessages({
      mailboxId: "workspace-1",
      since: null,
      limit: 100,
    });
    const outcome = promise.then(
      () => "resolved",
      (error: unknown) => error,
    );
    await jest.advanceTimersByTimeAsync(250);
    const error = await outcome;

    expect(error).toBeInstanceOf(MailScanUnverifiedError);
    expect((error as Error).message).toContain("Gmail list failed (401)");
    expect(calls).toHaveLength(1);
  });

  test("Graph list 401 refreshes once and the leg completes", async () => {
    const refresh = jest.fn(async () => "token-2");
    const calls = installFetch((url, n) => {
      if (url.includes(GRAPH_URL) && n === 1) {
        return jsonResponse(401, { error: "session expired" });
      }
      if (url.includes(GRAPH_URL) && url.includes("$select=body")) {
        return jsonResponse(200, {
          body: {
            contentType: "text",
            content: "Your Prime membership renews for $14.99 /mo.",
          },
        });
      }
      if (url.includes(GRAPH_URL)) return jsonResponse(200, graphListBody());
      return jsonResponse(404, {});
    });

    const fetcher = createGraphFetcher("token-1", "outlook-1", refresh);
    const result = await fetcher.fetchMessages({
      mailboxId: "outlook-1",
      since: null,
      limit: 100,
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(3); // list 401 -> replay -> body
    expect(calls[0].auth).toBe("Bearer token-1");
    expect(calls[1].auth).toBe("Bearer token-2");
    expect(calls[2].auth).toBe("Bearer token-2");
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain("$14.99");
  });
});
