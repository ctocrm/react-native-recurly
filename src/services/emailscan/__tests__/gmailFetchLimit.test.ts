/**
 * F-4 limit enforcement (2026-09-14 baseline): INITIAL_SCAN_LIMIT was passed
 * to the Gmail fetcher but only capped the page size — the page walk followed
 * nextPageToken forever. Witnessed live: the Workspace leg listed 2000+ ids
 * against limit=500 and ran 52 minutes, which is the exposure window the
 * 13-minute mid-leg wedge (F-4) and the terminal JS hang (F-5) happened in.
 *
 * Covered here:
 * - the page walk stops once `listed` reaches `limit`, even when the stubbed
 *   API keeps offering more pages
 * - the truncation is logged so a device run can prove the bound fired
 * - screened-out subjects never trigger a body GET (loop stays cheap)
 */

import type { NormalizedMessage } from "../types";
import { createGmailFetcher } from "../providers";
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

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

describe("createGmailFetcher limit enforcement (F-4)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  test("stops listing once limit ids are listed, even with more pages", async () => {
    const listUrls: string[] = [];
    let bodyGets = 0;
    const logLines: string[] = [];
    const logSpy = jest.spyOn(console, "log").mockImplementation((line) => {
      logLines.push(String(line));
    });
    global.fetch = jest.fn((url: string) => {
      if (url.includes(LIST_URL)) {
        listUrls.push(url);
        const page = listUrls.length;
        // Every page advertises a next page — the stub API is unbounded.
        // Only the fetcher's limit check can stop the walk.
        return Promise.resolve(
          jsonResponse(
            200,
            {
              messages: Array.from({ length: 100 }, (_, i) => ({
                id: `p${page}m${i}`,
              })),
              nextPageToken: `token-${page}`,
            },
          ),
        );
      }
      if (url.includes(META_URL)) {
        // Security-reset noise: classifies as drop, so no body GET follows.
        return Promise.resolve(
          jsonResponse(200, {
            payload: {
              headers: [
                { name: "Subject", value: "Password reset instructions" },
              ],
            },
          }),
        );
      }
      if (url.includes(FULL_URL)) bodyGets += 1;
      return Promise.resolve(jsonResponse(404, {}));
    }) as unknown as typeof fetch;

    const fetcher = createGmailFetcher(
      createTokenSession({ accessToken: "token-1" }),
      "workspace-1",
    );
    const collected: NormalizedMessage[] = [];
    const promise = fetcher.fetchMessages(
      { mailboxId: "workspace-1", since: null, limit: 250 },
      async (chunk) => {
        collected.push(...chunk);
      },
    );
    // Page walk: 3 pages x (1 list + 100 metadata), paced 500ms apart
    // (~150s of fake time) — drive well past it.
    for (let i = 0; i < 40; i += 1) {
      await jest.advanceTimersByTimeAsync(10_000);
    }
    await promise;
    logSpy.mockRestore();

    // 100 + 100 + 100 = 300 listed >= 250 -> the third page must be last.
    expect(listUrls).toHaveLength(3);
    expect(listUrls[2]).toContain("pageToken=token-2");
    // Drop-classified subjects never pulled a body.
    expect(bodyGets).toBe(0);
    expect(collected).toHaveLength(0);
    // The bound is visible in logs, so a device run can prove it fired.
    expect(
      logLines.some((l) => l.includes("limit 250 reached") && l.includes("truncating")),
    ).toBe(true);
  });

  test("streams chunk meta {listed, total} for the Phase K gauge", async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes(LIST_URL)) {
        return Promise.resolve(
          jsonResponse(200, {
            messages: [{ id: "a" }, { id: "b" }],
            // Phase K: the gauge's total comes from resultSizeEstimate.
            resultSizeEstimate: 1234,
          }),
        );
      }
      if (url.includes(META_URL)) {
        // Drop-classified subjects: no body GETs, but `listed` still counts
        // every screened id — that is the honest "scanned" number.
        return Promise.resolve(
          jsonResponse(200, {
            payload: {
              headers: [
                { name: "Subject", value: "Password reset instructions" },
              ],
            },
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    }) as unknown as typeof fetch;

    const fetcher = createGmailFetcher(
      createTokenSession({ accessToken: "token-1" }),
      "workspace-1",
    );
    const metas: { listed: number; total: number | null }[] = [];
    const promise = fetcher.fetchMessages(
      { mailboxId: "workspace-1", since: null, limit: 500 },
      async (_chunk, meta) => {
        if (meta) metas.push(meta);
      },
    );
    // One page: 1 list + 2 metadata, paced 500ms apart — drive well past it.
    await jest.advanceTimersByTimeAsync(10_000);
    await promise;

    expect(metas.length).toBeGreaterThan(0);
    expect(metas[metas.length - 1]).toEqual({ listed: 2, total: 1234 });
  });
});
