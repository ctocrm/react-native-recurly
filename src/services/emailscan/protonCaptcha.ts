/**
 * Proton human-verification (Code 9001) handoff.
 * Official verify.proton.me broadcasts HUMAN_VERIFICATION_SUCCESS
 * via AndroidInterface.dispatch. The host WebView implements that
 * bridge and resolves the solved token here.
 */
export type ProtonCaptchaResult = {
  token: string;
  type: string;
};

export type ProtonHvChallenge = {
  webUrl: string;
  hvToken: string;
  methods: string;
};

type Handler = (challenge: ProtonHvChallenge) => Promise<ProtonCaptchaResult>;

let handler: Handler | null = null;

export function setProtonCaptchaHandler(next: Handler | null): void {
  handler = next;
}

export async function requestProtonCaptcha(
  challenge: ProtonHvChallenge,
): Promise<ProtonCaptchaResult> {
  if (!handler) {
    throw new Error(
      "Proton CAPTCHA UI is not mounted. Open the app and retry Scan.",
    );
  }
  return handler(challenge);
}

export function isProtonVerifyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" && parsed.hostname === "verify.proton.me"
    );
  } catch {
    return false;
  }
}
