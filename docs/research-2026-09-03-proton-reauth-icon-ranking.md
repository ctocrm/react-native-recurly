# Research 2026-09-03 — Proton reauth lifecycle & icon ranking (Tuta / Porkbun)

**Status:** analysis + documentation only — **no code changed**. Written for reflection before picking fix hops.
**Tree audited:** `a5cb75d` (identical to `2ad0fd4` code-wise; `a5cb75d` only adds `docs/verify/s1–s3.png`).
**Method:** full-text code analysis + textual fetches of official Proton open-source clients + live HTTP probes of tuta.com / porkbun.com / simple-icons CDN. No vision used.

## Sources verified (fetched 2026-09-03)

Official Proton code (read directly, not from memory):

- `ProtonMail/WebClients` @ `main`: `packages/shared/lib/api/auth.ts`, `packages/shared/lib/errors.ts`
- `ProtonMail/go-proton-api` @ `master`: `manager_auth.go`, `manager.go`, `manager_builder.go`, `client.go`, `manager_auth_types.go`, `auth.go`, `manager_test.go`

Live probes: `porkbun.com/` and `tuta.com/` HTML heads + `<img>` assets; PNG IHDR dimension reads; `cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/<slug>.svg` status per slug; `tutanota.de` redirect chain.

Repo code (both `ProtonModule.kt` copies confirmed **identical** — `plugins/mail-imap/android/` is SSOT, `android/app/.../imap/` is the prebuild copy): `imapNative.ts`, `providers.ts`, `protonCaptcha.ts`, `ProtonModule.kt`, `iconQuality.ts`, `iconCandidate.ts`, `domain/provenance.ts`, `domain/domainDiscovery.ts`, `iconBackgroundCrawler.ts`, `htmlIconExtractor.ts`, `iconValidation.ts`, `iconScraper.ts`, `docs/plan.md` log rows 2026-09-02/03.

---

## Part 1 — Proton reauth: verified root causes

### 1.1 What the official clients actually do (verified from source)

| Behavior | Official implementation | Where verified |
| --- | --- | --- |
| Login | `POST /auth/v4/info` → SRP proofs → `POST /auth/v4` (+`/auth/v4/2fa`) | go-proton-api `manager_auth.go` |
| Refresh request | `POST /auth/v4/refresh` body `{UID, RefreshToken, ResponseType:"token", GrantType:"refresh_token", RedirectURI, State(random32), AccessToken(optional)}` | `manager_auth.go authRefresh` |
| Refresh auth headers | **None required** — `NewClientWithRefresh` passes `AccessToken: ""` | `manager_auth.go`, `client.go` |
| Refresh response | **New token PAIR**: `Auth{UID, AccessToken, RefreshToken, ServerProof, Scope, 2FA, PasswordMode}` — **no `ExpiresIn`, no TTL, no extension op exists** | `manager_auth_types.go` |
| Rotation | Old refresh token **superseded on use** (effective single-use); client replaces both tokens and persists immediately via auth handlers | `client.go authRefresh` |
| **When to refresh** | **Reactive only**: normal call → HTTP 401 → refresh once → retry once. No timer; server never discloses TTL, so "refresh before expiry" is impossible by design | `client.go doRes` |
| Refresh failure | 400/422 → **terminal deauth** (user re-login); 409/429/5xx → transient (backoff, keep session) | `client.go authRefresh` |
| Concurrency | `authLock` mutex + `deauthOnce` — two callers can never double-spend one refresh token | `client.go` |
| Rate limit | 429 → wait `Retry-After`, retry; never invalidates | `manager_test.go` |
| Connections | Pooled/reused (tested: `TestConnectionReuse`) — but **auth state lives in headers (`x-pm-uid` + `Authorization: Bearer`), not the connection** | `manager_test.go`, `client.go exec` |
| Headers on every call | `x-pm-appversion` (format `name@version`; error 5003 `APP_VERSION_BAD` exists), UA | `manager_builder.go`, WebClients `errors.ts` |
| Error codes | `9001` HV (can arrive as **HTTP 422 Code 9001** — our 2026-09-02 23:20:33 logcat), `2028` **BANNED** (anti-abuse), `8002` INVALID_LOGIN, `12087` TOKEN_INVALID; HTTP `403` = **UNLOCK** → locked-scope reauth runs **reactively, once** | WebClients `errors.ts` |
| HV retry | `x-pm-human-verification-token(-type)` headers on the retried auth POST; fresh info+proofs per attempt | `manager_auth.go` |
| Web client (contrast) | Cookie flow: refresh token lives in a cookie scoped `path=/api/auth/refresh`; the **browser cookie jar** rotates it via `Set-Cookie`. "The connection keeps the session alive" is true only for that browser flow — not the token flow we use | WebClients `auth.ts setRefreshCookies` |

