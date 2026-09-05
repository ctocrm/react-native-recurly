/**
 * MSAL bridge policy: error classification + failure messages (pure parts).
 * The native module is mocked; these tests pin the no-auto-retry contract:
 * interaction-required/no-account → reconnect, user cancel → cancel,
 * service/client errors → transient.
 */
jest.mock("react-native", () => ({
  NativeModules: {
    Msal: {
      initialize: jest.fn().mockResolvedValue(true),
      acquireTokenInteractive: jest.fn(),
      acquireTokenSilent: jest.fn(),
      getAccounts: jest.fn().mockResolvedValue([]),
      signOut: jest.fn().mockResolvedValue(true),
    },
  },
}));

import { NativeModules } from "react-native";
import {
  acquireTokenInteractively,
  buildMsalFailureMessage,
  classifyMsalError,
  MS_SCOPES,
} from "../msalAuth";

const msal = (NativeModules as { Msal: Record<string, jest.Mock> }).Msal;

describe("classifyMsalError", () => {
  it("treats user cancel as cancel (never reconnect, never retried)", () => {
    expect(classifyMsalError({ code: "MSAL_USER_CANCELLED" })).toBe("cancel");
  });

  it("treats interaction-required and missing account as reconnect", () => {
    expect(classifyMsalError({ code: "MSAL_INTERACTION_REQUIRED" })).toBe(
      "reconnect",
    );
    expect(classifyMsalError({ code: "MSAL_NO_ACCOUNT" })).toBe("reconnect");
    expect(classifyMsalError({ code: "MSAL_CONFIG_MISSING" })).toBe(
      "reconnect",
    );
  });

  it("treats rejected-grant service errors as reconnect", () => {
    expect(
      classifyMsalError({
        code: "MSAL_SERVICE",
        message: "invalid_grant: refresh token has been revoked",
      }),
    ).toBe("reconnect");
  });

  it("treats other service/client errors as transient", () => {
    expect(
      classifyMsalError({ code: "MSAL_SERVICE", message: "service_unavailable" }),
    ).toBe("transient");
    expect(classifyMsalError({ code: "MSAL_CLIENT", message: "boom" })).toBe(
      "transient",
    );
    expect(classifyMsalError(new Error("plain"))).toBe("transient");
  });
});

describe("acquireTokenInteractively", () => {
  it("initializes once and requests the Graph scopes", async () => {
    msal.acquireTokenInteractive.mockResolvedValueOnce({
      accessToken: "tok",
      accountId: "acc1",
    });
    const result = await acquireTokenInteractively();
    expect(msal.initialize).toHaveBeenCalledWith("msal_auth_config");
    expect(msal.acquireTokenInteractive).toHaveBeenCalledWith(MS_SCOPES);
    expect(result.accessToken).toBe("tok");
    await acquireTokenInteractively();
    expect(msal.initialize).toHaveBeenCalledTimes(1);
  });
});

describe("buildMsalFailureMessage", () => {
  it("mentions the emailed-code challenge for reconnect-class failures", () => {
    const message = buildMsalFailureMessage(
      { code: "MSAL_INTERACTION_REQUIRED" },
      "outlook",
    );
    expect(message).toMatch(/verification code|sign-in window/i);
    expect(message).toMatch(/Reconnect/);
  });

  it("keeps cancel terse", () => {
    expect(
      buildMsalFailureMessage({ code: "MSAL_USER_CANCELLED" }, "outlook"),
    ).toBe("Sign-in cancelled");
  });
});