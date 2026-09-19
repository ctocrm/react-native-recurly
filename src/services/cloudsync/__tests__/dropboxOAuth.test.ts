/**
 * R17 Dropbox OAuth tests — the connect flow must be code+PKCE+offline
 * (refresh token issued). The old implicit flow (response_type=token) could
 * never refresh, which made Dropbox sync dead-by-design after token expiry.
 */
import {
  buildDropboxAuthUrl,
  createDropboxVerifier,
  exchangeDropboxCode,
} from "../dropboxOAuth";

jest.mock("expo-crypto", () => ({
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i += 1) arr[i] = (i * 7) % 256;
    return arr;
  },
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  CryptoEncoding: { BASE64: "base64", HEX: "hex" },
  digestStringAsync: async (_alg: string, data: string) =>
    Buffer.from(data).toString("base64"),
}));

describe("dropboxOAuth (R17)", () => {
  test("auth URL requests the CODE flow with offline refresh + S256 challenge", () => {
    const url = buildDropboxAuthUrl({
      appKey: "key123",
      redirectUri: "cadence://auth",
      codeChallenge: "abc_def-123",
    });
    expect(url).toContain("https://www.dropbox.com/oauth2/authorize?");
    expect(url).toContain("response_type=code");
    expect(url).not.toContain("response_type=token");
    expect(url).toContain("token_access_type=offline");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("code_challenge=abc_def-123");
    expect(url).toContain("client_id=key123");
    expect(url).toContain("redirect_uri=cadence%3A%2F%2Fauth");
  });

  test("createDropboxVerifier yields a 64-char hex verifier and a base64url challenge", async () => {
    const { verifier, challenge } = await createDropboxVerifier();
    expect(verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.length).toBeGreaterThan(40);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/); // base64url: no + / =
  });

  test("exchanges the code for access + refresh tokens", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 14400,
      }),
    }));

    const tokens = await exchangeDropboxCode({
      appKey: "key123",
      code: "abc",
      redirectUri: "cadence://auth",
      codeVerifier: "v".repeat(64),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.dropboxapi.com/oauth2/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("abc");
    expect(body.get("code_verifier")).toBe("v".repeat(64));
    expect(body.get("client_id")).toBe("key123");
  });

  test("throws boundedly when the exchange fails", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({}),
    }));
    await expect(
      exchangeDropboxCode({
        appKey: "k",
        code: "x",
        redirectUri: "r",
        codeVerifier: "v",
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Dropbox token exchange failed (400)");
  });
});