### 1.2 What our implementation already gets RIGHT (no change needed)

1. **Refresh request body matches the official one exactly** — incl. `RedirectURI: "https://protonmail.ch"` + random `State` (`ProtonModule.kt:282-295`). Omitting the Bearer header on refresh is also official behavior.
2. **HV/CAPTCHA flow matches** — 9001 detected even when wrapped in HTTP 422, WebView handoff to `verify.proton.me`, retry with HV headers + fresh SRP (`read()` :780-817, `protonCaptcha.ts`, `imapNative.ts protonLogin`).
3. **The single-use exchange is orchestrated correctly on the happy path** — one refresh per fetcher per scan, never retried in a loop, and `await persistSession(session)` runs **before** any list call (`imapNative.ts:170-175`).
4. **The new refresh token IS saved, atomically with the access token** — `sessionFromAuth` (falls back to the old refresh token only if the server omits `RefreshToken`, i.e. chose not to rotate) → bridge → `saveTokens` writes `{uid, accessToken, refreshToken, accountHint}` as **one SecureStore item** (`providers.ts:877-884`). Access and refresh can never diverge. Both exits persist (refresh success `:175`, login fallback `:182`).
5. **`createPasswordMailFetcher("proton", …)` (null session + no-op persist, `imapNative.ts:236`) is dead code** — only Tuta uses that constructor (`providers.ts:904`). Delete it anyway (footgun: wiring it would rotate-and-discard).

### 1.3 The deviations (root causes, ranked)

- **D1 — Proactive refresh every scan** (`imapNative.ts:168`): we rotate at the top of *every* scan regardless of access-token state. Official = only on 401. Consequence: one single-use token burned + one persist-critical window **per scan** instead of ~once per server-side TTL.
- **D2 — Silent fallback to full SRP login, replaying a stale stored TOTP** (`imapNative.ts:176-182` + `providers.ts:94-103`): when refresh fails we auto-relogin with stored credentials. If 2FA is enabled the stored code is minutes/hours old → guaranteed 422 → forced manual reconnect ("reauth"). Silent password replay also feeds the abuse engine. Official clients surface deauth; they never replay credentials.
- **D3 — Per-chunk SRP locked-scope unlock**: every `listWithSession` builds a fresh `ProtonClient` and runs `unlockKeys → unlockLockedScope` (`POST /auth/v4/info` ReauthScope=locked + `PUT /core/v4/users/unlock` with SRP password proofs) **plus** `/core/v4/users` + `/core/v4/addresses` + `/core/v4/keys/salts` (`ProtonModule.kt:377-507`). With CHUNK=75 a 443-message scan = 6 chunks ≈ **30 auth-class calls per scan**. Official clients unlock **once, reactively on HTTP 403**. *This is the "we copied the official endpoints but misapplied the trigger" item.*
- **D4 — Error conflation** (`read()`, `ProtonModule.kt:819-823`): every 401/422 becomes `"Proton rejected the password or 2FA code"` — masking 2028 BANNED, dead refresh tokens, and stale-2FA cases; misleads the user into re-entering passwords (worsening abuse blocks).
- **D5 — Non-official fingerprints**: `x-pm-appversion: Other`, `User-Agent: jsmastery/1.0`, `HttpsURLConnection` (HTTP/1.1-only, TLS fingerprint differs from OkHttp), emulator/datacenter IP. All feed Proton's risk engine (9001/2028).
- **D6 — No refresh lock + crash window**: nothing prevents two concurrent scans double-spending one refresh token (`loadTokens` snapshot → both POST refresh; second gets 400/422 → D2 fallback). And the server consumes the old token the instant it answers — our SecureStore write happens one bridge-hop later. The R10 OOM crashes hit **exactly** the Proton leg where the proactive refresh runs, orphaning tokens. Official: mutex + rare refresh + synchronous persist.

### 1.4 Observed failure chains (evidence)

