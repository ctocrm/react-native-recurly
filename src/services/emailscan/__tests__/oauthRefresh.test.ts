import {
  classifyTokenRefreshFailure,
  refreshAccessToken,
  TOKEN_EXPIRY_SKEW_MS,
  TokenRefreshRejectedError,
  tokenNeedsRefresh,
} from "../oauthRefresh";

const NOW = 1_800_000_000_000; // fixed epoch-ms for determinism

describe("tokenNeedsRefresh", () => {
  const base = { accessToken: "tok" };

  it("flags an expired token", () => {
    expect(
      tokenNeedsRefresh({ ...base, expiresAt: NOW - 1 }, NOW),
    ).toBe(true);
  });

  it("flags a token inside the expiry skew margin", () => {
    expect(
      tokenNeedsRefresh({ ...base, expiresAt: NOW + TOKEN_EXPIRY_SKEW_MS }, NOW),
    ).toBe(true);
  });

  it("keeps a token that expires beyond the skew margin", () => {
    expect(
      tokenNeedsRefresh(
        { ...base, expiresAt: NOW + TOKEN_EXPIRY_SKEW_MS + 60_000 },
        NOW,
      ),
    ).toBe(false);
  });

  it("keeps a token with unknown expiry (the list call will report)", () => {
    expect(tokenNeedsRefresh(base, NOW)).toBe(false);
  });

  it("never refreshes an empty token blob", () => {
    expect(tokenNeedsRefresh({ accessToken: "" }, NOW)).toBe(false);
  });
});

describe("classifyTokenRefreshFailure", () => {
  it("classifies grant rejections as reconnect", () => {
    expect(classifyTokenRefreshFailure(400, { error: "invalid_grant" })).toBe(
      "reconnect",
    );
    expect(classifyTokenRefreshFailure(401, null)).toBe("reconnect");
    expect(
      classifyTokenRefreshFailure(200, { error: "unauthorized_client" }),
    ).toBe("reconnect");
  });

  it("classifies transient failures as retryable", () => {
    expect(classifyTokenRefreshFailure(500, null)).toBe("transient");
    expect(classifyTokenRefreshFailure(429, { error: "slow_down" })).toBe(
      "transient",
    );
    expect(classifyTokenRefreshFailure(503, { error: "temporarily_unavailable" })).toBe(
      "transient",
    );
  });
});

describe("refreshAccessToken", () => {
  const endpoint = "https://token.example/oauth/token";

  function okFetch(json: object) {
    return (async () =>
      new Response(JSON.stringify(json), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
  }

  function statusFetch(status: number, json: object) {
    return (async () =>
      new Response(JSON.stringify(json), {
        status,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
  }

  it("posts the RFC 6749 refresh grant and maps the response", async () => {
    let captured: RequestInfo | undefined;
    const fetchImpl = (async (input: RequestInfo) => {
      captured = input;
      return new Response(
        JSON.stringify({
          access_token: "new-access",
          expires_in: 3600,
          // Google often omits refresh_token on refresh — must keep the old one.
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await refreshAccessToken({
      tokenEndpoint: endpoint,
      clientId: "client-123",
      refreshToken: "rtk",
      fetchImpl,
    });

    expect(result.accessToken).toBe("new-access");
    // No new refresh token ⇒ keeps the stored one.
    expect(result.refreshToken).toBe("rtk");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    const req = typeof captured === "string" ? captured : captured?.url;
    expect(req).toBe(endpoint);
  });

  it("adopts a rotated refresh token when the provider sends one", async () => {
    const result = await refreshAccessToken({
      tokenEndpoint: endpoint,
      clientId: "c",
      refreshToken: "old",
      fetchImpl: okFetch({
        access_token: "a",
        refresh_token: "rotated",
        expires_in: 60,
      }),
    });
    expect(result.refreshToken).toBe("rotated");
  });

  it("throws TokenRefreshRejectedError on invalid_grant", async () => {
    await expect(
      refreshAccessToken({
        tokenEndpoint: endpoint,
        clientId: "c",
        refreshToken: "dead",
        fetchImpl: statusFetch(400, { error: "invalid_grant" }),
      }),
    ).rejects.toBeInstanceOf(TokenRefreshRejectedError);
  });

  it("propagates transient failures (caller falls back to stored token)", async () => {
    await expect(
      refreshAccessToken({
        tokenEndpoint: endpoint,
        clientId: "c",
        refreshToken: "rtk",
        fetchImpl: statusFetch(500, { error: "backend_error" }),
      }),
    ).rejects.not.toBeInstanceOf(TokenRefreshRejectedError);
  });
});
