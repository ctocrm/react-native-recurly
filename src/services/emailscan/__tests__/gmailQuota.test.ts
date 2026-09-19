/**
 * Gmail API quota handling (2026-09-05: the Workspace scan leg died with a
 * 403 "Total Query Cost / Units per minute per user" because list +
 * per-message metadata + body GETs fired back-to-back).
 *
 * Covered here:
 * - every Gmail call is paced (MIN_INTERVAL_MS between request starts)
 * - a quota 403/429 backs off ~60s and retries ONCE, then fails with a
 *   user-actionable message instead of a raw API dump
 * - a non-quota 403 fails immediately (no pointless backoff)
 */

import type { NormalizedMessage } from "../types";
import { createGmailFetcher, MailScanUnverifiedError } from "../providers";
import { createTokenSession } from "../oauthSession";

// providers.ts pulls in native modules its Gmail fetcher never touches.
// Mock them so the suite runs in plain node (the Gmail path only needs fetch).
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

const LIST_URL = "gmail/v1/users/me/messages?";
const META_URL = "format=metadata";
const FULL_URL = "format=full";

interface FetchCall {
  url: string;
  t: number;
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

function fullBody() {
  const text = "Your Prime membership renews for $14.99 /mo.";
  const data = Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { payload: { mimeType: "text/plain", body: { data } } };
}

describe("createGmailFetcher quota handling", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  function installFetch(
    handler: (url: string, callNumber: number) => Response,
  ): FetchCall[] {
    const calls: FetchCall[] = [];
    global.fetch = jest.fn((url: string) => {
      calls.push({ url, t: Date.now() });
      return Promise.resolve(handler(url, calls.length));
    }) as unknown as typeof fetch;
    return calls;
  }

  test("quota 403 backs off once, retries, and completes the scan", async () => {
    const calls = installFetch((url, n) => {
      if (url.includes(LIST_URL) && n === 1) {
        return jsonResponse(403, {
          error: {
            message:
              "Total Query Cost is too high. quota exceeded: Units per minute per user",
          },
        });
      }
      if (url.includes(LIST_URL)) return jsonResponse(200, listBody(["msg-1"]));
      if (url.includes(META_URL)) return jsonResponse(200, metaBody());
      if (url.includes(FULL_URL)) return jsonResponse(200, fullBody());
      return jsonResponse(404, {});
    });

    const fetcher = createGmailFetcher(createTokenSession({ accessToken: "token-1" }), "workspace-1");
    const collected: NormalizedMessage[] = [];
    const promise = fetcher.fetchMessages(
      {
        mailboxId: "workspace-1",
        since: null,
        limit: 100,
      },
      async (chunk) => {
        collected.push(...chunk);
      },
    );
    // Drive through pacing slots (250ms each) and the 60s quota backoff.
    for (let i = 0; i < 12; i += 1) {
      await jest.advanceTimersByTimeAsync(10_000);
    }
    await promise;
    const result = collected;

    // list(403) -> list ok -> metadata -> full body
    expect(calls).toHaveLength(4);
    expect(calls[1].t - calls[0].t).toBeGreaterThanOrEqual(60_000);
    expect(calls[2].t - calls[1].t).toBeGreaterThanOrEqual(250);
    expect(calls[3].t - calls[2].t).toBeGreaterThanOrEqual(250);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe("Your Prime membership renewal");
    expect(result[0].text).toContain("$14.99");
  });

  test("persistent quota 403 fails with an actionable message after one retry", async () => {
    const calls = installFetch(() =>
      jsonResponse(403, {
        error: { message: "quota exceeded: Units per minute per user" },
      }),
    );

    const fetcher = createGmailFetcher(createTokenSession({ accessToken: "token-1" }), "workspace-1");
    const collected: NormalizedMessage[] = [];
    const promise = fetcher.fetchMessages(
      {
        mailboxId: "workspace-1",
        since: null,
        limit: 100,
      },
      async (chunk) => {
        collected.push(...chunk);
      },
    );
    const outcome = promise.then(
      () => "resolved",
      (error: unknown) => error,
    );
    for (let i = 0; i < 12; i += 1) {
      await jest.advanceTimersByTimeAsync(10_000);
    }
    const error = await outcome;

    expect(error).toBeInstanceOf(MailScanUnverifiedError);
    expect((error as Error).message).toMatch(/quota exceeded/i);
    expect((error as Error).message).toMatch(/try the scan again/i);
    // Exactly one backoff + retry — no spiral.
    expect(calls).toHaveLength(2);
  });

  test("non-quota 403 fails immediately without backoff", async () => {
    const calls = installFetch(() =>
      jsonResponse(403, { error: { message: "Invalid Credentials" } }),
    );

    const fetcher = createGmailFetcher(createTokenSession({ accessToken: "token-1" }), "workspace-1");
    const collected: NormalizedMessage[] = [];
    const promise = fetcher.fetchMessages(
      {
        mailboxId: "workspace-1",
        since: null,
        limit: 100,
      },
      async (chunk) => {
        collected.push(...chunk);
      },
    );
    const outcome = promise.then(
      () => "resolved",
      (error: unknown) => error,
    );
    await jest.advanceTimersByTimeAsync(250);
    const error = await outcome;

    expect(error).toBeInstanceOf(MailScanUnverifiedError);
    expect((error as Error).message).toContain("Gmail list failed (403)");
    expect((error as Error).message).toContain("Invalid Credentials");
    // No retry, no backoff for a non-quota failure.
    expect(calls).toHaveLength(1);
  });
});
