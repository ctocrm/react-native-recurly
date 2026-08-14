# Tranche E + F — on-device verification (real companies)

**Commits:** d55bbf3 (Tranche E); precision base 9d2f715 (Tranche C+D).
**Build:** build-out/apk/app-release-x86_64.apk (16:24) on pixel_6a_API34.
**Date:** 2026-08-14

## Tranche E (resilience / terminal / ownership)

- `crawlLifecycle.ts` (9 unit tests): `terminalStatusFor` (no false "complete" on
  provider outage), `canAutoAssignCache` (crawler never overwrites a valid chosen
  cache), `CrawlGenerationRegistry` (stale-crawl cancellation).
- On-device: picker footer now renders the truthful terminal detail, e.g.
  "9 valid icons saved; 9 retryable; 0 provider failure(s)".
- `npx tsc --noEmit` PASS; `npx jest` 49/49 PASS.

## Tranche F (acceptance on real companies)

User-specified real brands exercised via the real UI (add subscription → crawl →
long-press card icon → picker):

| Brand        | Result                                                                                  |
| ------------ | --------------------------------------------------------------------------------------- |
| GitHub       | brand-correct octocat first; NO random pictures                                         |
| Spotify      | brand-correct; NO random pictures                                                       |
| Pandora      | brand-correct "P" logo tiles (+ Clear White BG / Upscale(AI) chips); NO random pictures |
| Ace Hardware | brand-correct ACE logo (baseline + retained)                                            |

Provenance gating logs (each crawl): "rejected 45–50 untrusted-provenance URLs",
"SPIDER: Processing 4 official-host links (of ~47)". The random-picture pollution
(fitness photos, publisher logos, menu chrome) is gone across all tested brands.

Low-res/upscale: Pandora tile exposes "Upscale (AI)" chip (original-dimension
eligibility) and "Clear White BG" corrective chip — the upscale UI is reachable.

## Environment limitation (honest)

DuckDuckGo web search is CAPTCHA/bot-blocked here, so TIER 0 official-domain
discovery often falls back to deterministic guesses and TIER 1 library CDNs
(simple-icons etc.) supply most brand-correct marks. Brands whose logos are not in
a library and whose official site is unreachable (e.g. Le Devoir) may still yield
few/no icons — an extraction/provider limitation, not pollution. The acceptance
criterion "no random/unrelated pictures" holds for every brand tested.