- **2026-09-02 clean-room** (plan rows 1631/1632): fresh install, no stored session → cold SRP login → 9001 CAPTCHA (user solved) → one `422 {Code:9001}` at 23:20:33 → solved → **443/443 listed + decrypted, zero failures**. Proves the wire protocol and HV retry are correct; also proves "HTTP 422" ≠ "wrong password" (our message claimed exactly that).
- **2026-09-03 R10 era** (plan row 1636): Java-heap OOM on the Proton leg (17:34:47) — crash windows during refresh/leg start → orphaned single-use refresh tokens → next scan refresh 400/422 → D2 fallback → CAPTCHA/2028-class blocks → the "reauth on Proton" experience. New issue triggered by the crash era, **not** a regression of the chunking/Conscrypt fixes.
- **Last run** (HEAD): refresh + persist worked, `[MailProton-js] batches staged, messages=7 (chunk=75)` — exchange mechanics healthy when nothing crashes.

### 1.5 Direct answers to the protocol questions

1. **New pair or extension?** Full rotation: every successful refresh returns a NEW AccessToken AND a NEW RefreshToken; the old pair is abandoned. No extend/introspect/TTL operation exists in the API surface official clients use.
2. **Max request count on a refresh token?** Effectively **one successful use** (supersession, not a counter). Normal API calls never send or consume it. No N-use cap exists; the real server-side limits are session revocation (`/auth/v4/sessions`, password change, logout-all), absolute session age (TTL undisclosed), 429 rate limiting (transient, `Retry-After`), and risk blocks (9001/2028). No reuse grace window is relied on anywhere in official code — design for strict single-use.
3. **Before or after access-token expiry?** Proton's protocol supports **after only**: no expiry disclosed, death signaled by 401 on a normal call; official clients refresh lazily on that 401 and retry once. We do **before** (every scan) — protocol-legal but multiplies single-use burns and crash windows.
4. **Is the connection the session?** No — for the token flow every request is self-describing (`x-pm-uid` + Bearer); a brand-new process bootstraps from just UID+refresh token (`NewClientWithRefresh`, proven by `TestAuthRefresh`). "The session rides the connection" is true only for the browser cookie flow.

### 1.6 Proposed Proton hops (NOT implemented — awaiting pick)

