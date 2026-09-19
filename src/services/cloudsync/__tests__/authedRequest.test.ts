/**
 * R17 cloudsync authedRequest tests — the cloud-sync twin of the emailscan
 * gate: a token the app knows is near expiry is refreshed BEFORE the API
 * call, so the provider never has to 401 us; a surprise 401 still gets the
 * bounded refresh+replay backstop; refreshed tokens persist.
 */
import {
  authedRequest,
  createCloudSession,
  makeOAuthTokenRefresher,
} from "../authedRequest";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from "expo-secure-store";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

describe("authedRequest (R17 cloudsync)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test("refreshes BEFORE the request when near expiry — the API never sees a doomed token", async () => {
    const apiCalls: string[] = [];
    let tokenRefreshes = 0;
    global.fetch = jest.fn(async (url: any, init?: any) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        tokenRefreshes += 1;
        return jsonResponse(200, {
          access_token: "fresh-token",
          expires_in: 3600,
        });
      }
      apiCalls.push(init?.headers?.Authorization ?? "");
      return jsonResponse(200, { ok: true });
    }) as unknown as typeof fetch;

    const session = createCloudSession({
      tokens: {
        accessToken: "stale-token",
        refreshToken: "rtk",
        expiresAt: Date.now() + 60_000, // 1min left < 5min request margin
      },
      storageKey: "gdrive_tokens_u1",
      refresher: makeOAuthTokenRefresher({
        tokenEndpoint: "https://oauth2.googleapis.com/token",
        clientId: "client-123",
      }),
    });

    const res = await authedRequest(
      session,
      "https://www.googleapis.com/drive/v3/files",
      undefined,
      "GoogleDrive",
    );

    expect(res.status).toBe(200);
    expect(tokenRefreshes).toBe(1);
    expect(apiCalls).toEqual(["Bearer fresh-token"]);
    // Rotated token persisted so the next launch picks it up.
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "gdrive_tokens_u1",
      expect.stringContaining("fresh-token"),
    );
  });

  test("401 backstop: refreshes once and retries with the new bearer", async () => {
    const apiCalls: string[] = [];
    let tokenRefreshes = 0;
    global.fetch = jest.fn(async (url: any, init?: any) => {
      if (String(url).includes("/oauth2/")) {
        tokenRefreshes += 1;
        return jsonResponse(200, { access_token: "fresh-token", expires_in: 3600 });
      }
      apiCalls.push(init?.headers?.Authorization ?? "");
      if (apiCalls.length === 1) return jsonResponse(401, {});
      return jsonResponse(200, { ok: true });
    }) as unknown as typeof fetch;

    const session = createCloudSession({
      tokens: {
        accessToken: "token-1",
        refreshToken: "rtk",
        expiresAt: Date.now() + 3_600_000, // 1h left — proactive must NOT fire
      },
      storageKey: "onedrive_tokens_u1",
      refresher: makeOAuthTokenRefresher({
        tokenEndpoint:
          "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        clientId: "ms-client",
      }),
    });

    const res = await authedRequest(
      session,
      "https://graph.microsoft.com/v1.0/me",
      undefined,
      "OneDrive",
    );

    expect(res.status).toBe(200);
    expect(tokenRefreshes).toBe(1);
    expect(apiCalls).toEqual(["Bearer token-1", "Bearer fresh-token"]);
  });

  test("without a refresher, a 401 passes through after exactly one request", async () => {
    const apiCalls: string[] = [];
    global.fetch = jest.fn(async (url: any, init?: any) => {
      apiCalls.push(init?.headers?.Authorization ?? "");
      return jsonResponse(401, {});
    }) as unknown as typeof fetch;

    const session = createCloudSession({
      tokens: { accessToken: "token-1" },
      storageKey: "owncloud_tokens_u1",
      refresher: null,
    });

    const res = await authedRequest(
      session,
      "https://cloud.example/remote.php",
      undefined,
      "owncloud",
    );
    expect(res.status).toBe(401);
    expect(apiCalls).toEqual(["Bearer token-1"]);
  });
});
