/**
 * R17 oauthSession unit tests — the one place token lifetime is owned.
 * The critical property under test: a refresh fires BEFORE expiry (while the
 * old token is still valid), so a provider never has to return a 401 for a
 * token the app already knew was dying (the 2026-09-06 Gmail mid-leg class).
 */
import {
  createTokenSession,
  REQUEST_LIFETIME_MARGIN_MS,
} from "../oauthSession";

describe("oauthSession (R17)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("refreshes BEFORE expiry — refresh fires while the old token is still valid", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const refreshCallsAt: number[] = [];
    const refresh = jest.fn(async () => {
      refreshCallsAt.push(Date.now());
      return { accessToken: "token-2", expiresAt: 1_000_000 };
    });
    const session = createTokenSession(
      { accessToken: "token-1", expiresAt: 120_000 },
      refresh,
      { marginMs: 60_000 },
    );

    // t=0: 120s left > 60s margin -> no refresh yet.
    expect(await session.valid()).toBe("token-1");
    expect(refresh).not.toHaveBeenCalled();

    // t=65s: 55s left < 60s margin -> refresh fires BEFORE the 120s expiry.
    jest.setSystemTime(65_000);
    expect(await session.valid()).toBe("token-2");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refreshCallsAt[0]).toBeLessThan(120_000);

    // The new token is now current; no further refresh.
    expect(await session.valid()).toBe("token-2");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("does not refresh while remaining life is above the margin", async () => {
    const refresh = jest.fn(async () => ({ accessToken: "token-2" }));
    const session = createTokenSession(
      {
        accessToken: "token-1",
        expiresAt: Date.now() + REQUEST_LIFETIME_MARGIN_MS + 60_000,
      },
      refresh,
    );
    await session.valid();
    await session.valid();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("single-flight: concurrent valid() calls share ONE refresh", async () => {
    let calls = 0;
    const refresh = jest.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { accessToken: `token-${calls + 1}` };
    });
    const session = createTokenSession(
      { accessToken: "token-1", expiresAt: Date.now() + 1_000 },
      refresh,
    );
    const [a, b, c] = await Promise.all([
      session.valid(),
      session.valid(),
      session.valid(),
    ]);
    expect(a).toBe("token-2");
    expect(b).toBe("token-2");
    expect(c).toBe("token-2");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("no known expiry (Fastmail-style) is a passthrough — never refreshes", async () => {
    const refresh = jest.fn(async () => ({ accessToken: "token-2" }));
    const session = createTokenSession({ accessToken: "token-1" }, refresh);
    expect(await session.valid()).toBe("token-1");
    expect(await session.valid()).toBe("token-1");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("force() returns the new token once; null when no refresher is wired", async () => {
    const refresh = jest.fn(async () => ({ accessToken: "token-2" }));
    const withRefresh = createTokenSession({ accessToken: "token-1" }, refresh);
    expect(await withRefresh.force()).toBe("token-2");
    expect(refresh).toHaveBeenCalledTimes(1);

    const withoutRefresh = createTokenSession({ accessToken: "token-1" });
    expect(await withoutRefresh.force()).toBeNull();
    expect(await withoutRefresh.valid()).toBe("token-1");
  });
});
