/**
 * P1/P2 Proton session orchestration: refresh only on PROTON_SESSION_DEAD,
 * retry the staged fetch once, never replay credentials after a dead session,
 * and surface honest reconnect / anti-abuse errors.
 */
import { NativeModules } from "react-native";

import { createProtonFetcher, ProtonNativeSession } from "../imapNative";

jest.mock("react-native", () => ({
  NativeModules: {} as Record<string, unknown>,
  Platform: { OS: "android", select: (o: { android: unknown }) => o.android },
}));

type FakeNative = {
  login: jest.Mock;
  refreshSession: jest.Mock;
  listWithSession: jest.Mock;
};

const stored: ProtonNativeSession = {
  uid: "uid-1",
  accessToken: "acc-old",
  refreshToken: "ref-old",
};

function message(id: string, date: string) {
  return {
    messageId: id,
    from: "Shop <bill@shop.test>",
    subject: "Invoice",
    date,
  };
}

function makeNative(): FakeNative {
  const native = {
    login: jest.fn(),
    refreshSession: jest.fn(),
    listWithSession: jest.fn(),
  };
  (NativeModules as Record<string, unknown>).MailProton = native;
  return native;
}

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("createProtonFetcher session orchestration (P2)", () => {
  it("does not refresh when the stored access token works", async () => {
    const native = makeNative();
    native.listWithSession.mockResolvedValue({
      messages: [message("a", "2026-09-01T00:00:00.000Z")],
    });
    const persist = jest.fn().mockResolvedValue(undefined);
    const fetcher = createProtonFetcher(
      { username: "u", password: "p" },
      "proton:u",
      stored,
      persist,
    );

    const out = await fetcher.fetchMessages({ mailboxId: "proton:u", since: null, limit: 200 });

    expect(out).toHaveLength(1);
    expect(native.listWithSession).toHaveBeenCalledTimes(1);
    expect(native.listWithSession).toHaveBeenCalledWith(
      "uid-1",
      "acc-old",
      null,
      75,
      "p",
    );
    expect(native.refreshSession).not.toHaveBeenCalled();
    expect(native.login).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("refreshes exactly once and retries when the access token is rejected", async () => {
    const native = makeNative();
    native.listWithSession
      .mockRejectedValueOnce(coded("PROTON_SESSION_DEAD", "expired"))
      .mockResolvedValue({
        messages: [message("a", "2026-09-01T00:00:00.000Z")],
      });
    native.refreshSession.mockResolvedValue({
      uid: "uid-1",
      accessToken: "acc-new",
      refreshToken: "ref-new",
    });
    const persist = jest.fn().mockResolvedValue(undefined);
    const fetcher = createProtonFetcher(
      { username: "u", password: "p" },
      "proton:u",
      stored,
      persist,
    );

    const out = await fetcher.fetchMessages({ mailboxId: "proton:u", since: null, limit: 200 });

    expect(out).toHaveLength(1);
    expect(native.refreshSession).toHaveBeenCalledTimes(1);
    expect(native.refreshSession).toHaveBeenCalledWith("uid-1", "ref-old", "acc-old");
    expect(persist).toHaveBeenCalledWith({
      uid: "uid-1",
      accessToken: "acc-new",
      refreshToken: "ref-new",
    });
    expect(native.listWithSession).toHaveBeenLastCalledWith(
      "uid-1",
      "acc-new",
      null,
      75,
      "p",
    );
    expect(native.login).not.toHaveBeenCalled();
  });

  it("never replays credentials after a dead refresh — surfaces reconnect", async () => {
    const native = makeNative();
    native.listWithSession.mockRejectedValue(
      coded("PROTON_SESSION_DEAD", "expired"),
    );
    native.refreshSession.mockRejectedValue(
      coded("PROTON_SESSION_DEAD", "dead"),
    );
    const fetcher = createProtonFetcher(
      { username: "u", password: "p" },
      "proton:u",
      stored,
      jest.fn().mockResolvedValue(undefined),
    );

    await expect(
      fetcher.fetchMessages({ mailboxId: "proton:u", since: null, limit: 200 }),
    ).rejects.toThrow(/reconnect/i);

    expect(native.refreshSession).toHaveBeenCalledTimes(1);
    expect(native.login).not.toHaveBeenCalled();
  });

  it("propagates anti-abuse blocks instead of masking them", async () => {
    const native = makeNative();
    native.listWithSession.mockRejectedValue(
      coded("PROTON_SESSION_DEAD", "expired"),
    );
    native.refreshSession.mockRejectedValue(coded("PROTON_ABUSE", "blocked"));
    const fetcher = createProtonFetcher(
      { username: "u", password: "p" },
      "proton:u",
      stored,
      jest.fn().mockResolvedValue(undefined),
    );

    await expect(
      fetcher.fetchMessages({ mailboxId: "proton:u", since: null, limit: 200 }),
    ).rejects.toMatchObject({ code: "PROTON_ABUSE" });

    expect(native.login).not.toHaveBeenCalled();
  });

  it("cold-logins only when there is no stored session, then persists it", async () => {
    const native = makeNative();
    native.login.mockResolvedValue({
      uid: "uid-2",
      accessToken: "acc-2",
      refreshToken: "ref-2",
    });
    native.listWithSession.mockResolvedValue({ messages: [] });
    const persist = jest.fn().mockResolvedValue(undefined);
    const fetcher = createProtonFetcher(
      { username: "u", password: "p" },
      "proton:u",
      null,
      persist,
    );

    await fetcher.fetchMessages({ mailboxId: "proton:u", since: null, limit: 200 });

    expect(native.login).toHaveBeenCalledTimes(1);
    expect(native.refreshSession).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledWith({
      uid: "uid-2",
      accessToken: "acc-2",
      refreshToken: "ref-2",
    });
    expect(native.listWithSession).toHaveBeenCalledWith(
      "uid-2",
      "acc-2",
      null,
      75,
      "p",
    );
  });

  it("still pages in bounded chunks (R10 staging intact)", async () => {
    const native = makeNative();
    const firstPage = Array.from({ length: 75 }, (_, i) =>
      message(`m${i}`, new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString()),
    );
    native.listWithSession
      .mockResolvedValueOnce({ messages: firstPage })
      .mockResolvedValueOnce({
        messages: [message("tail", "2026-09-20T00:00:00.000Z")],
      });
    const fetcher = createProtonFetcher(
      { username: "u", password: "p" },
      "proton:u",
      stored,
      jest.fn().mockResolvedValue(undefined),
    );

    const out = await fetcher.fetchMessages({ mailboxId: "proton:u", since: null, limit: 500 });

    expect(native.listWithSession).toHaveBeenCalledTimes(2);
    const secondCall = native.listWithSession.mock.calls[1] as unknown[];
    expect(secondCall[2]).toBe(
      firstPage.map((m) => m.date).sort()[firstPage.length - 1],
    );
    expect(out).toHaveLength(76);
  });
});