- **P1 — Truthful errors, no silent credential replay.** Map API `Code`: 9001 (any HTTP) → CAPTCHA sheet; 2028 → "temporarily blocked by Proton anti-abuse — wait and rescan"; refresh 400/422 → typed `PROTON_SESSION_DEAD` → surface "session expired — Edit → Reconnect" (mirror of R1's `invalid_grant` handling). Stop persisting/replaying the TOTP; delete the dead `createPasswordMailFetcher("proton")` branch. *Kills D2, D4.*
- **P2 — Reactive refresh.** Try the list with the stored access token; on 401 → refresh **once** under a per-mailbox lock → retry once. Healthy scans cross **zero** rotation points, so crashes can no longer orphan tokens. *Kills D1, D6.*
- **P3 — Unlock once per scan.** Cache unlocked keys per (uid, accessToken) in the native module (or react to HTTP 403 like official clients). Cuts ~30 auth-class calls/scan to ~4. *Kills D3.*
- **P4 — Fingerprint hardening.** `x-pm-appversion: cadence@<version>` + stable UA (optionally OkHttp/HTTP2 later). *Shrinks D5.*
- **Gates:** two consecutive scans with ≤1 refresh/unlock in logs, no reauth prompt, chunk ≤75 intact, cold login (fresh TOTP entry) still works, Proton rows import.

---

## Part 2 — Tuta icon quirk: partner badge on the official site outranks the real mark

### 2.1 Observation (user, 2026-09-03 run)

Card auto-assign picked a wrong icon **sourced from tuta's own site** ("from tuta, just not the correct icon" — a generic-looking emblem). The **correct** Tuta mark is the **second** tile in the picker. Structural note: the picker always inserts the **cached card icon as tile #1** (`getIconCollection`, `iconBackgroundCrawler.ts:526-548`) — so "wrong #1 / correct #2" = wrong card auto-assign + correct best crawl result, same ranking everywhere.

### 2.2 The asset and the mechanism (all verified live)

`tuta.com` homepage contains `<img src="/assets/european_digital_sme_alliance_logo.DVqbPoKQ.png">` — the **European Digital SME Alliance** partner badge Tuta displays (membership section). PNG IHDR read: **324×160**. Their real favicon mark is `<link rel="icon" href="/favicon/logo-favicon-192.png">` — **192×192**. (`/favicon/logo-favicon.svg` also exists but SVG is unpaintable on the card by design. `tutanota.de` — the From-host seed — 301-redirects to `tuta.com`.)

Pipeline walk (why the badge wins):

1. **TIER 0.5 admission** (`iconBackgroundCrawler.ts:882-915`): `extractIconsFromHtml` extracts `<img>` tags whose src/tag contains "logo" (`htmlIconExtractor.ts:338-379`, source label `img_logo` → renamed `official_img_logo`). The admission filter is only `isPublishableExtractedIcon` (`iconCandidate.ts:80-89`): URL contains the token "logo" → `hasLogoSignal` true → **admitted**. **The partner-mark check (`isPartnerOrUnrelatedMark`, `iconCandidate.ts:120-138` — built exactly for "Scotts on Ace") is NOT applied here.**
2. **Both candidates are provenance=official** (host `tuta.com` ∈ officialHosts) → 6000 pts each (`provenanceRank 3 × 2000`, `iconQuality.ts:67`).
3. **Card auto-assign** (`promoteFirstIconToCache`, `iconBackgroundCrawler.ts:1448-1545`): filters results by **paintability only** (`:1465-1467`) — no partner check, no provenance gate, no report check — then `pickBestIcon` takes the top score:

| Candidate | source | dims | Score breakdown | Total |
| --- | --- | --- | --- | --- |
| **EU-SME alliance badge** | `official_img_logo` | 324×160 | official 6000 + png 80 + ≥256px 250 + source-includes-"logo" 180 | **6510** ← card |
| Tuta real mark `logo-favicon-192.png` | `official_favicon` | 192×192 | official 6000 + png 80 + ≥180px 200 + official_favicon 20 | **6300** → picker #2 |

The badge wins by **210** — deterministically, every crawl, because it is wider than 256px and its source label contains "logo".

4. **The picker hides the badge from the results section** (`isPickerPublishableCandidate` → `isPartnerOrUnrelatedMark`: filename tokens `european/digital/alliance` are 4+ alpha chars not containing "tuta" → flagged) — which is exactly why the *correct* favicon appears at #2 while the cached wrong one sits at #1. **The card path and the picker path disagree**: the gate exists, it just isn't wired into admission or card auto-assign.

### 2.3 Verdict: edge case, NOT a regression

- Wrong Tuta icon already present in the **2026-09-02 clean-room run** (plan row 1631: "Tuta icon is a wrong generic illustration") — **before** R4 (`daf4ebd`), R5/R7 (`8b4cdd2`), R6/R9, R10 staging/chunking existed.
- Scoring/admission files last changed 2026-08-26 (`a7d1994`, `8547246`); none of the 2026-09-03 R-fixes touch scoring.
- Tuta was never in a card-auto-assign validation set (2026-08-25/26 gates used Netflix/Proton/Linear/Ground/Ace/Spotify/Figma/Notion/Linode/x.ai). First time this brand class (partner badges on official site) was exercised.

### 2.4 Proposed fix (NOT implemented)

- **I1 — Wire the existing partner gate into the two blind spots:** run `isPartnerOrUnrelatedMark` at TIER 0.5 admission and in `promoteFirstIconToCache` (a partner mark must never be auto-assigned to a card, even from the official host). Unit tests with the real `european_digital_sme_alliance_logo.DVqbPoKQ.png` URL and porkbun's `Forbes_logo.png`.
- **I3 — `promoteFirstIconToCache` must skip user-reported-wrong hashes** (`getReportsForIcon` is only consulted in `getIconCollection` today — a reported-wrong icon can currently be re-auto-assigned on the next promote).

---

## Part 3 — Porkbun icon quirk: og:image wordmark rescued by its own filename

### 3.1 Observation

Card shows a **".com" text mark** (Porkbun's wordmark). The correct pig mark is the **second** picker tile. On the 2026-09-02 clean-room run Porkbun's card **was brand-correct** — the flip happened on the 2026-09-03 run.

### 3.2 The assets and the mechanism (verified live)

`porkbun.com` head exposes: `apple-icon-57…180x180`, `android-icon-192x192`, `favicon-16/32/96`, `ms-icon-144x144`, and `og:image = https://porkbun.com/images/porkbun-logo-1200x1200.png` (their **wordmark**, IHDR-verified **1200×1200**). Homepage `<img>`s include `/images/pig-icon.png` (**52×52**, the actual pig), `/images/Forbes_logo.png` (partner badge — same landmine class as Tuta), `facebook-logo.svg`, `google-logo.svg`.

Scores (all provenance=official on `porkbun.com`):

| Candidate | source | dims | Score | |
| --- | --- | --- | --- | --- |
| apple-icon-180 | `official_apple_touch` | 180 | 6000+80+350+200 | **6630** (would win **if fetched**) |
| android-icon-192 | `official_favicon` | 192 | 6000+20+80+320("192x192")+200 | **6620** (if fetched) |
| **og:image wordmark** | `official_og_image` | 1200 | 6000+80+300 | **6380** ← actual card |
| pig-icon.png | `official_img_logo` | 52 | 6000+80+180 | 6260 |
| Forbes_logo.png | `official_img_logo` | ? | 6000+80+180+dims | partner landmine (I1 covers it) |
| favicon-32 | `official_favicon` | 32 | 6000+20+80 | 6100 |

Why the wordmark won despite ranking below two pig icons: **it was the only strong paintable survivor**. The run had **117 failed icon downloads** on the flaky emulator, and R5 (`8b4cdd2`) cut `FETCH_MAX_ATTEMPTS` 3→2 — the small favicon PNGs died, the (later-queued) og:image survived. That also explains why 2026-09-02 (retries=3, better network) got the pig: this flip is **network/R5-dependent**, not a scoring change.

Why the wordmark was **admitted at all**: `isPublishableExtractedIcon` → `hasLogoSignal` returns true because the *filename* contains the token "logo" (`iconCandidate.ts:51-65`) — so the og:image escapes the social-share rejection (`isSocialOrGenericImageSource("official_og_image")` would otherwise drop it). This contradicts the project's own doctrine (plan.md: "Open Graph, Twitter and generic JSON-LD `image` values are not automatically logos"). It also escapes the -800 social penalty in scoring for the same reason.

### 3.3 Verdict

Pre-existing admission/ranking hole (filename-"logo" rescue + size bonus for a social-share image), with an **R5/network-dependent trigger** for the flip vs 2026-09-02. Not a scoring regression (no scoring change since 2026-08-26).

### 3.4 Proposed fix (NOT implemented)

- **I2 — og/twitter/jsonld_image demotion:** sources `official_og_image` / `official_twitter_image` / `jsonld_image` must never outrank the favicon family (apple-touch / PWA / favicon / ms-icon), regardless of pixel size; and a filename "logo" token alone must not rescue og/twitter images from social-source rejection at admission (keep them publishable as a *last-resort* so brands whose only asset is og:image still get something).
- **I4 (optional) — fetch survivability:** `FETCH_MAX_ATTEMPTS` back to 3 for official-host + library URLs only (stay 2 elsewhere) — addresses the Porkbun flip and the Firefox/Posthog placeholders.

---

## Part 4 — Firefox / Posthog "+" placeholders (context, not wrong-brand)

Both brands have brand-correct simple-icons SVGs on the CDN (verified HTTP 200; note simple-icons also keeps `firefox` alongside `firefoxbrowser`, and `tuta` alongside `tutanota`) — but **SVG is excluded from card auto-assign by design** (`isPaintableCardIcon`, `iconValidation.ts:251-255`, "RN Image cannot paint SVG"). No PNG got fetched on the flaky run → placeholder. Root cause = fetch survivability (Part 3.4 I4) + the known SVG-card limitation (picker still lists them; user can pick manually; upscale path exists). `cerebras` has **no** simple-icons slug (404) yet its card was brand-correct — via official-site assets — confirming the pipeline works when fetches succeed.

---

## Appendix A — Evidence receipts (textual, reproducible)

Live probes (2026-09-03):

- `tuta.com` head: `<link rel="icon" href="/favicon/logo-favicon-192.png">`, `<link rel="icon" href="/favicon/logo-favicon.svg">`, `og:image`/`twitter:image` = `https://tuta.com/share-tuta-thumbnail.png` (correctly rejected at admission: source `official_og_image` + no logo token). Homepage `<img>`: `/assets/european_digital_sme_alliance_logo.DVqbPoKQ.png`. `tutanota.de` → 301 → `tuta.com`.
- `porkbun.com` head: apple-icon 57/60/72/76/114/120/144/152/180, android-icon-192x192, favicon-16/32/96, ms-icon-144x144 (msapplication-TileImage), `og:image` = `https://porkbun.com/images/porkbun-logo-1200x1200.png`. Homepage `<img>`s: `/images/pig-icon.png`, `/images/Forbes_logo.png`, `/images/facebook-logo.svg`, `/images/google-logo.svg`, `/media/reglogo.png`.
- PNG IHDR dims (bytes 16-23): alliance badge `00000144 000000a0` = 324×160; tuta favicon `000000c0 000000c0` = 192×192; porkbun pig `00000034 00000034` = 52×52; porkbun og `000004b0 000004b0` = 1200×1200.
- simple-icons CDN (`cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/<slug>.svg`): `tuta` 200, `tutanota` 200, `porkbun` 200, `posthog` 200, `firefox` 200, `firefoxbrowser` 200, `coderabbit` 200, `openrouter` 200, `proton` 200, **`cerebras` 404**.

Scoring constants used (`iconQuality.ts:60-134`): provenanceRank ×2000 (official 3 / library 2 / brand-token 1 / untrusted 0); social -800 unless src/url has "logo" token; svg +500 / png-webp +80 / jpg +40 / ico -40; library +400; apple +350; `192x192`/`512x512` URL +320; src-includes-"logo" +180; `official_favicon` +20; dims ≥512 +300 / ≥256 +250 / ≥180 +200 / ≥128 +150 / ≥64 +80 / <32 -80; `ai_upscale` +10000; `subscription` +5000.

## Appendix B — Code map (file:line at `a5cb75d`)

| Concern | Location |
| --- | --- |
| Proactive refresh + fallback-to-password | `src/services/emailscan/imapNative.ts:167-183` |
| Chunk loop (CHUNK=75, MAX_BATCHES=40) | `imapNative.ts:184-225` |
| Dead no-op-persist proton constructor | `imapNative.ts:230-237` (only Tuta caller: `providers.ts:904`) |
| Token persistence (single SecureStore write) | `providers.ts:75-82, 865-885` |
| TOTP persisted at connect | `providers.ts:89-103`, entered at `EmailScanSection.tsx:624` |
| Refresh request/response parsing | `ProtonModule.kt:282-310` |
| Per-call locked-scope unlock + key fetches | `ProtonModule.kt:377-507` (`unlockLockedScope` :509-542) |
| Headers / fingerprints | `ProtonModule.kt:726-778` |
| Error conflation (401/422 message) | `ProtonModule.kt:819-823`; 9001/HV handling :780-817 |
| TIER 0.5 admission (no partner check) | `iconBackgroundCrawler.ts:843-924` (filter at :896) |
| `<img>` logo extraction | `htmlIconExtractor.ts:338-379` |
| Partner-mark gate (exists, partially wired) | `iconCandidate.ts:120-138, 148-169, 172-183` |
| Card auto-assign (paintability-only filter) | `iconBackgroundCrawler.ts:1448-1545` (filter :1465-1467) |
| Picker cached-first + partner/report gates | `iconBackgroundCrawler.ts:500-600` |
| R4 junk-host admission blocklist | `iconBackgroundCrawler.ts:1233-1305` |
| SVG excluded from card | `iconValidation.ts:251-255` |
| og/twitter admission rescue | `iconCandidate.ts:44-89` |

## Appendix C — Open questions for reflection (deliberately unanswered)

1. Should card auto-assign be restricted to favicon-family + library sources only (never generic homepage `<img>`s) until confidence improves — i.e. stricter than I1?
2. Is the user "Wrong icon" report a sufficient backstop once I3 lands, or do we also want a re-crawl nudge after a report?
3. P3: proactive-unlock-once-per-scan, or strictly official 403-reactive unlock (account may genuinely be scope-locked — behavior under a real lock needs a live check)?
4. Do we adopt OkHttp in the native module for fingerprint parity (bigger change), or keep `HttpsURLConnection` + header fixes (P4 minimal)?
5. When implementing P2, capture whether `mail.proton.me` attaches `Set-Cookie` to token-flow responses (web-compat curiosity; body `RefreshToken` stays authoritative either way).
6. Tuta alias note from the 2026-09-02 run (row 1631, truncated item (d)) still unverified — unrelated to icons, parked.





