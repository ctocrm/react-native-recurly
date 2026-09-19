/**
 * MSAL bridge for Microsoft mail accounts (R6 hardening, M2).
 *
 * Wraps the official MSAL Android SDK through the Msal native module:
 * - acquireTokenInteractively: Microsoft's complete auth journey (sign-in,
 *   consent, and any "Verify your email"/2FA challenge Microsoft issues)
 *   runs in MSAL's managed auth surface; the app just receives the result.
 * - acquireTokenSilently: token reuse when valid — MSAL serves its encrypted
 *   cache and refreshes internally; no UI is ever launched.
 *
 * classifyMsalError is the retry-policy decision point: a failed attempt is
 * NEVER retried automatically. Repeated incomplete MSA sign-ins make
 * Microsoft challenge harder (the 2026-09-04 challenge bombardment).
 * "reconnect" = only a fresh interactive sign-in fixes it; "transient" =
 * caller may fall back to the stored token; "cancel" = the user bailed.
 *
 * Pure helpers are exported for tests; the native module is injectable.
 */
import { NativeModules } from "react-native";

export const MS_SCOPES = ["Mail.Read", "User.Read"];

export interface MsalTokenResult {
  accessToken: string;
  /** Absolute epoch-ms expiry reported by MSAL (absent → use stored token). */
  expiresAt?: number;
  /** MSAL account identifier — the key for silent acquisition. */
  accountId: string;
  username?: string;
}

export interface MsalErrorLike {
  code?: string;
  message?: string;
}

export type MsalFailureKind = "reconnect" | "cancel" | "transient";

type MsalNativeModule = {
  initialize: (configResource: string) => Promise<boolean>;
  acquireTokenInteractive: (scopes: string[]) => Promise<MsalTokenResult>;
  acquireTokenSilent: (
    accountId: string,
    scopes: string[],
    forceRefresh?: boolean,
  ) => Promise<MsalTokenResult>;
  getAccounts: () => Promise<Array<{ accountId: string; username?: string }>>;
  signOut: (accountId: string) => Promise<boolean>;
};

function native(): MsalNativeModule {
  const mod = (NativeModules as Record<string, MsalNativeModule | undefined>).Msal;
  if (!mod) {
    throw new Error(
      "Msal native module is unavailable — Microsoft sign-in needs a build including plugins/with-msal.",
    );
  }
  return mod;
}

let initPromise: Promise<boolean> | null = null;

/** Idempotent: MSAL config lives in res/raw/msal_auth_config.json. */
export function initMsal(): Promise<boolean> {
  initPromise ??= native().initialize("msal_auth_config");
  return initPromise;
}

export async function acquireTokenInteractively(): Promise<MsalTokenResult> {
  await initMsal();
  return native().acquireTokenInteractive(MS_SCOPES);
}

export async function acquireTokenSilently(
  accountId: string,
  forceRefresh = false,
): Promise<MsalTokenResult> {
  await initMsal();
  return native().acquireTokenSilent(accountId, MS_SCOPES, forceRefresh);
}

export function classifyMsalError(error: unknown): MsalFailureKind {
  const code = (error as MsalErrorLike | null | undefined)?.code ?? "";
  if (code === "MSAL_USER_CANCELLED") return "cancel";
  if (
    code === "MSAL_INTERACTION_REQUIRED" ||
    code === "MSAL_NO_ACCOUNT" ||
    code === "MSAL_CONFIG_MISSING" ||
    code === "MSAL_INIT_FAILED"
  ) {
    return "reconnect";
  }
  if (code === "MSAL_SERVICE") {
    const message = (error as MsalErrorLike).message ?? "";
    if (/invalid_grant|interaction_required|no_account_found/i.test(message)) {
      return "reconnect";
    }
  }
  return "transient";
}

/** User-facing message for a failed interactive sign-in. Never blames the
 * user, always tells them what to do next; mentions the emailed-code
 * challenge when the fix is reconnect. */
export function buildMsalFailureMessage(
  error: unknown,
  providerId: string,
): string {
  const kind = classifyMsalError(error);
  if (kind === "cancel") return "Sign-in cancelled";
  if (kind === "reconnect") {
    return (
      `${providerId} sign-in did not finish — Microsoft may email a verification code ` +
      "to the account's recovery address. Reconnect the mailbox (Edit → Reconnect), " +
      "have that inbox handy, and enter the code in Microsoft's sign-in window when asked."
    );
  }
  const code = (error as MsalErrorLike | null | undefined)?.code ?? "unknown";
  return `Microsoft sign-in failed (${code}) — try again shortly.`;
}