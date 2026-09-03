# Product plan — icons, crawl, DB, sync (no training)

**Last updated:** 2026-09-02

**Status:** Phases **1–5.5 complete**. **MAJOR FIX (Tranches A–F) landed**. **Icon hops 1–5 proven on device** (`466cde7`, `71a3840`, `6d54b0d`+`6c47871`, `2d0ba23`+`32521cb`, `5dc46ed`). **xAI compound-label hop proven** (`029c509`). **UI Improvements Phase 0–3 complete** (`ba66478`, `e4e383e`, `77a83bb`, `913b08f`). **Home/Insights hops A–E proven on device** (`ff3f3b9`, `ed16b0f`, `30de520`, `a6e6774`, `b510a35`). **UI Phase 4 is still not complete.** **Cadence identity hop proven** (`f005865` + `ff6ecd2` + `5ac6f97`). **Mail OAuth reply URI code hop:** `providers.ts` sends **`cadence://auth`**. **Wave 1 #1 Outlook Graph PROVEN live 2026-09-02** (`e5bde4c` PKCE code-exchange fix; redirect → exchange → Graph `/me` → Scan imported 9 real rows). **Wave 1 remaining:** #2 Google Workspace (`david@bohbotweb.com` — user must add it as Google Auth Platform test user first) → #3 IMAP last-row on the Outlook mailbox. Zoho client secret pasted in chat must be regenerated. Fastmail skipped. Proton/Tuta already imported live rows. Phase 5 graph is not started. Phase 6 remains later ship polish. Training frozen.

This is the living execution plan for app-side quality and reliability **without** retraining TFLite models. AI upscale strategy remains frozen in [`docs/AI_UPSCALING.md`](./AI_UPSCALING.md) (now under `docs/`).

---

## North star

1. **Better icons without training** — prefer SVG / apple-touch / large PNGs; rank candidates; keep brand-safe hybrid AI as optional polish.
2. **Reliable crawl** — rate limits, retries, no dropped queue work, no stuck cooldowns.
3. **Honest data layer** — clear schema, no crawl-result pile-up, modular DB code.
4. **Honest sync** — cloud carries user data only; crawl ephemera stays on-device; UI says so.
5. **Professional tree** — no junk artifacts; sensible folders/imports (Phase 5.5).
6. **Ship polish** — residual UX, limitations note, final gate (Phase 6).

**Explicit non-goals (for now):** new model training, Real-ESRGAN-class photo SR, rewriting OAuth providers.

---

## Phase board

| Phase   | Name                                                   | Status                                | Gate                                |
| ------- | ------------------------------------------------------ | ------------------------------------- | ----------------------------------- |
| **1**   | Registry → map + picker/persist                        | **Done**                              | `tsc`, x86_64 build, emu launch     |
| **2**   | Visual without training (`iconQuality` + source order) | **Done**                              | same + scorer smoke                 |
| **3**   | Crawl reliability                                      | **Done**                              | same                                |
| **4**   | DB split / schema hygiene                              | **Done**                              | same                                |
| **5**   | Sync honesty                                           | **Done**                              | same                                |
| **5.5** | Professional cleanup (artifacts, docs, structure)      | **Done**                              | complete                            |
| **MF**  | Icon crawler → picker → upscale pipeline recovery      | **A–F landed; hops 1–5 proven on device** | full cross-layer gate every hop     |
| **UI**  | Post-Major-Fix UI improvements                         | **Phases 0–3 done; hops A–E done; Phase 4 NOT done** | skill loop after Phase 0            |
| **6**   | Ship polish                                            | **After UI Improvements**             | full smoke + doc pass               |

---


## Cadence identity (blocker before Phase 4 OAuth) — Clerk-out + package+scheme proven ✅

**User-locked 2026-08-28.** Product name is **Cadence** (correct spelling). Publisher is **Picks & Shovels Software**. Do this **before** registering Gmail / Microsoft / Zoho / Fastmail mail client IDs.

**Display-name hop is closed** (`4ce927c`). **Clerk-out + package + scheme hop is closed** (`f005865`, `ff6ecd2`, `5ac6f97`). Live APK is `app.picksandshovels.cadence` / `cadence://` / local Continue. GitHub remote and Expo `owner` / slug stay (not in the APK). A future own backend replaces mock login later; do not build that backend now.

**Proven 2026-08-28 on `emulator-5554` (`pixel_6a_API34`) — identity hop:** x86_64 release `BUILD SUCCESSFUL in 6m 12s`; APK `package: name='app.picksandshovels.cadence'` `application-label:'Cadence'`; install `lastUpdateTime=2026-08-28 10:22:44`; dumpsys VIEW filter `Scheme: "cadence"`; JS bundle has `cadence_local_session` / `signInLocal` and no `@clerk/expo` / `ClerkProvider` / `EXPO_PUBLIC_CLERK`. Continue → Home (heading Local). Sign-out → Continue → Home. Frames: [`docs/reference/cadence-continue-2026-08-28.png`](./reference/cadence-continue-2026-08-28.png), [`docs/reference/cadence-home-after-continue-2026-08-28.png`](./reference/cadence-home-after-continue-2026-08-28.png), [`docs/reference/cadence-signout-continue-2026-08-28.png`](./reference/cadence-signout-continue-2026-08-28.png), [`docs/reference/cadence-home-after-signout-2026-08-28.png`](./reference/cadence-home-after-signout-2026-08-28.png). Launcher display frame remains [`docs/reference/cadence-launcher-2026-08-28.png`](./reference/cadence-launcher-2026-08-28.png).

### Names

| Surface | Value | Notes |
| ------- | ----- | ----- |
| Launcher / `expo.name` | **Cadence** | Proven. Keep. |
| Android `applicationId` / Kotlin `namespace` | **`app.picksandshovels.cadence`** | Locked. Three-segment org namespace; matches `picksandshovels.app`. Do not ship `app.cadence` or keep `com.ctocrm.jsmastery`. |
| URL scheme | **`cadence://`** | Drop `jsmastery://` in the same hop as Clerk removal. Dual-scheme is not required once Clerk is gone. |
| Auth | **Local mock login** | Remove `@clerk/expo`, `ClerkProvider`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` boot throw, sign-up captcha. Continue on the existing sign-in screen. `userId: "local"`. Session in SecureStore. Sign-out returns to sign-in. |
| Expo `slug` | keep `jsmastery` until Expo/EAS is retargeted | Not in the APK. |
| npm `package.json` name | keep `jsmastery` or `cadence` | Local only. |
| GitHub repo | **leave** `ctocrm/react-native-recurly` | Not in the APK. |
| Expo `owner` | **leave** `ctocrm` | |
| Clerk dashboard | **unused after this hop** | No native-redirect click. Delete the publishable key from `.env` when the APK boots without it. |
| Cloud folder leftover | `/SubTracker/` in Drive/Dropbox/OneDrive paths | Later hop; not OAuth. |

Do not use `com.picksandshovels.cadence` unless Play rejects `app.*`. `&` cannot appear in a package. `com.ctocrm.*` is leftover GitHub/Expo owner, not the ship brand.

### Mock login (ships in the APK)

Not a future backend. Not auto-skip.

- New `AuthProvider`: `isLoaded`, `isSignedIn`, `userId`, `signInLocal`, `signOut`. Replace every `@clerk/expo` `useAuth` / `useUser` / `useClerk` / `useSignIn` / `useSignUp`.
- Persist session in SecureStore. Stable **`userId: "local"`** (new package = empty DB).
- Keep the sign-in screen: one **Continue** (no password, no network, no captcha). Sign-up is the same path or a link to Continue.
- Sign-out clears the session and returns to sign-in.
- PostHog: identify `local` (or skip until a real backend). Do not send a fake email as if it were Clerk.
- `DatabaseProvider` opens with that `userId`. CloudSync / EmailScan use the same id.

### Same hop — bindings

- `app.config.js` `package`: `app.picksandshovels.cadence`
- `app.json` `scheme`: `cadence`. Remove `@clerk/expo` plugin.
- Kotlin / IMAP plugin path: `com.ctocrm.jsmastery.imap` → `app.picksandshovels.cadence.imap` (`withMailImap.js` + `plugins/mail-imap/android/*.kt`)
- `providers.ts` `makeRedirectUri` from Expo config (not hardcoded `jsmastery`)
- `scripts/android/android-emulator.sh` package / activity
- Prebuild regenerates gitignored `/android`
- Remove `@clerk/expo` from `package.json`

### Gate (definition of done for the implement hop)

x86_64 APK: `applicationId` `app.picksandshovels.cadence`, scheme `cadence`. New install (empty sandbox). Continue → Home. Sign-out → sign-in → Continue → Home. No Clerk in the binary / no key required to boot.

Then mail OAuth IDs against that package + SHA-1 + **`cadence://auth`**. Then Phase 4. Not in the implement hop: H1 catalog, live Gmail, a real backend, GitHub rename.

### Cost

Old Clerk users / SQLite / mail passwords on `com.ctocrm.jsmastery` do not follow. Reconnect mail after this install.

### TLD — use `.app` for the product (when the site is wired)

| Domain | Role |
| ------ | ---- |
| **cadence.app** | Product site when owned. Play / OAuth homepage / privacy can use this even if the package is `app.picksandshovels.cadence`. |
| cadence.io | Redirect → cadence.app if owned. |
| cadence.tech | Optional redirect. |
| picksandshovels.* | **Company.** Package is `app.picksandshovels.cadence` because `@picksandshovels.app` is already in use. |

Confirm the domains you actually own before DNS. Deep-link scheme stays `cadence://` regardless of which TLD the public site uses. Mail OAuth **reply URI** is **`cadence://auth`** (host required).

### What waits on the proven APK (mail OAuth)

| Service | Bound to | Action |
| ------- | -------- | ------ |
| **Google Mail OAuth** (not Drive) | Android package + SHA-1, live redirect | Create **after** `app.picksandshovels.cadence` APK is proven. Package `app.picksandshovels.cadence`. Debug SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` (same keystore across rebuilds). Do not reuse Drive. |
| **Microsoft Graph Mail** (not OneDrive) | Redirect **`cadence://auth`** | Entra **Mobile and desktop applications**. Not Web / SPA / Android / iOS. Do not check nativeclient / LiveSDK / `msal…://auth`. Personal accounts require Manifest `requestedAccessTokenVersion: 2` first. |
| **Zoho Mail / Fastmail** | Redirect **`cadence://auth`** | Same reply URI as Microsoft. |
| **Google Drive / OneDrive / Dropbox sync** | File OAuth + `/SubTracker/` | Update redirect when scheme actually changes. Folder rename later |
| **PostHog** | Project token in `.env` | Token can stay. Distinct ID is mock `local` until a real backend |
| **Proton / Tuta / IMAP** | Password in SecureStore | No client ID. New package = empty sandbox; reconnect mail |
| **SQLite / icon cache** | App private storage | New package ≠ old data. Fresh install unless we ship export |
| **Play / signing** | `applicationId` + upload key | First Play listing is Cadence when this package is final |
| **Native Kotlin** | Java path | Move **with** `applicationId` in this hop |
| **`makeRedirectUri`** | Expo scheme `cadence` | Mail OAuth sends exactly **`cadence://auth`** via `native: "cadence://auth"`. Do not emit `cadence:///` or `cadence:///auth`. Cloud Sync Drive/OneDrive/Dropbox still use default `makeRedirectUri()` (later hop). |

### Tasks

- [x] User confirms later Play package **`app.picksandshovels.cadence`** (not `app.cadence`).
- [ ] User confirms domains: **cadence.app** vs fallback TLD (DNS later; not this hop).
- [x] User-visible Cadence: `expo.name`, README off Recurly. **Proven on emulator app drawer 2026-08-28**. Launcher icon later (Phase 6).
- [x] **Implement hop:** remove Clerk; mock Continue login; package `app.picksandshovels.cadence`; scheme `cadence://`; Kotlin/IMAP path; emulator script; prebuild. Device gate proven 2026-08-28 (`f005865`, `ff6ecd2`, `5ac6f97`).
- [x] **Then** register mail OAuth client IDs against that package + SHA-1 + **`cadence://auth`**. Google / Microsoft / Zoho IDs are in local `.env`. Fastmail skipped. Live Outlook/Workspace/IMAP is Wave 1 after this APK — not this hop.

**Do not mix mail OAuth registration with H1 catalog copy or a live Gmail scan. Clerk and `jsmastery://` are gone from this APK.**

### Mail OAuth registration (in progress, 2026-08-30)

Entra **Cadence** app exists. Client ID (`.env` only — not tenant ID / Object ID; no secret):

`EXPO_PUBLIC_MICROSOFT_MAIL_CLIENT_ID=fba1737f-1879-41fc-b82d-42dc773e5a86`

**Reply URI (locked):** Entra rejected `cadence://` as invalid (no host). Custom URI is **`cadence://auth`**.

Google / Microsoft / Zoho **client IDs** are in local gitignored `.env` (not Drive/OneDrive). Fastmail **skipped** (no self-serve `client_id`). Do not put a Zoho client secret in `.env` or the APK.

**Code:** `src/services/emailscan/providers.ts` `promptOAuth` uses `makeRedirectUri({ scheme: "cadence", native: "cadence://auth" })` so standalone Android sends exactly `cadence://auth`.

Do not mix this with H1 catalog copy or a live Gmail/Outlook scan. Wave 1 live gate is the next hop after this APK.

### Phase 4 Wave 1 — live Connect/scan (after this APK)

Same Proton/Tuta loop: **one mailbox**, live Scan, fix only that failure, then the next. Agent **stops at the OAuth sheet**. OAuth does **not** use mailbox passwords; those passwords are IMAP-only.

| Order | Row | Mailbox | Done means |
| ----- | --- | ------- | ---------- |
| 1 | **Outlook (Graph)** | `ctocrm@outlook.com` | **DONE 2026-09-02.** Entra consent Accept → redirect `cadence://auth` with `code` → PKCE exchange (`e5bde4c`) → mailbox saved (`Outlook · ctocrm@outlook.com`, Graph `/me` hint) → live Scan **imported 9 real rows** (Posthog, Microsoft, Firefox, Coderabbit, Cerebras, Bot, Openrouter, Cline Bot Inc., Github), icons brand-correct (Posthog/Cerebras/Github confirmed) |
| 2 | Google Workspace | `david@bohbotweb.com` | Same Gmail API, **work** login. Add this address as a Google Auth Platform **test user**. Scan + import evidence |
| 3 | IMAP last row | same Outlook mailbox on a **public** IMAP host (`outlook.office365.com` / `imap-mail.outlook.com:993`) | Native `MailImap` SSL. Not Proton/Tuta. If Microsoft killed basic IMAP, record the fail — do not fake Graph as IMAP |

Leave empty / skip until Wave 1 is proven: consumer Gmail, M365, Zoho mailbox, Fastmail. Proton/Tuta stay as-is; do not reopen H4/H5 unless Wave 1 breaks them.

**Then you get:** consumer Gmail (Testing test user), optional M365, Zoho Mail mailbox. Fastmail still skipped.

| Entra control | Required |
| ------------- | -------- |
| Platform | **Mobile and desktop applications** (last item). Not Web / SPA / Android / iOS |
| Custom redirect | **`cadence://auth`**. Leave nativeclient / LiveSDK / `msal…://auth` **unchecked** |
| Supported accounts | **Any Entra ID Tenant + Personal Microsoft accounts** |
| Manifest first | `"requestedAccessTokenVersion": 2` under `api` (dropdown save fails with `null`) |
| Public client | Allow public client flows = Yes (PKCE) |
| Graph delegated | `Mail.Read`, `User.Read` (`offline_access` on the token request) |

### Mail OAuth — ship / public users (not Phase 4)

Does **not** block Phase 4. First Connect/scan stays: test users, own Entra tenant, admin consent, Google **Testing** mode.

#### Microsoft — other-tenant users

The Entra banner (“End users cannot grant consent to newly registered multitenant apps without verified publishers”) is **publisher verification**, not a broken redirect. Unverified apps registered after November 2020 that request more than basic profile (`Mail.Read` is that) cannot get **end-user Accept** in **other companies’** directories.

| When | What works |
| ---- | ---------- |
| Phase 4 / this hop | Consent in **this** directory (Default Directory). Admin consent there. Personal Outlook.com often still works; if it hits the unverified wall, use a mailbox in this tenant. |
| Public other-org users | Partner Center **Partner One ID** (old MPN). Entra **Branding & properties → Add Partner ID to verify publisher**. Publisher domain set. App registered with a **work/school** account (personal-only registration cannot complete verification). MFA. Blue verified badge on consent. |

Do **not** pause `cadence://auth` or the client ID for MPN.

**Recheck before public Outlook:** reply URI **`cadence://auth`**; platform Mobile and desktop; public client / PKCE; Graph delegated `Mail.Read` + `User.Read`; `/common`; no secret; `EXPO_PUBLIC_MICROSOFT_MAIL_CLIENT_ID` is the Application (client) ID only.

#### Google Gmail — public users

Scope is `https://www.googleapis.com/auth/gmail.readonly`. Gmail mail scopes are **restricted**. Unverified apps stay in **Testing** (listed test users only). That is the Phase 4 path. Do not submit verification to start H1 or a first Gmail scan.

**Before public Gmail users:**

1. **Brand verification** — homepage (not login-only) on a domain you own; privacy policy on that domain, same URL as the consent screen; Search Console ownership of authorized domains; Google branding on the Connect control.
2. **Restricted-scope verification** — justify `gmail.readonly` vs a narrower scope; Limited Use (no ads, no sale, no humans reading mail except disclosed exceptions); in-app disclosure that Cadence scans mail **on-device** for subscriptions.
3. **CASA security assessment** (Google-empanelled assessor) and **annual** re-verification while restricted scopes stay.
4. **Android client** — package still `app.picksandshovels.cadence`. Add **every** signing SHA-1: debug (`5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`), Play **upload** key, Play **App Signing** key. Same OAuth client; do not mint a new client per build.

**Recheck before public Gmail:** Gmail API enabled (not Drive); `EXPO_PUBLIC_GOOGLE_MAIL_CLIENT_ID` is the **mail** client; consent screen name **Cadence**; no Drive scopes on that client.

#### Shared before Play

- App must send **`cadence://auth`** (later `providers.ts` hop). Entra and Google reply URIs must match that string.
- Do not reuse Drive / OneDrive / Dropbox clients for mail.
- Privacy policy + in-app copy: mail is scanned on-device for subscriptions; not sold; not used for ads.

---
## Phase 1 — Registry → map + picker/persist ✅

**Goal:** Stop hand-maintaining a model registry; generate map from on-disk TFLite assets; picker/persist must not race or double-notify.

### Done

- [x] `scripts/models/generate-model-map.js` → `assets/models/model_map.json` (+ registry if needed)
- [x] App loads catalog from generated map (`MODEL_CATALOG` / model loader path)
- [x] Removed / stopped relying on hand-edited registry as source of truth
- [x] Silent multi-step cache writes + single notify where needed
- [x] Picker processing guard (no double-tap races)
- [x] Hygiene comments in README / AI_UPSCALING / build scripts as needed
- [x] Build + emulator smoke (no crash)

### Key paths

- `scripts/models/generate-model-map.js`, `scripts/models/generate-model-registry.js`
- `assets/models/*`
- Icon picker / cache write paths under `src/` + `services/database.ts`

---

## Phase 2 — Visual without training ✅

**Goal:** Cards and picker prefer high-quality sources **before** AI upscale.

### Done

- [x] `src/services/iconQuality.ts` — score by format (SVG > PNG > ICO), source (libraries, apple-touch, PWA, og), dimensions
- [x] Card auto-pick (`promoteFirstIconToCache` / `pickBestIcon`) uses quality, not dead `fallbackTier`
- [x] Picker list sort by quality
- [x] Fetch order quality-sorted
- [x] Crawl / favicon / HTML common paths prefer `favicon.svg`, apple-touch, android-chrome 512/192 before tiny `.ico`
- [x] Hybrid AI path **untouched** (frozen brand-safe)
- [x] Build + emu smoke

### Manual (optional residual → Phase 6)

- [ ] Spot-check 5–10 brands after a fresh crawl (Netflix, Spotify, etc.)

---

## Phase 3 — Crawl reliability ✅

**Goal:** Stop silent failures, stuck rate limits, and dropped queue work.

### Done

- [x] **`recordSuccess` bugfix** — success always clears cooldown (was stuck limited)
- [x] **`recordRateLimit(url, retryAfterMs?)`** — honors `Retry-After` (capped)
- [x] Downloads: skip cooled domains; 429/403 → rate limit; up to 3 attempts on timeout/network/5xx; reject empty bodies; `recordSuccess` on OK
- [x] Queue: busy → **re-run** flag (no dropped enqueues); quality-ordered candidates; skip rate-limited URLs
- [x] **`startIconCrawl`** de-dupes in-flight work per `iconKey`
- [x] Build + emu smoke

### Key paths

- `src/services/rateLimitTracker.ts`
- `src/services/iconBackgroundCrawler.ts`

---

## Phase 4 — DB split / schema hygiene ✅

**Goal:** One canonical schema, versioned migrations, no crawl-result duplicates, thinner modules.

### Done

- [x] `services/db/schema.ts` — full `SCHEMA_SQL`, `SCHEMA_VERSION = 8`, idempotent migrations, `applySchema()`
- [x] `services/db/connection.ts` — key mgmt, open/close/getDatabase
- [x] `services/database.ts` — public facade (call sites unchanged)
- [x] Base schema includes crawl results, crawled_urls, icon_reports, dimensions
- [x] Migration 8: collapse duplicate `(icon_key, original_url)` + unique partial index
- [x] **`saveCrawlResult`** update-in-place when URL exists (placeholder → bytes)
- [x] `PRAGMA user_version = 8`
- [x] Build + emu smoke

### Layout (pre–5.5; may move under `src/services/` in 5.5-D)

```text
services/
  database.ts          # public API
  db/
    schema.ts          # SCHEMA_SQL + MIGRATIONS + applySchema
    connection.ts      # encrypted open/close
    syncScope.ts       # Phase 5 scope constants
```

---

## Phase 5 — Sync honesty ✅

**Goal:** Cloud sync must not pretend to be a full DB dump of spider junk; UI must match behavior.

### Scope

| Included in cloud sync      | Local-only (not uploaded)      |
| --------------------------- | ------------------------------ |
| `subscriptions`             | `icon_crawl_results`           |
| `preferences`               | `icon_crawl_queue`             |
| `icon_cache` (chosen icons) | `crawled_urls`, `icon_reports` |

Constants + copy: `services/db/syncScope.ts`  
(`SYNC_SCOPE_USER_COPY`, `BACKUP_FULL_USER_COPY`)

### Done

- [x] **`exportSyncBackup()`** — encrypted copy, strip local-only tables, clear remote file ids in payload
- [x] **`computeUserDataHash()` / `FromBackup`** — change detection ignores crawl noise
- [x] **`mergeIconCacheFromBackup()`** — download/merge restores chosen icons
- [x] **CloudSyncService** uses scoped export + user-data hashes end-to-end
- [x] **Settings** copy: what sync vs full backup does
- [x] Full **Export Backup** still full DB (includes crawl cache) — labeled honestly
- [x] Build + emu smoke

### Key paths

- `services/db/syncScope.ts`
- `services/database.ts` (`exportSyncBackup`, hashes, merge icons)
- `src/services/cloudsync/CloudSyncService.ts`
- `app/(tabs)/settings.tsx`

---

## Phase 5.5 — Professional cleanup ✅

**Goal:** Make the repo look and feel like a professional product — no root junk, coherent folders/imports, clean docs — **without breaking the app**. Same gate loop as other phases after each risky tranche.

**Why a side phase:** Phases 1–5 shipped features on a messy tree (APKs, POC dumps, split `components/` vs `src/components/`, root `services/` vs `src/services/`, autopsy markdown). Cleanup is required before Phase 6 ship polish so docs and structure match reality.

**Defaults (unless overridden):**

- **Delete** POC/research/catastrophe artifacts from the working tree (git history retains them)
- **Safer C** first (merge components only), then **D** with `@/*` → `./src/*`
- **Delete** unused `assets/models_cascade/` (no app refs)

**Out of scope:** retraining, crawler/AI rewrites, monorepo split, renaming every icon service file.

### Target tree (end of 5.5)

```text
app/                 # Expo Router screens
src/
  components/        # ALL UI (merged)
  constants/
  context/
  hooks/
  lib/
  services/
    database.ts      # + db/ (from root services/)
    cloudsync/
    icon*.ts
  config/
  types/
assets/              # fonts, images, models (shipped only)
scripts/
  android/           # build / emu / verify
  train/             # trainers + requirements*.txt
  models/            # generate-model-*.js
docs/
  AI_UPSCALING.md
  BUILD.md
  plan.md
README.md
package.json
app.config.js / app.json
…
```

**Not in repo** (gitignore + removed from tree): APKs, `build-*.log`, `poc_out*`, root `poc_*.png`, `emu_*.png`, `research/`, empty `history/`, build-out copies.

### Tranche board

| Tranche | Name                                                    | Risk    | Status   |
| ------- | ------------------------------------------------------- | ------- | -------- |
| **A**   | Artifacts + `.gitignore` + APK output dir               | Low     | **Done** |
| **B**   | Docs → `docs/`, delete stubs/autopsy                    | Low     | **Done** |
| **C**   | Merge `components/` → `src/components/`                 | Medium  | **Done** |
| **D**   | `services` / `lib` / `constants` under `src/` + aliases | High    | Open     |
| **E**   | `scripts/{android,train,models}` layout                 | Low–med | **Done** |
| **F**   | README + plan status + import polish                    | Low     | **Done** |

**Rule:** gate after **A**, **C**, **D**, **E** (full build). Never combine D with A untested.

---

### 5.5-A — Artifacts & ignore rules

**Delete from working tree:**

| Item                                      | Why                                |
| ----------------------------------------- | ---------------------------------- |
| `app-release-*.apk` (~480MB)              | Build outputs                      |
| `build-*.log`                             | Build logs                         |
| `poc_out/`, `poc_out_*`, root `poc_*.png` | Training POC dumps                 |
| `emu_*.png`                               | Ad-hoc screenshots                 |
| `research/`                               | Session dumps, not product         |
| `history/`                                | Empty                              |
| `dist/` if present                        | Build residue                      |
| `assets/models_cascade/`                  | Unused by app; cascade not shipped |

**`.gitignore` additions:**

```gitignore
# Build outputs
app-release-*.apk
app-debug-*.apk
build-*.log
/dist/
/build-out/

# POC / research artifacts
poc_out*/
poc_*.png
emu_*.png
/research/
/history/

# Local tooling
.emulator-device
.expo-export-tmp/
```

**Build script:** copy APKs to `build-out/apk/app-release-${ARCH}.apk` (gitignored), not repo root. Update README paths.

- [x] Delete artifacts listed above
- [x] Extend `.gitignore`
- [x] Point `scripts/android/build-android.sh` at `build-out/apk/`
- [x] **Gate A:** `tsc` + `build:android:x86_64` + emu smoke

---

### 5.5-B — Docs hygiene

**Keep → move under `docs/`:**

- `AI_UPSCALING.md` (SSOT)
- `plan.md` (this file)
- `BUILD.md` (fold useful bits from `BUILD_FULL.md`, then drop FULL)

**`README.md` stays at repo root** (standard).

**Delete from root:**

- Stubs: `AI_UPSCALING_IMPLEMENTATION.md`, `TRAINING_FIXES.md`, `TRAINING_FIX_DOCUMENTATION.md`, `TRAINING_GPU_MEMORY.md`
- Autopsy noise: `CATASTROPHE_ANALYSIS.md`, `CATASTROPHE_ANALYSIS_2.md`, `GARBAGE_REPORT.md`
- `posthog-setup-report.md` (fold ≤3 lines into README if needed)
- `task-progress.md` (superseded by this plan)

**Keep at root:** `AGENTS.md`, `CLAUDE.md` (agent tooling).

- [x] Create `docs/`, move keepers, fix links
- [x] Delete stubs / autopsy / legacy task-progress
- [x] README links → `docs/…`
- [x] Gate B: link check + `tsc`

---

### 5.5-C — Unify components

**Today:** `components/*` (cards) vs `src/components/*` (modals).

**Safer C (do first):**

1. Move `components/*.tsx` → `src/components/`
2. Rewrite imports to `@/src/components/...` (or temporary dual path)
3. Remove empty root `components/`
4. **Gate C** full build + emu

Do **not** change global `@/*` mapping in this tranche (lower blast radius). Alias cleanup lands in D.

- [x] Merge component trees
- [x] Update all imports
- [x] **Gate C**

---

### 5.5-D — Unify services, lib, constants + aliases

**Today:** `@/services/database` → root `services/` (`@/*` → `./*`); icon/cloud code in `src/services/`.

**Action:**

1. Move `services/database.ts` + `services/db/` → `src/services/`
2. Move `lib/` → `src/lib/`
3. Move `constants/` → `src/constants/`
4. Adopt path aliases:

| Alias                   | Target                           |
| ----------------------- | -------------------------------- |
| `@/*`                   | `./src/*`                        |
| `@assets/*` (or equiv.) | `./assets/*` as needed for Metro |

1. Normalize imports (`@/services/database`, `@/lib/…`, `@/constants/…`); kill mixed `../../services/database`
2. Grep asset `require` / icon paths carefully

- [x] Moves + tsconfig/babel paths
- [x] Import rewrite complete; `tsc` clean
- [x] **Gate D** full build + emu (**critical**)

---

### 5.5-E — Scripts layout

```text
scripts/
  android/     # build-android.sh, emulator, verify, prebuild-ios, capture-bundle-log
  train/       # train_*.py, train.sh, train-setup.sh, requirements*.txt
  models/      # generate-model-map.js, generate-model-registry.js, generate-model.js
  poc/         # optional: poc_*.py/sh only; outputs gitignored
```

- [x] Move scripts; update `package.json` paths
- [x] **Gate E:** `tsc` + one android build (train need not run)

---

### 5.5-F — Code/docs polish (no feature work)

- [x] Consistent `@/` imports only (package-local `./` kept)
- [x] Professional README (Setup, Scripts, Docs, short architecture)
- [x] This `plan.md` status → 5.5 **Done**; Phase 6 unblocked
- [x] Drop dead exports only if found after moves (none required)

---

### 5.5 success criteria

- Root is config + `app/` `src/` `assets/` `scripts/` `docs/` + lockfiles — **no** APKs/logs/POC
- One components tree and one services tree under `src/`
- `tsc` clean; x86_64 release installs; logcat `Running "main"`
- README + `docs/plan.md` describe reality

### 5.5 risk order

| Order | Tranche | Breaks app if wrong?  |
| ----- | ------- | --------------------- |
| 1     | A       | Unlikely              |
| 2     | B       | No                    |
| 3     | C       | Yes (imports)         |
| 4     | D       | Yes (aliases + moves) |
| 5     | E       | Build scripts         |
| 6     | F       | Unlikely              |

---

## MAJOR FIX — Icon crawler → picker → upscale pipeline recovery ✅

**Status:** **Tranches A–F landed (2026-08-14).** Frozen contracts still apply. **Crawler quality is not done** — hops 1–5 below are the remaining named outcome. Phase 6 waits on UI Improvements **and** these quality hops.

**Why this is a major fix:** crawler discovery, picker behavior, card/cache state, and upscaling are one coupled icon pipeline. Project history repeatedly fixed one layer while breaking another, then continued forward and recreated the same failures. This repair is not complete when search returns URLs, when images download, when TypeScript passes, or when the app builds. It is complete only when the full user-facing icon pipeline works end-to-end without regressing its downstream contracts.

### Product outcome

Given only a subscription/company name, progressively discover a small set of high-confidence, brand-correct icon/logo candidates without freezing the UI.

- Prefer official first-party assets.
- Do not show arbitrary page imagery merely to fill the picker.
- Preserve explicit user choices.
- Preserve the original source information needed by low-resolution detection and AI upscale.
- Cache successful discovery without permanently poisoning a company because a search provider was temporarily blocked.
- Prefer two trustworthy icons over twelve dubious images.
- Keep crawler quality independent from model training. **Training remains frozen.**

### Full dependency chain

Treat this as one pipeline:

```text
subscription name / iconKey
→ web discovery
→ brand/domain verification
→ downloaded ORIGINAL icon bytes
→ icon_crawl_results
→ picker candidate identity/ranking
→ low-resolution detection
→ optional AI upscale
→ AI replacement row + icon_cache
→ card rendering
→ picker reopen/reload
→ persistence across app relaunch
```

A change at one stage is not accepted until the downstream stages still satisfy their contracts.

### Historical evidence that shapes this repair

- The useful crawler architecture predates the AI-upscaling work. July history (`1b03858`, `1a7cf9c`, `aa9fead`, `d09fc10`, `36bbf19`) shows progressive improvement toward ordinary search for the official website plus first-party extraction and targeted image/dork discovery. Even the best states still admitted unrelated-image pollution, so no historical commit should be blindly restored.
- Search-provider availability and relevance are different problems. Google/image-search paths have previously produced useful discovery but also Cloudflare/429/anti-bot failures. A provider failure must not be interpreted as “this brand has no icon.”
- `9e091c1` and `3ac6928` repaired responsiveness/progressive behavior. They did **not** prove crawler search quality. Preserve that responsiveness work while repairing correctness.
- The crawler has historically admitted technically valid but unrelated images. A URL/image that downloads successfully is not proof of brand correctness.
- A particularly damaging earlier mistake was crawl-time upscaling: tiny crawled icons were converted to 256px before storage. That obscured actual source resolution, interfered with low-resolution/model selection, and helped create the upscaling rabbit hole.
- Other historical repairs got model execution working while failing to persist/display its result correctly, or introduced picker reload/cache races, blank candidates, duplicate identity problems, and UI freezes.
- Current crawl-time automatic upscaling is intentionally disabled. A crawled 16×16/32×32/64×64 raster must remain identifiable as the original low-resolution source so the picker can correctly offer optional upscale.
- Therefore crawler quality, picker behavior, cache/card behavior and upscale integration are not separable from a data-contract perspective.

### Frozen full-pipeline contracts

These invariants are locked before crawler discovery changes begin.

1. **Original-source contract**
   - Crawler persistence stores the downloaded source bytes, actual detected format and original dimensions.
   - Discovery and ranking do not mutate pixels.
   - Do not reintroduce automatic crawl-time upscaling.

2. **Candidate-identity contract**
   - A crawl candidate's stable identity derives from its source/original bytes and URL/provenance.
   - Display processing must not silently change that identity.
   - Dedupe must not merge different brands merely because a universal URL was seen elsewhere.

3. **Resolution contract**
   - `originalWidth` / `originalHeight` describe the crawled input.
   - `isLowResIcon()` and optional AI-upscale eligibility continue to use the original resolution even when display/output bytes are later transformed.

4. **Format contract**
   - Detected content wins over a misleading URL extension.
   - SVG/raster identity survives crawler → DB → picker → processing.
   - HTML/JSON/error responses are never admitted as icons merely because their URL looks image-like.

5. **Provenance contract**
   - `source` and `originalUrl` remain meaningful through selection and processing.
   - New crawler confidence/provenance data must not overload existing fields with incompatible meanings.
   - Brand confidence and visual/image quality are separate concepts.

6. **Picker contract**
   - Accepted crawl results appear progressively.
   - A refresh does not clobber already-visible good results with a transient empty collection.
   - Reported bad/broken icons remain hidden according to existing picker semantics.
   - The picker is tested through the real interaction: **long-press the subscription card icon**.

7. **Manual-selection contract**
   - Crawler activity never overwrites an icon explicitly selected by the user.

8. **Auto-promotion contract**
   - If automatic crawler promotion remains, it may replace crawler-owned/default state only.
   - It must never silently replace manual or AI-owned state.
   - Cache ownership must become explicit enough that this is enforced rather than inferred accidentally from whatever currently occupies `icon_cache`.

9. **Upscale-eligibility contract**
   - A genuine small crawled raster (for example 16/32/48px) continues to expose the Upscale action based on original dimensions.
   - SVG/high-resolution assets do not receive an inappropriate low-resolution action.

10. **AI-replacement contract**
    - AI upscale replaces the intended source candidate, persists the AI result, promotes the result to cache, and yields one coherent picker tile.
    - Never allow the old failures: source disappears with no replacement, duplicate replacement tiles, transformed output discarded in memory, or transient blank picker state.

11. **Notification/atomicity contract**
    - Multi-step AI replacement remains effectively atomic to observers.
    - Preserve silent intermediate writes plus one final notification (or an equivalently safe transaction) so the picker does not reload halfway through replacement.

12. **Card contract**
    - Selecting/upscaling changes the card to the expected persisted icon.
    - Later discovery cannot undo an explicit choice.

13. **Lifecycle contract**
    - Close picker during crawl → crawler continues.
    - Reopen picker → current/progressive candidates are available.
    - Select/upscale → close/reopen → same selected result remains.
    - Kill/relaunch → persisted choice remains.

14. **Responsiveness contract**
    - Crawling does not return to synchronous bulk JS work.
    - AI inference does not reintroduce the prior UI freeze.
    - Progressive publication and bounded/yielding work remain required.

### Target crawler architecture

The crawler repair is a staged resolver. Finding a URL, establishing the official brand domain, and accepting an icon are separate decisions.

#### 1. Resolve a trustworthy official-domain candidate

- Normalize company/brand tokens while preserving meaningful names/aliases.
- Generate a small number of deterministic domain guesses, but treat guesses as hypotheses rather than truth.
- Use ordinary web search primarily to discover website/domain candidates.
- Rank domains using brand-token agreement, search-result position, host/path evidence, and explicit penalties/denials for search engines, social networks, app stores, aggregators and unrelated third parties.
- Do not treat “first link in search HTML” as automatically official.

#### 2. Extract first-party icon evidence

Once a domain is sufficiently likely to be official, fetch that site and prioritize:

1. web-manifest icons
2. `apple-touch-icon`
3. declared `<link rel="icon">`
4. high-quality favicon/PWA paths
5. JSON-LD organization logo
6. tightly constrained logo metadata/assets with first-party or justified CDN provenance

Keep correct document-relative and manifest-relative URL resolution. Generic `<img>` crawling is not a normal candidate source; an image needs strong logo semantics and trustworthy page/domain provenance.

Open Graph, Twitter and generic JSON-LD `image` values are not automatically logos.

#### 3. Separate discovery from acceptance

Internally, crawler candidates carry evidence such as:

- requested brand
- candidate URL
- discovered/official domain
- page/referrer that vouched for the candidate
- extraction type
- provider
- brand-confidence signals
- format/dimensions when known

Before publication, validate decodability/content and brand relevance. `scoreIconQuality()` may help rank visual/source quality **after** relevance passes; it must never stand in for brand correctness.

#### 4. Rank confidence before image quality

A 512×512 random hero image is worse than a 64×64 verified official icon.

Preferred trust order:

```text
verified official manifest / apple-touch / structured logo
→ verified official favicon/PWA asset
→ strongly attributable brand asset
→ constrained image-search fallback
→ reject/withhold weak candidates
```

Low-confidence candidates do not enter the ordinary picker merely to increase candidate count.

#### 5. Keep image search as a constrained fallback

Image-search/dork providers are enrichment, not the source of truth.

- Use only after direct/official-site discovery is insufficient.
- Require meaningful attribution to the brand/confirmed domain or another strongly brand-associated source before publication.
- Reject generic aggregators, random page media and provider thumbnails without trustworthy provenance.
- Google/DDG/Bing/etc. remain best-effort; no single scraped provider is a required dependency.
- No paid API is assumed as the solution.

#### 6. Preserve progressive execution

Keep the useful responsiveness properties restored by `3ac6928`:

- stages discover progressively
- accepted candidates publish incrementally
- image processing/downloading remains bounded
- yield to the UI between expensive work
- stale/superseded work cannot publish into a newer crawl generation

#### 7. Make terminal/cache semantics truthful

Distinguish at least:

- successful crawl with useful trusted result
- exhausted/no trusted result
- transient provider/network failure
- rate-limited/deferred
- failed

Only a genuinely successful/high-confidence terminal state deserves a long success TTL. Temporary 403/429/timeouts/parser/provider failures must not poison the brand as permanently complete.

#### 8. Make diagnostics explain failures

Development diagnostics should expose enough evidence to answer:

- which domain hypotheses were generated
- what search providers returned
- which domains were rejected and why
- which pages were fetched
- which icon candidates were extracted
- which candidates were rejected and why
- confidence/quality ordering
- publication order
- rate-limit/transient failure state
- terminal crawl reason

“No icons” without diagnostic evidence is not sufficient for this recovery.

### Execution plan

Do **one tranche at a time**. Do not carry a downstream regression into the next tranche.

#### Major Fix Tranche A — Characterize and baseline before changing crawler behavior

First protect the existing downstream contracts.

- Add characterization tests/pure seams where practical for:
  - original bytes/dimensions/format
  - crawl-result persistence/update semantics
  - URL canonicalization/dedupe
  - candidate identity
  - picker ordering/visibility
  - low-resolution eligibility
  - manual/cache ownership
  - AI replacement persistence
  - report/hide behavior
  - notification behavior
  - stale generation behavior where a pure seam exists
- Use fixture tests rather than live search HTML as the unit-test oracle.
- Establish emulator characterization scenarios for behavior that genuinely requires native runtime/UI.
- Capture a current-HEAD crawler baseline **before** modifying search behavior.
- Clear crawler/discovered-icon state for fresh discovery without indiscriminately deleting explicit selected-icon state.
- Record provider failures, candidates, sources, URLs, original dimensions, wrong-image results and first-result timing.
- This tranche does **not** repair crawler discovery.

#### Major Fix Tranche B — Official-domain discovery

- Refactor search/domain discovery into provider-independent normalized domain results.
- Introduce explicit domain confidence/rejection reasoning.
- Treat provider blocked/rate-limited/transient outcomes distinctly from a successful empty search.
- Keep downstream crawl-result/picker/upscale publication contracts frozen.
- Do not combine extraction/ranking redesign into this tranche.

#### Major Fix Tranche C — First-party extraction

- Tighten HTML/manifest extraction to structured icon/brand evidence.
- Keep/fix manifest-relative and document-relative URL handling.
- Remove unconstrained generic page-image pollution.
- Add fixtures for reversed attributes, relative manifests/icons, malformed metadata, duplicates, same-site/justified CDN assets, and misleading `logo`/`icon` URLs.
- Keep the downstream publication contract unchanged.

#### Major Fix Tranche D — Provenance-aware acceptance and ranking

- Carry provenance/evidence through the internal crawler pipeline.
- Gate publication on brand confidence.
- Apply visual/source quality only after relevance.
- Canonicalize/dedupe candidates without losing brand ownership.
- Preserve original source bytes and metadata.
- Continue progressive publication.
- Do not change AI models/training.

#### Major Fix Tranche E — Resilience, terminal state and cache ownership

- Add/finish stale-generation cancellation around network and publication stages.
- Bound concurrency and retries without monopolizing JS.
- Implement truthful transient/rate-limited/exhausted/success terminal semantics.
- Prevent transient provider failure from becoming a long-lived “complete.”
- Make cache ownership explicit enough that crawler auto-promotion cannot overwrite manual/AI choices.
- If persistence/schema changes are necessary, isolate them in a versioned migration with compatibility characterization; do not bundle them invisibly into search changes.

#### Major Fix Tranche F — Full end-to-end acceptance

Build/install/launch and validate the complete pipeline with at least these eight real subscriptions:

1. Netflix
2. Spotify
3. GitHub
4. Linear
5. 1Password
6. Miro
7. Toggl Track
8. Backblaze

This deliberately includes common and uncommon/ambiguous brands. Do not hard-code behavior around the test list.

For representative low-resolution results also exercise:

```text
fresh crawl
→ candidate appears progressively
→ long-press card icon
→ picker shows correct candidate
→ original dimensions make Upscale eligible
→ run AI upscale
→ AI result appears/persists as one coherent tile
→ card uses expected result
→ close/reopen picker
→ relaunch app
→ persisted result remains
```

Also:

- manually select a candidate, run/re-run crawler, prove the manual choice remains selected
- verify SVG/high-resolution candidates are not incorrectly treated as low-resolution
- close/reopen picker during an active crawl and prove background/progressive behavior survives
- verify reports continue hiding incorrect/broken candidates
- inspect crawler/network diagnostics for provider failures and queue state

### Mandatory regression gate after every implementation tranche

Every crawler implementation tranche must pass the cross-layer gate before work continues:

```text
relevant characterization tests + tsc + lint
→ Android build/install/launch
→ crawler discovery smoke
→ long-press picker smoke
→ selection/card persistence smoke
→ low-resolution/upscale integration smoke
→ picker reopen/relaunch smoke where applicable
```

A static pass or successful build is not enough.

If a tranche produces any form of:

```text
crawler fixed, picker broken
picker fixed, upscale broken
upscale fixed, crawler broken
```

**STOP.** Repair or revert that tranche before moving on.

The project must not accumulate cross-layer breakage and continue forward again.

### Major Fix acceptance contract

Crawler quality is **precision-first**.

- 8/8 test subscriptions finish without UI freeze or React Native fatal.
- Target 8/8 with at least one clearly brand-correct discovered candidate; minimum acceptance is 7/8 with a diagnosable miss rather than a random substitute.
- **0 wrong-brand/random-content candidates presented in the ordinary picker across the validation set.**
- First accepted candidate appears progressively rather than only after the entire crawl.
- A temporary search/provider failure does not permanently poison the brand as complete.
- Canonically identical URLs do not produce duplicate candidates.
- Stale crawl generations cannot publish after refresh/supersession.
- Explicit manual selection survives later crawling.
- Original low-resolution metadata survives discovery and correctly enables optional upscale.
- AI-upscaled output is persisted, presented once, reflected on the card, survives picker reopen and app relaunch.
- SVG/high-resolution inputs do not receive inappropriate low-resolution treatment.
- TypeScript, lint/relevant characterization tests, Android build, install/launch, and actual user reproduction all pass.

A technically valid/downloadable image that is not the intended brand is a **failure**, not a partial success.

### Hard non-goals and safeguards

- **No model retraining. Training remains frozen.**
- Do not modify model/training files as part of crawler recovery.
- Do not recommend paid compute or paid search APIs to compensate for unproven crawler logic.
- Do not restore a historical crawler commit wholesale; history provides evidence and useful mechanisms, not a proven drop-in solution.
- Do not conflate responsiveness with crawler correctness.
- Do not conflate image resolution/quality with brand correctness.
- Do not reopen the frozen inference/model strategy while repairing discovery.
- One root problem/tranche at a time.
- Apply the project three-strike safeguard: after three failed implementation attempts against the same root issue, stop, preserve evidence, give the user a detailed resume, agree on a materially different approach, update this plan, commit it, then resume.

### Major Fix completion rule

Do not mark this section complete, unblock Phase 6, or describe the crawler as fixed until the full end-to-end acceptance contract above has been demonstrated on emulator/device.

---

## Icon crawl quality — hops 1–5 (proven on device 2026-08-25)

**Named outcome:** given a real subscription (scan-imported or typed), the crawler auto-assigns a **brand-correct** icon, rejects blank/transparent defaults, keeps random page images out of the picker, and still surfaces a useful set of *related* icons.

Do **not** restore an old crawler commit. Close the holes in the current staged resolver. Training stays frozen.

### Diagnosis (2026-08-24)

Git does **not** show a restore of the July crawler. Last crawler edit is `d55bbf3` (Tranche E). Later `ed16b0f` only *starts* the existing crawl after Scan import. `370dc55` reverted premature Tranche B; B was rewritten as `fbf7107`. This is the current mixed pipeline: later precision/ownership/responsiveness patches on incomplete official-domain discovery, plus older loose gates still live.

**Why it feels like the old bugs came back**

1. **Card locks the first valid download.** `9e091c1` cut `IMMEDIATE_FETCH_BATCH` 12 → 2. Tranche E `canAutoAssignCache` treats any valid cache row as user-chosen.
2. **Official domain is wrong or missing.** Scan has `noreply@proton.me` and throws the host away; TIER 0 guesses `proton.com` via the DDG SPA. Scorer gives `+10` to `.com`.
3. **Random images leak.** `queueDirectFromLink` has no provenance gate. OG/Twitter/generic JSON-LD `image` still count as logos.
4. **Blank/transparent rejection covers the card** (`2d0ba23` + `32521cb`). JPEG/WebP/GIF/ICO + near-white plates refused. Card/create/edit auto-select only **paintable rasters** (`isPaintableCardIcon`). Valid SVGs stay in the picker. Monochrome logos (Netflix N) must not be treated as cream plates.
5. **Fewer real icons is a yield collapse**, not a missing `searchAllSources`.

Not a `git restore`. Not a training/upscale problem. Not a wholesale checkout of `1072b28` / `3e3546c`.

### Shared contracts (every hop)

- Store original downloaded bytes, format, and dimensions. **No crawl-time upscale.**
- Explicit user/AI picker choice is never overwritten.
- Wikipedia / social / app-store / aggregator / search exclusions stay.
- Name/slug stays the card / `icon_key`. The host is crawl evidence, not the display name.
- One hop at a time. Prove the hop’s gate before the next.

### Hop 1 — Official domain (two tracks) — **proven (`466cde7`)**

Scan already has a host. Manual add only has a name. **`.com` must not be the first official guess on either path.**

**Track A — Scan-found:** sanitize the From-host (`proton.me`) and pass it as `officialDomain`. Peel mailer labels; reject ESP/CDN and payment-processor hosts. Persist on the crawl session. No subscription-schema change.

**Track B — Manual add:** query `html.duckduckgo.com/html/?q=` (not the SPA). Score brand agreement only — **no `.com` bonus**. Accept official only if the host clears the confidence bar and contains the brand token. If search is blocked or empty: **no official domain** (do not scrape a wrong `.com`). Persist a search-discovered host on the crawl session.

**Gate (device, 2026-08-25):** `5dc46ed` x86_64 APK installed `-r` on existing `emulator-5554` (`lastUpdateTime=22:22:41`). Typed Linear ranked `https://linear.app` (high, score=100), not `.com`. Typed Proton used seeded `https://proton.me`. Typed Ground News ranked `https://ground.news` (high, score=95) and rejected wikipedia/facebook/reddit. TIER 0.5 ran on those hosts. Live Scan said “No new subscriptions”; scan From-host seed was not re-proven this install.

### Hop 2 — Stop locking the first progressive icon — **proven (`71a3840`)**

Distinguish crawler-owned cache vs user/AI-chosen cache. Re-run `pickBestIcon` as better valid candidates arrive. Never overwrite an explicit picker/AI choice.

**Gate (device, 2026-08-25):** Typed Linear first auto-assigned `official_favicon`, then upgraded to `spider:apple_touch_icon` on the create preview (flat mark → sharper 3D mark) before Create. User/AI `chosen` lock was not re-run this install (picker tap did not leave a chosen-cache log).

### Hop 3 — Close the random-image holes — **leftover-slug + picker gate proven on device (`6d54b0d` + `6c47871`)**

`queueDirectFromLink` uses the TIER 3 provenance gate. OG / Twitter / generic JSON-LD `image` are not logos unless there is a real logo signal. Rank provenance before `scoreIconQuality`. Tighten `looksLikeDirectImage` / brand-token. Leftover typing prefixes (`ne` / `net` / `spo` / `pro`) are not crawlable (`6c47871`).

**Gate:** Picker for 5 diverse brands shows brand-associated icons only.

**Gate (device, 2026-08-25):** leftover-slug APK (`6c47871`, built 15:19) installed `-r` on existing `emulator-5554` (package `lastUpdateTime=15:22:34`). Do **not** launch a second emulator / `--install` while that device is up.

- Create leftover-slug: typed `ne` stayed plus (no crawl). Typed `net` stayed plus after debounce; Netflix autocomplete only; **no Bing auto-assign**.
- Long-press picker (not create auto-select). Painted tiles were brand-associated. Empty cream tiles are unpaintable SVGs (RN `Image`; known Hop 4). No Bing / OG / random photos on the asserted rows.
  1. Ace Hardware — card red ACE; picker 52 icons; first visible tiles cream SVG plates.
  2. Proton typed (Cloud $9.99) — purple P plus cream SVG plates; 33 icons.
  3. Figma — Figma mark plus cream SVG plates; 63 icons.
  4. Notion — brand cube only (1 icon).
  5. Linode (uncommon, scan $93) — after Search Online: cream SVG + green cubes; `[CRAWL] startIconCrawl for linode`; simple-icons SVG + icons8 PNG.
- Extra: scan Proton (Other $5) — purple P plus cream SVG plates (same collection as typed Proton). Porkbun (uncommon, scan $47.74) — after Search Online: cream SVG + coral/red mark; `[CRAWL] Auto-assigned best valid icon for porkbun (source=favicon)`.

Ranking / TIER 3 / HTML extraction / `IMMEDIATE_FETCH_BATCH=2` / picker render / `SubscriptionCard` were **not** changed to “fix” leftover-slug. Card still uses RN `Image` (no `expo-image` / `SmartIcon`). Do not checkout `063ac4b` / `3c10700`.

### Hop 4 — Blank/transparent cannot become the default — **proven (`2d0ba23`, `32521cb`)**

Visible-pixel / empty checks past PNG (JPEG/WebP/GIF/ICO). Flat **near-white** plates are refused; dark monochrome marks are not. `isPaintableCardIcon` skips SVG for card / create / edit auto-select because RN `Image` cannot paint SVG. Picker can still list valid SVGs. Invalid cache remains healable after Hop 2. Card still uses RN `Image` (no `expo-image` / `SmartIcon`). Crawler tree is last-good `7309add` + spinner `210c908` — **not** `063ac4b`.

**Gate (device, 2026-08-25):**
- `2d0ba23` x86_64 APK installed `-r` on `emulator-5554`. Home Ace plus (not empty box); typed Ace preview plus then red ACE; created card ACE.
- `2d0ba23` then over-rejected monochrome PNGs and auto-assigned unpaintable SVGs, so create preview stayed plus until a later ICO (`No valid icons to auto-assign for netflix`). Crawler file was unchanged vs `210c908`.
- `32521cb` x86_64 APK installed `-r`. Home Ace still red ACE. Typed `spotify` auto-selected green mark. Log: `[CRAWL] Auto-assigned best valid icon for spotify (source=icons8)`. `tsc` + `iconValidation` tests passed.

Leftover-slug crawls (`ac` / `ne` / `sp`) closed on device by `6c47871` (Hop 3 gate above). Do not checkout `063ac4b` / `3c10700`.

### Hop 5 — Yield, after precision is back — **proven (`5dc46ed`)**

`IMMEDIATE_FETCH_BATCH` 2 → 6 so more first-party/library candidates download before the shared queue. Not a checkout of `063ac4b`. Spider / TIER 3 still provenance-gated.

**Gate (device, 2026-08-25):** Linear immediate fetches were six first-party URLs (`favicon.svg`, apple-touch, precomposed, android-chrome 512/192, favicon.ico). Created Linear picker: **19 icons available**, footer **20 valid icons saved**. Proton picker after Search Online: **33 icons available**, purple P plus cream SVG plates (RN `Image`; known Hop 4). No Bing/OG photos on those grids.

### Validation (required after each hop)

Wipe icon cache + crawl results for the test keys. Crawl at least 5 real, diverse names including Proton (scan **and** typed) and an uncommon company. Watch progressive results. Confirm brand-correct icons. Long-press the card icon. Check logs for official host, untrusted rejects, and rate limits.

**Act next:** Wave 1 Connect status: #1 Outlook Graph proven (`e5bde4c`), #2 Google Workspace proven (Gmail API enablement; see 2026-09-02 log), and the Outlook `IDX14100` corrupt-token incident is RESOLVED (root cause + reconnect fix, see 2026-09-02 second log row). Remaining: IMAP last-row; O365 fresh sign-in needs `M365_USER`/`M365_PASS` in `.env`. Optional hardening (not started): Graph refresh-before-list so an expired token self-heals instead of requiring Edit → Reconnect. New deferred hole: the icon crawler's retry backlog saturates the JS thread for tens of minutes and drops UI taps (seen 2026-09-02); needs queue cap/backoff, separate hop. Icon hops 1–5, the xAI compound-label hop, and Cadence identity are closed. Do not restore `063ac4b`. Do not start the `x.` social-exclusion hop — this crawl used `official=x.ai`, not Twitter.

---

## xAI compound-label hop — proven (`029c509`, 2026-08-26)

**Named outcome:** Scan of `billing@x.ai` must display **xAI** (not **X**) and start icon crawl with slug `xai` / `official=x.ai`.

**Cause:** `merchantFromAddress` took the left label only (`x`). `nameToSlug("X")` → `x`. `startIconCrawl` refuses slugs shorter than 3 chars, so the picker stayed empty.

**Rule (user-locked):** two-label host, TLD exactly 2 letters, `label.tld` length ≤5 → display `label` + uppercased TLD, no dot. `x.ai` → **xAI** / `xai`. `ok.ai` → **okAI**. `x.com` stays **X** (3-letter TLD). `proton.me` stays Proton (host longer than 5).

**Code:** `shortTwoLetterTldMerchant` in `classifier.ts`. `PARSER_VERSION` 10 → 11 so cached From-hosts reclassify. Classifier tests cover `x.ai` / `ok.ai` / `x.com`. Existing Home **X** rows do not auto-rename (`name::mailbox`); delete then Scan.

**Gate (device, 2026-08-26):** `029c509` x86_64 release APK installed on `emulator-5554` (`lastUpdateTime=2026-08-26 00:05:15`). Deleted leftover Home **X**. Live Scan: “Added 1 subscription(s).” Card **xAI** sparse. Logs: `[CRAWL] startIconCrawl for xai (sub: 1787718296217; official=x.ai)`; TIER 0 seeded `https://x.ai`; `[CRAWL] Auto-assigned best valid icon for xai (source=official_site)` from `https://x.ai/images/news/grok-bot-more-plans-og.webp`. Long-press picker: **4 icons available**, first-party x.ai tiles (not Twitter). Social `x.` exclusion did not fire on this path.

---

## Phase 6 — Ship polish ⬜

**Goal:** Close the loop for a releasable cut without training. **Starts after Phase 5.5 is Done.**

### Planned

- [ ] Confirm Settings cloud/backup copy on device (screenshot or manual)
- [ ] Optional: brand spot-check list from Phase 2 residual
- [ ] Lint + `tsc` + release APK path documented once (`build-out/apk/` after 5.5-A)
- [ ] Note known limitations (OAuth client config, training freeze, sync = user tables only)
- [ ] No new features unless blocking ship

### Already done earlier (may be refreshed in 5.5-F)

- [x] README points at plan + AI upscaling docs (paths updated again in 5.5-B)

### Out of scope for Phase 6

- Retrain FSRCNN/ESPCN
- New cloud providers
- Schema v9 unless a ship blocker appears
- Large refactors (belong in 5.5, not here)

---

## Frozen (do not reopen casually)

| Area                 | Rule                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Training**         | Frozen — see `docs/AI_UPSCALING.md` §2. Entry remains `npm run train:models:force` only when explicitly unfrozen. |
| **Inference hybrid** | `bilin + 0.25 · clamp(residual)` — brand-safe defaults in `iconProcessing.ts`                                     |
| **TFLite export**    | Float32 only — never default quant                                                                                |

---

## Standard gate (every phase / risky tranche)

```bash
npx tsc --noEmit
npm run build:android:x86_64   # install + launch on emu when self-contained
# logcat: Running "main", no RN fatal; crawler may start
```

---

## Related docs

| Doc                                         | Role                                 |
| ------------------------------------------- | ------------------------------------ |
| [`docs/plan.md`](./plan.md)                 | **This file** — execution phases     |
| [`docs/AI_UPSCALING.md`](./AI_UPSCALING.md) | AI/train/inference SSOT              |
| [`README.md`](../README.md)                 | App overview / scripts (stays root)  |
| [`docs/BUILD.md`](./BUILD.md)               | Android build (`BUILD_FULL` removed) |

---

## UI Improvements — post-Major-Fix (2026-08-14)

**Status:** Phases 0–3 complete (`ba66478`, `e4e383e`, `77a83bb`, `913b08f`). **Home/Insights hops A–E proven** (`ff3f3b9`–`b510a35`). **Phase 4 (email account scan) is NOT done.** Scan-brain + Settings code landed (`4cc7a87`, `b52e2c6`, `0d6fa10`) and Proton/Tuta later imported live rows, but the provider catalog and UI copy still contradict official mail-API docs. Proton/Tuta are **not** IMAP; they connect via **client REST + on-device decrypt** (H4/H5). Do not treat current code as Phase 4 complete. Phase 5 graph is not started. Phase 6 ship polish stays after UI Phase 5.

Four user-requested improvements, one phase at a time. Current-code map: [`docs/CODEBASE.md`](./CODEBASE.md). Visual gates use [`.cline/skills/emulator-ui-driving/SKILL.md`](../.cline/skills/emulator-ui-driving/SKILL.md).

### Why Phase 0 exists

The predecessor claimed Phase 0 done after commit `56bd161`. That commit only appended a thin stub, an 83-line overview, and a skill rewrite. The Phase 0 boxes were still unchecked. A “full current-codebase overview” and a Major-Fix-style plan with per-task programmatic **and** visual gates were not actually delivered. This rewrite is the real Phase 0.

### Observed product problems (evidence, not guesses)

These four were the 2026-08-14 starting bugs. They are **not** a current-state map.

1. **Native nav overlay / dead tap zone.** Floating tab bar is `position: "absolute"` with `bottom: Math.max(insets.bottom, 20)` and height 72 (`app/(tabs)/_layout.tsx`). Lists used `contentContainerClassName="pb-25"`, but `global.css` / `theme.ts` spacing jumps **24 → 30** — there is **no `--spacing-25`**, so that class is a no-op. Create sheet pins submit at `px-5 pb-5` (`CreateSubscriptionModal.tsx`). On-device, the Create button center sat under the Android nav; only the uncovered top slice was tappable. **Hop A (`ff3f3b9`)** reserves `pagePadding` (pill + lift) and omits SafeArea bottom so the viewport ends at the pill top. **Do not restyle the tab bar.**
2. **Subscriptions has no add control.** Home header `icons.add` opened `CreateSubscriptionModal`. `app/(tabs)/subscriptions.tsx` had search/filters/cards only. **Phase 2 (`77a83bb`)** added the header `+`.
3. **Insights chart overflows.** “Estimated Monthly Spend” was a non-scrolling `flex-row` (`insights-chart-scroll` is a class name, not a `ScrollView`). Period chips below _are_ in a `ScrollView`. 6-month / Year add more labeled bars than the card width. **Phase 3 (`913b08f`)** made the bar row a horizontal `ScrollView`. **Hop E (`b510a35`)** retitled it **Monthly spend from mail** and fills bars from mail charges, not cloned run-rate.
4. **No email account scan.** Settings had Clerk account + cloud _file_ sync (Drive/Dropbox/…). There was no mailbox connect/scan. A subscription is an account (including $0), not only a receipt. SSO catalogs have no public client API (backburner). Scan-brain later landed; Proton/Tuta import live rows; Phase 4 is still not complete.

**Current after hops A–E (2026-08-24 device):** Home Monthly Spend **$122.98**. Sparse cards default to this-month mail (Linode **$93**; Porkbun this month **$0**, this year **$47.74**). Insights this-month actuals **$122.98** / recurring **$29.98** / sparse **$93** / top merchant Linode. Chart: This Month one **Aug $122.98** bar; Last 3 Months **Jun $29.98 / Jul $94.72 / Aug $122.98**; Year 12 bars Sep→Aug. Live Jul is **$94.72** because Porkbun mail sits in **July**, not the January test fixture. After a Year swipe, This Month can look empty until remount (leftover horizontal offset) — note, not a new hop.

### UI board

| Phase | Name                          | Status               | Touches                                                                          | Must not touch                       |
| ----- | ----------------------------- | -------------------- | -------------------------------------------------------------------------------- | ------------------------------------ |
| **0** | Docs + generic emulator skill | **Done (`ba66478`)** | `docs/plan.md`, `docs/CODEBASE.md`, `.cline/skills/emulator-ui-driving/SKILL.md` | App source, models, crawler          |
| **1** | Native nav overlay            | **Done (`e4e383e`)** | Tab list padding; Create + picker (+ shared sheets) inset padding                | Crawler, models, schema              |
| **2** | Subscriptions `+`             | **Done (`77a83bb`)** | `app/(tabs)/subscriptions.tsx` + existing modal wiring                           | New create flow, crawler             |
| **3** | Insights chart bounds         | **Done (`913b08f`)** | `app/(tabs)/insights.tsx` Estimated Monthly Spend row                            | Period-chip `ScrollView`; other tabs |
| **4** | Email account scan            | **NOT done**         | Settings email-scan list + mail OAuth/IMAP + scan cache                          | SSO catalogs, crawler, training      |
| **5** | Subscription dependency graph | Not started          | Subscriptions List/Graph toggle + `dependsOn` links                              | Email scan implementation, crawler   |

### Home / Insights hops (2026-08-24)

Closed after live device gates. Do not start another hop from leftover Year→This Month scroll.

| Hop | Name | Status | Live gate |
| --- | ---- | ------ | --------- |
| **A** | Nav overlay / mid-scroll clip | **Done (`ff3f3b9`)** | Viewport ends at pill top. List `185–2085`, pill `2085–2274`. Tab bar style unchanged. |
| **B** | Scan starts icon crawl | **Done (`ed16b0f`)** | Import no longer hardcodes `icon_key: plus`. OpenAI bloom + Porkbun pig landed on Home. Crawler quality still later. |
| **C** | This-month sparse actuals | **Done (`30de520`)** | Linode **This month $93**. Monthly Spend **$122.98**. Porkbun this month **$0**, tap → this year **$47.74**. Stored cadence unchanged. |
| **D** | Insights this-month actuals | **Done (`a6e6774`)** | This-month **$122.98**, recurring **$29.98**, sparse **$93**, top merchant Linode **$93**. |
| **E** | Insights mail bars | **Done (`b510a35`)** | Title **Monthly spend from mail**. This Month **Aug $122.98**. Last 3 **Jun $29.98 / Jul $94.72 / Aug $122.98**. Year 12 bars Sep→Aug; Jan is run-rate (no Porkbun spike). Live Jul **$94.72** (`29.98+17+47.74`); Porkbun mail date is July, not January. |

Note: after Year horizontal scroll, switching to This Month can look empty until remount (leftover offset). A fresh Insights open shows the Aug bar. Not a new hop.

### Shared gates (Phases 1–4)

**Programmatic (every implementation phase):**

```text
npx tsc --noEmit
npm test
npx expo lint          # 0 new errors
```

Then `npm run build:android:x86_64` (install + launch). Logcat: `Running "main"`, no RN fatal.

**Visual (every implementation phase), via the generic skill:**

```text
every UI-affecting adb command
→ adb exec-out screencap
→ read screenshot + vision assert
→ only then the next UI command
```

Locate targets with uiautomator bounds. Do not hardcode button coordinates in the skill or in this plan.

A static pass or a successful build is **not** a completed phase.

**Icon-pipeline smoke after any phase that rebuilds the app:** long-press a card icon still opens the picker; a selected icon still shows on the card. Do not reopen crawler search work here.

---

### Phase 0 — Documentation & generic skill (no app code, no build) ⬜

**Goal:** Agents can implement Phases 1–4 from this plan + `docs/CODEBASE.md` without rediscovering the tree. Visual gates have a generic skill before any emulator work.

#### Tasks

- [x] Append a UI-Improvements section to this file (first stub in `56bd161`).
- [x] Replace that stub with this detailed phase plan (tasks, files, programmatic + visual gates).
- [x] Rewrite `docs/CODEBASE.md` as a real current-code map (routes, padding facts, every component, providers, services, frozen contracts, build scripts).
- [x] Keep `.cline/skills/emulator-ui-driving/SKILL.md` generic:
  - YAML frontmatter `name: emulator-ui-driving` (Cline discovery).
  - Invariant: every UI-affecting adb command (`input tap/swipe/text/keyevent`, `am start/force-stop`) is followed by screencap + vision assert.
  - Generic techniques only: live `wm size`, uiautomator bounds, nav-bar dead zone, keyboard/dropdown dismissal, long-press = `input swipe X Y X Y 800`.
  - **No button-specific coordinates.**
- [x] Revert leftover Phase-1 import-only dirty diffs if present (`subscriptions.tsx`, safeguards one-liner).
- [x] Commit Phase 0 docs/skill only (`ba66478`). **Do not start Phase 1 in the same commit.**

#### Phase 0 acceptance

- This section has per-phase tasks and both gate types (not a four-bullet stub).
- `docs/CODEBASE.md` names the actual files, the `pb-25` / missing spacing-25 fact, Create-button collision, insights non-scrolling bar row, and provider nesting.
- Skill has frontmatter, the invariant, and zero hardcoded control coordinates.
- `git status` shows no accidental app-source edits from the predecessor loop.

**No build / no emulator in Phase 0.** That was an explicit user constraint.

---

### Phase 1 — Native navigation overlay ✅

**Goal:** Primary actions and list tails sit above the floating tab bar **and** the Android software nav. Create Subscription is tappable at its real center, not a leftover sliver.

#### Root cause (from code)

```text
tabBar.bottom = max(insets.bottom, 20)
tabBar.height = 72
list clearance class pb-25 → undefined token
modal submit pb-5 = 20px
```

Needed clearance is approximately `tabBar.height + max(insets.bottom, tabBar.horizontalInset)` plus a small gap — applied as **style padding**, not a missing NativeWind token.

#### Tasks

- [x] Add a single shared bottom-offset helper (or inline the same formula) from `useSafeAreaInsets()` + `components.tabBar`. Do not invent a `pb-25` token unless the theme scale is updated in the same change.
- [x] Apply it to list `contentContainerStyle` on Home, Subscriptions, Insights, Settings (replace the no-op `pb-25`).
- [x] Apply it to pinned/footer actions in `CreateSubscriptionModal` and `SubscriptionIconPickerModal`.
- [x] Apply the same inset to other sheets that share `.modal-container` / `pb-5` if their last button is similarly covered (`EditSubscriptionModal`, `SubscriptionStatsModal`, `ConfirmModal` as needed). One issue: overlay collision. Do not restyle unrelated chrome.
- [x] Do **not** start Phase 2 (`+` button) in this commit.

#### Programmatic gate

- `tsc` / `jest` / lint as above.
- Build + install + launch.

#### Visual gate (skill loop)

1. Launch app → screenshot: running UI, nav bar visible.
2. Home: scroll list to end → last card is above the tab pill, not under nav.
3. Open Create from Home `+` → screenshot: **Create Subscription** label fully visible; tap **center** of that button → modal submits / closes. A tap that only works on the top sliver is a fail.
4. Subscriptions / Insights / Settings: scroll to end → same clearance.
5. Long-press a card icon → picker sheet footer (Upscale / report chips) fully above nav; tap center of a footer control works.
6. Icon-pipeline smoke: picker still opens; no RN fatal.

---

### Phase 2 — Add-subscription `+` on Subscriptions ✅

**Goal:** Subscriptions tab can create a sub without routing back to Home.

#### Tasks

- [x] Add a header row matching Home: title + `icons.add` `Pressable`.
- [x] Wire the existing `CreateSubscriptionModal` (`visible` / `onClose` / `onCreate` → `addSubscription` from `useSubscriptions`), same as `app/(tabs)/index.tsx`.
- [x] Keep search + All/Upcoming filters.
- [x] After Phase 1, the new header must not collide with anything; the modal inherits Phase 1 inset.

#### Programmatic gate

- Same static + build gate.
- No new create-service; reuse context.

#### Visual gate (skill loop)

1. Open Subscriptions tab → screenshot: `+` visible and tappable (not under status bar / not off-screen).
2. Tap `+` → Create sheet opens.
3. Create a named sub (type name, dismiss keyboard, tap Create **center**) → sheet closes; new row is in the list.
4. Home still has its `+`; both entry points create the same kind of row.

---

### Phase 3 — Insights chart stays in bounds ✅

**Goal:** 6-month and 1-year Estimated Monthly Spend bars stay inside the card. Overflow is a fail.

#### Root cause (from code)

`app/(tabs)/insights.tsx` maps `monthlyChartData` in a `View` with `className="insights-chart-scroll flex-row items-end justify-between"`. That is **not** a `ScrollView`. Every bar has an `insights-chart-value` label. Period chips underneath already scroll.

#### Tasks

- [x] Make the **bar row** (not the period chips) a horizontal `ScrollView` inside the card.
- [x] Give each bar a fixed min-width so 6/12 bars do not squash or spill.
- [x] Condense or hide per-bar value labels when `selectedPeriod` has more than 3 points (6mo / Year).
- [x] Do not change category bars or the summary card unless they share the overflow (they should not).

#### Programmatic gate

- Same static + build gate.

#### Visual gate (skill loop)

1. Open Insights → screenshot This Month: bars inside the card border.
2. Tap `3 Months` → screenshot: still inside.
3. Tap `6 Months` → screenshot: **no bar, value, or label crosses the card border**. Horizontal scroll is allowed; overflow is not.
4. Tap `Year` → same assertion.
5. Cycle back to This Month → layout recovers.

---

### Phase 4 — Email account scan ⬜

**Goal:** Settings lists mailboxes the user can connect **natively**. Scan incrementally maps **accounts** (including $0) into a cached candidate set. The user reviews and imports. Connect without a working `scan()` is not a product. Hollow Google/Apple SSO Connect is **not** this phase.

A **subscription is an account**, not a charge. A bill is optional evidence.

**Phase 4 is NOT done.** Scan-brain, catalog, Settings UI, and SQLite persist landed (`4cc7a87`, `b52e2c6`, `0d6fa10`) but **must not be treated as complete**. On 2026-08-19 IMAP-portal docs were read; on 2026-08-20 Proton/Tuta **client REST** was researched. IMAP is still the wrong Proton/Tuta path. Dropping them was also wrong. Desktop Proton Bridge / tunnels are **not** a product and must not be used to fake a test.

**Blocker (user-locked, 2026-08-28) — Cadence identity before OAuth IDs.** See **Cadence identity** above. Display name **Cadence**, package **`app.picksandshovels.cadence`**, scheme **`cadence://`**, and local Continue are **proven**. Mail client IDs: register against that package + SHA-1 + reply URI **`cadence://auth`**. Proton/Tuta/IMAP do not use those IDs. iCloud/Yahoo/AOL stay under the single IMAP row (one live IMAP test).

**Rule:** branded Connect if the phone can use a real mailbox protocol:

1. Documented **HTTPS mail API + OAuth** (Gmail, Workspace, Outlook, M365, Zoho, Fastmail), or
2. **First-party client REST + on-device decrypt** that Proton/Tuta’s own apps use (H4/H5). Honest password login, not fake OAuth.

Public IMAP hosts use the last **IMAP / IMAPS** row. Do not put a fake Connect logo on iCloud. Proton and Tuta get **their own branded rows** in H4/H5 — **never** the IMAP row.

#### Native list (docs 2026-08-19 + client REST 2026-08-20)

Branded OAuth (HTTPS mail APIs):

| Row                        | Stack / source                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gmail                      | Gmail API `users.messages.list` / `get` + `gmail.readonly`. [Gmail API overview](https://developers.google.com/workspace/gmail/api/guides)              |
| Google Workspace           | **Same Gmail API**, work login / admin consent — **not** the same login as consumer Gmail                                                               |
| Outlook                    | Microsoft Graph delegated `Mail.Read` → `GET https://graph.microsoft.com/v1.0/me/messages`. Use `Mail.Read`, not `Mail.ReadBasic`                       |
| Office 365 / Microsoft 365 | Same Graph API, work/school tenant. Own branded row                                                                                                     |
| Zoho Mail                  | Documented OAuth 2.0 + Mail API. [Zoho OAuth 2.0](https://www.zoho.com/mail/help/api/using-oauth-2.html)                                                |
| Fastmail                   | OAuth `https://api.fastmail.com/oauth/authorize` + token `https://api.fastmail.com/oauth/refresh` + JMAP. [Fastmail API](https://www.fastmail.com/dev/) |

Branded **client REST** (not OAuth, not IMAP) — **the Proton/Tuta solution:**

| Row         | How a phone connects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proton Mail | Same HTTPS API Proton Android/Web/Bridge already call ([go-proton-api](https://github.com/ProtonMail/go-proton-api), [WebClients](https://github.com/ProtonMail/WebClients) `packages/shared/lib/api/*`). Auth: **SRP + session + 2FA** ([go-srp](https://github.com/ProtonMail/go-srp)), not OAuth. Bodies: **OpenPGP** on device ([gopenpgp](https://github.com/ProtonMail/gopenpgp)). There is **no** `developer.proton.me` / third-party OAuth portal. Bridge is desktop-local IMAP only and is **not** this path.      |
| Tuta        | No public API docs today. FAQ invites reading the GPLv3 client: [tuta.com/support#integration](https://tuta.com/support#integration) — _“The Tuta clients use REST services but there is no public documentation… You may of course dig into the open source code… We will add a public API documentation in the future.”_ REST: `/rest/{app}/{typename}`. KDF Argon2id/Bcrypt; decrypt on device. IMAP still refused ([support#imap](https://tuta.com/support#imap)). Switch to official public docs when Tuta ships them. |

Last row — IMAP / IMAPS (no logos). **Public IMAP hosts only:**

| Host use              | Documented path                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| iCloud                | IMAP `imap.mail.me.com:993` SSL + app-specific password. **No POP.** No public mail API. [Apple 102525](https://support.apple.com/en-us/102525) |
| Yahoo Mail            | New-app **mailbox OAuth is closed**. App password + IMAP `imap.mail.yahoo.com`. [Yahoo IMAP](https://help.yahoo.com/kb/SLN4075.html)            |
| AOL                   | Same Yahoo/AOL identity stack. IMAP `imap.aol.com`. No branded OAuth row                                                                        |
| Custom / other public | Generic host / user / app password                                                                                                              |

**Hard product rules**

- Never ask users to install Proton Mail Bridge or make tunnels (`127.0.0.1`, `10.0.2.2`, `adb reverse`).
- Yahoo and AOL **lose** branded OAuth rows (no dead Connect).
- This Expo client still has **no IMAP TCP**. IMAP connect may store credentials; **IMAP fetch is unverified** until a native socket exists.
- Do not IMAP-pretend Proton or Tuta. Do not drop them either.
- Proton/Tuta Connect is **password (+ 2FA)**, not “Sign in with OAuth.” Naive HTTPS without decrypt is ciphertext.
- **GPL:** Tuta client is GPLv3. Do not copy that tree into this app. Reimplement against observed REST + published crypto, or isolate GPL in a separate module. Unofficial libs (e.g. `digitalWestie/tutanota-cli`) are unsupported research, not a ship dependency.

**Shipped code vs this matrix (`0d6fa10`) — still wrong until H1**

| Location                                     | What it says / does                          | Fact                                           |
| -------------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| `catalog.ts` IMAP note                       | “iCloud, **Proton, Tuta**, everyone else”    | Proton/Tuta are **not** public IMAP            |
| `EmailScanSection.tsx`                       | “iCloud / **Proton / Tuta** use IMAP”        | False                                          |
| `catalog.ts` Yahoo + AOL                     | `branded: true`, `auth: "oauth"`             | Mail OAuth closed; path is IMAP + app password |
| `catalog.ts` IMAP `liveScanInPhase4`         | `true`                                       | IMAP fetch cannot run on this client           |
| `providers.ts` `yahooShouldFallBackToImap()` | Falls back only if env client id **missing** | OAuth is closed **even with** a client id      |
| `scan.test.ts`                               | Asserts Yahoo/AOL stay branded               | Locks the mistake in                           |

Keep (aligned): Gmail/Workspace Gmail API; Outlook/M365 Graph; Fastmail OAuth+JMAP endpoints; Zoho branded OAuth _row_; IMAP `scan()` throws `MailScanUnverifiedError`; no branded Proton/Tuta/iCloud logos; shared classifier.

Partial (later H3, not H1): Zoho has no HTTP fetcher yet; Google/Microsoft client ids fall back to Drive/OneDrive env keys; Fastmail first query is narrower than the subject-union scan.

#### Architecture (toggle ≠ scan)

```text
Connect (OAuth or IMAP form)
  → incremental SCAN (network + classify + cache)
  → CACHED MAP (messages + merchant rollups)
  → DISPLAY FILTERS (recurring / sparse / free)
  → user IMPORT into subscriptions
```

- **Scan** writes the cache. First connect fetches the union of account / security / recurring-bill / sparse-bill subjects (recency + count cap). Later scans fetch only **newer than `lastCursor`**. Re-parse an old message only on a parser-version bump.
- **Toggle** only filters the cache. Flipping Recurring / Sparse / Free **does not** hit the network.
- **Import** is an explicit tap. Scan never auto-creates subscriptions.

Provider interface: `id`, `connect()`, persist in secure store, `disconnect()`, incremental `scan()`, cursor. Shared parser does not know Gmail vs IMAP.

Normalized message: `{ mailboxId, messageId, from, subject, date, text?, attachments[] }`.

Cache keys: `(mailboxId, messageId)` plus merchant rollup `(mailboxId, merchantKey)`.

#### Classify — subject first

Subject (plus From) can create a candidate. Body and attachments run **only** for money classes.

| Subject class      | Examples                                                 | Candidate?            | Body / PDF? |
| ------------------ | -------------------------------------------------------- | --------------------- | ----------- |
| **Account**        | welcome, registered, verify email, account created       | Yes → free / unknown  | No          |
| **Security**       | password reset, login alert, new device, 2FA             | Yes → merchant exists | No          |
| **Recurring bill** | subscription, renewal, membership, billed monthly/yearly | Yes                   | **Yes**     |
| **Sparse / usage** | invoice, usage, statement, IAP, order, one-off receipt   | Yes                   | **Yes**     |
| **Drop**           | newsletter, shipping-only, OTP with no account language  | No                    | No          |

**From domain** names the merchant (`noreply@github.com` → GitHub). Strip `noreply`, `billing`, `invoice`, `mail`. Public suffixes / ccTLDs (`me`, `ai`, `app`, …) are not merchants: `noreply@proton.me` is Proton, not Me.

**Connect ≠ subscription.** Connecting Tuta/Proton does not invent a Home row. A real invoice/receipt/renewal **from** that vendor still classifies. Welcome/security from the vendor stays **$0**. A paid invoice with no parseable total stays **`?`**, not `$0`.

**Money parse (recurring + sparse only):** prefer `text/plain`, else HTML stripped to text; then attachments named like `invoice.pdf` / `receipt.pdf` / `statement.pdf` (skip images/logos). First clear amount + currency. Recurring cues: `/mo`, `annual`, `renews`. Usage cues: `usage`, `overage`, `this period`. If PDF text extract is too expensive in Phase 4: keep “invoice attached, amount unknown” — do not invent a total or force $0.

Amazon Prime **renewal** → recurring. “Your Amazon.com order” → sparse. Same merchant, **two kinds**. Scan does not smash them into one row. Phase 5 graph can link them later if the user says so.

#### Merchant rollup

- Welcome + later invoice → **one** GitHub row; invoice upgrades free → paid.
- $0 / missing amount is valid.
- Recurring without amount stays **recurring, amount unknown** — not silently free.
- Free = only account/security evidence, never a charge.
- Sparse = charge without membership cadence.

Candidate: `merchant, kind (recurring | sparse | free), amount?, currency?, cadence?, nextDate?, mailbox, evidence, confidence`.

#### Display filters (not scan controls)

Cached map holds all three kinds. Default view: **Recurring on**; Sparse and Free off. Changing filters only changes the list.

#### Honest limits (must stay in the UI)

- Not every merchant emails a parseable receipt or even a welcome.
- iCloud / Yahoo / AOL use **public IMAP** with an app password. Optional host hints: `imap.mail.me.com`, `imap.mail.yahoo.com`, `imap.aol.com`.
- **Proton** Connect is password (+ 2FA) against Proton’s client REST + OpenPGP on device — not IMAP, not Bridge, not OAuth.
- **Tuta** Connect is password against the open-source client REST + on-device decrypt (FAQ-invited, no public docs, no support until they publish). IMAP refused. Honest copy required.
- Play Billing / StoreKit / Google-Apple-Microsoft “Manage subscriptions” catalogs are **not** available as a client API. Do not scrape those dashboards.
- Scan does not infer Tuta → Proton → GitHub.
- Agent never types passwords. Stops at the OAuth / IMAP / Proton / Tuta sheet.
- IMAP fetch on this Expo client is **unverified** until a native IMAP socket exists.

#### Tasks

Scan-brain / Settings **code landed** but Phase 4 remains **NOT done** until H1–H5 and a real import-capable live scan.

- [x] Settings section **Email scan** (not mixed into Cloud Sync). (`0d6fa10`)
- [x] Provider interface + incremental scan cache + cursor. SQLite persist (`mail_mailboxes` / `mail_messages`, schema v10, local-only).
- [x] Shared subject-first classifier; body/PDF only for money classes. (`src/services/emailscan/`)
- [x] Display-filter function: Recurring / Sparse / Free (default Recurring). Toggle does not refetch.
- [x] Fixtures (welcome, reset, renewal, usage invoice, order, PDF, newsletter). Do not invent rows.
- [x] No crawler or training work. No committed OAuth client secrets. No LLM in Phase 4.
- [ ] **H1 — Honesty (catalog + copy + tests).** Drop Yahoo/AOL branded OAuth. IMAP note without Proton/Tuta. IMAP `liveScanInPhase4: false`. Settings/IMAP-sheet copy factual (Proton/Tuta are **not** IMAP; they will be branded client-REST rows in H4/H5). Tests must not lock Yahoo/AOL as branded OAuth. **H1 code is a later commit; this docs commit is plan-only.**
- [ ] **H2 — Native IMAP socket** (not JS-only Expo). Then live-scan for **documented public hosts only** (iCloud / Yahoo / AOL / custom). Still not Proton/Tuta.
- [ ] **H3 — HTTPS completeness**, one provider at a time: Zoho Mail HTTP fetcher; dedicated mail client ids (not Drive/OneDrive); verify Google/Microsoft token exchange; Fastmail query vs subject-union; Office 365 live-scan flag.
- [ ] **H4 — Proton client API.** Native SRP + OpenPGP + Proton HTTP (`mail/v4` list/get) → shared classifier. Password (+ 2FA) sheet. Not IMAP, not Bridge. Live-scan when crypto works.
  - **2026-08-21 evidence (`526361f`):** go-srp bcrypt (`salt||proton` + Go `./A-Za-z0-9` packing) + LE SRP now reaches `/auth/v4`. Live saved account `david@picksandshovels.app` (user-confirmed password, no 2FA) returns **HTTP 422 Code 9001 CAPTCHA**, not a password reject.
  - **2026-08-22 Node POC (`scripts/poc/proton-list.mjs`):** Same SRP as Kotlin. `/auth/v4/info` 200. `/auth/v4` this run was **422 Code 2028** (temporary unusual-activity lock), not 9001. POC will open official `verify.proton.me` if 9001 returns. Do not hammer this account until the lock lifts.
  - **2026-08-21 CAPTCHA sheet (`93c2f52`):** Scan on that saved account opens official `verify.proton.me` in-app (`Proton verification` + puzzle). User completed the puzzle; Proton scan returned messages.
  - **2026-08-21 scan-strategy miss then restore (`2b1dbca`):** Live Scan auto-imported every candidate and named merchants from From-domain, so Stripe (processor) and Me (self-mail) became Home rows. Restored: processors are not merchants (name seller from subject/body or drop); drop self-mail; live import uses default recurring-only filter. Unit tests pass. **Live Proton rescan unverified** (app was on Clerk sign-in; agent does not type credentials). Existing junk rows stay until you delete them or a later signed-in rescan. Tuta list/decrypt still empty on purpose.
  - **2026-08-22 From-TLD leak:** After restore, a signed-in Metro Scan still created **Me** (`$0.00` recurring). Cause was not self-mail: `merchantFromAddress` treated public suffixes as the company (`proton.me` → Me, `*.ai` → Ai). Parser now skips those labels; `PARSER_VERSION` 3. Unit tests pass. **Live rescan of the TLD fix unverified** — Metro reload dropped Clerk to Welcome back; agent does not type credentials. Deleted leftover Ai/Me rows on device before reload.
  - **2026-08-22 mailbox vendor over-read, then reversed (`a127e0f`):** Connecting a mailbox is not a subscription. Dropping every Proton/Tuta invoice in that mailbox was broader than the rule. Classifier no longer mailbox-vendor-drops; a Tuta/Proton invoice classifies. `PARSER_VERSION` 6. Persist wipes `mail_messages` + since-cursor on parser bump (`01074de`) so a retest lists inbox mail again. Credentials stay in SecureStore. Live Scan after this APK: user must tap Scan.

- [ ] **H5 — Tuta client protocol.** Login + list/decrypt against `/rest/{app}/{typename}`, GPL-safe (no copy of GPLv3 client into this tree). Honest “no public docs / unsupported.” Replace when Tuta ships public API docs.
  - **2026-08-21 evidence (`4836864`, `526361f`):** SaltService `v=154` + ID-mapped GET works. SessionService POST with `1218=[]` + null optionals + `cv`/`cp` logs in. adb: `Tuta session created for picksandshovels@tutamail.com user=["OxYUg5W----9"]`. Mail list/decrypt still returns empty on purpose (ciphertext; later pass).
  - **2026-08-22 HMAC unwrap (`39ab18b`):** Login already proved the passphrase key. Official no-padding `decryptKey` plus standard / URL-safe / base64ext Bytes decode removed `Tuta HMAC mismatch`. Live signed-in Scan: `Tuta session created for picksandshovels@tutamail.com` then `Tuta listed 0 Inbox messages`. That 0 was a parser miss, not an empty mailbox.
  - **2026-08-22 Node POC (`scripts/poc/tuta-list.mjs`):** Inbox MailSet type `436=1` has **7** `mailsetentry` rows. Attr `1456` is a wrapped IdTuple `[[listId, elementId]]`. The Kotlin/JS flatten turned that into one string and skipped every mail. After unwrapping: Porkbun login/order/welcome + `New invoice for Tuta`. Same unwrap now in `firstObjectOrArray`.
  - **2026-08-22 red screen was not Tuta:** `./scripts/android/build-android.sh --dev` installed a debug APK that needs Metro. Existing `expo start` already owned 8081, the new server died, and emulator restart dropped `adb reverse`. Reconnected reverse to the old Metro; Clerk stayed signed in. Default (no `--dev`) is the self-contained release APK we used before.
  - **2026-08-23 Tuta abort skip live (`d8ec2b8` APK):** x86_64 release rebuilt and installed `-r` (firstInstall still 2026-08-13; lastUpdate 2026-08-23 13:44). Cache wipe + leftover X/Proton deleted before Scan. Live Scan: `Tuta session created` then `Tuta listed 7 Inbox messages`. Junk attr 115 now skips (`Tuta Bytes decode skipped (2 chars)`); list does not abort. Every `maildetailsblob` hop is **HTTP 405** (`mail body hop failed`). No `TOTAL CHARGED` body reached classify. Home after Scan: **Proton** `?` recurring Monthly + **X** `?` sparse Monthly. Pass gate failed. Classify/body gap only — no new strategy. Proton Node list still 422 Code 2028; Proton login untouched.
  - **2026-08-23 Porkbun $47.74 on Home (`d00bff3`):** Live body hop already decrypted Order 10996643 (`chars=6078`). First parser-8 Scan imported Porkbun as **$8.75 Yearly** because Tuta stuffed HTML/`&nbsp;` into `text`, so `TOTAL CHARGED` missed and parseAmount took the first line item. Parser 9 strips markup in `moneyBodyText` and allows markup between TOTAL CHARGED and the amount. x86_64 release installed `-r`. Live Scan: Home Porkbun **$47.74 Yearly**, Monthly Spend **$3.98**, Tuta `?` sparse. Proton `?` and X `?` leftovers remain.
  - **2026-08-24 Proton Almost All Mail + on-device decrypt (`596a77e`, `56675e0`):** `listWithSession` now paginates `LabelID=15` (max page 150) and decrypts every listed body. Password crosses the JS bridge. Official locked-scope hop is `POST /auth/v4/info` (`ReauthScope=locked`) then `PUT /core/v4/users/unlock` (SRP proofs). Live cache-clear Scan: `Proton listed 227 of 227 label=15 pages=2`; `Proton locked-scope unlock ok`; `Proton unlocked userKeys=1 addrKeys=9 mode=one`; `Proton decrypted 227 of 227 bodies fail=0`. Patterns `recurring=1 sparse=36 account=5 security=2 drop=183`. Home after Scan: Proton **$29.98** recurring Monthly, Linode **$17.00** sparse, Porkbun **$47.74** Yearly still there. Monthly Spend **$50.96**. Tuta listed 7 with Porkbun money hit. Not Inbox page 0. Not an allowlist. Classifier untouched.


- [x] **Cadence identity** (section above). Clerk-out + mock Continue + `app.picksandshovels.cadence` + `cadence://` proven (`f005865` + `ff6ecd2` + `5ac6f97`).
- [x] Mail OAuth IDs (Google / Microsoft / Zoho) in local `.env`. `providers.ts` sends **`cadence://auth`**. Fastmail skipped.
- [x] Wave 1 #1 live **Outlook Graph** proven 2026-09-02 (`e5bde4c` PKCE code-exchange fix; 9 real rows). Agent stops at the sheet — remaining: #2 Google Workspace (blocked: add `david@bohbotweb.com` as Google Auth Platform test user), #3 IMAP last-row.
- [ ] Do **not** run a Tuta/Proton IMAP visual gate. Proton/Tuta live tests wait for H4/H5.

**Do not start H2–H5 in the H1 commit. Do not mix H1 with emulator OAuth.**

#### Test split (token-cheap)

Consumer Gmail and Google Workspace are **not** the same login. They can share one Gmail API parser.

**Stale (contradicted by 2026-08-19 docs — do not execute):** “Tuta IMAP full scan” and “Proton IMAP connect + short scan.” Tuta has no IMAP. Proton Bridge is desktop-local only.

Agent drives to the OAuth sheet or IMAP form, then **stops**. User completes that one login. Agent never types credentials. One provider per Act session.

Cheap, no live mail: classifier fixtures (covers the shared scan brain once).

| Account | What we test | Why |
| ------- | ------------ | --- |

| Normal Gmail (no receipts) | **Connect + Scan** when mail client id exists; default recurring view empty/honest | Gmail API. Not Workspace. |
| Google Workspace | **Full scan** | Same API, work login. Import one. |
| Outlook | **Full scan** | Graph. Import one. |
| Microsoft 365 | Connect-only or share Outlook Graph if already proven | Same API, own row |
| Zoho / Fastmail | Connect sheet; live-scan when fetcher + client id exist (H3) | Real HTTPS APIs |
| IMAP form | Opens; iCloud/Yahoo/AOL **hints**; agent stops; user types | Public IMAP only. Fetch unverified until H2 |
| Proton Mail | Password (+ 2FA) sheet after H4; agent stops; user types | Client REST + OpenPGP, not IMAP |
| Tuta | Password sheet after H5; agent stops; user types | Client REST, FAQ-invited, not IMAP |
| Do **not** re-run icon-crawler gates or a 7-provider screenshot marathon in one chat. |

#### Programmatic gate

- Same static + build gate.
- Classifier + rollup unit tests. If an IdP sheet cannot complete on emulator, say **unverified**.
- After H1: tests assert branded rows = Gmail / Workspace / Outlook / Office365 / Zoho / Fastmail; IMAP last; **no** Yahoo/AOL branded OAuth; **no** icloud/proton/tuta ids; IMAP live-scan false.

#### Visual gate (skill loop) — after H1 copy, not before

1. Settings → Email scan list visible above the nav overlay.
2. Branded rows are Gmail, Workspace, Outlook, Microsoft 365, Zoho, Fastmail only. Each starts that provider’s OAuth (not an IMAP form).
3. IMAP row opens host/user/password (or app password). Copy names **iCloud, Yahoo, AOL, custom** — **not** Proton/Tuta.
4. UI states Proton Mail and Tuta cannot be connected.
5. After Scan (HTTPS providers only, when client ids exist): default list is recurring only; Sparse/Free toggles change the view without a new fetch.
6. Live order when mail client ids exist: Gmail connect + empty recurring Scan first; then Workspace full scan; Outlook full scan. Do **not** attempt Proton/Tuta.

---

### Phase 5 — Subscription dependency graph ⬜

**Starts after Phase 4 can import rows.** Do not build this in the email-scan phase. Email scan will **not** invent the graph: a Proton receipt for GitHub does not prove “Proton was registered with Tuta” or “Porkbun domains sit under Tuta.”

**Motivating chain (user evidence, not auto-inferred):**

```text
Tuta
 ├─ Porkbun (domains)
 └─ Proton  (Tuta as recovery/reference)
      ├─ GitHub
      ├─ Akamai / Linode
      ├─ xAI
      └─ LinkedIn
```

Branches = identity/billing roots (Tuta vs Gmail vs Workspace). Color per root. Layout like a visual git tree (parent left/top, children down the branch).

#### Honest limit

The graph needs an explicit **depends-on / registered-with** link. Manual first. Later optional hints from “same mailbox / same domain” — never auto-wire without confirm.

#### Tasks

- [ ] Optional `dependsOn` / `registeredWith` on a subscription (or a small link table). Versioned schema if needed.
- [ ] Subscriptions tab: **List | Graph** toggle. Graph is a view of existing rows + links, not a second store.
- [ ] Honest empty state until the user (or a later confirmed hint) sets parents.
- [ ] Do not implement in the same commit as Phase 4.

#### Visual gate (when this phase starts)

1. List still works; toggle to Graph.
2. Unlinked rows: empty/honest “no links yet,” not a fake tree.
3. After the user sets Tuta → Proton → GitHub (or fixture data): colored branches match the chain.
4. Toggle back to List: same rows, no data loss.

---

### Backburner (not Phase 4)

Parked until a documented API exists. Do not implement as Connect-without-scan.

- SSO “pay OpenRouter with GitHub / Google / Apple login” merchant catalogs
- GitHub’s own billing / Copilot / usage APIs (GitHub products only, not third-party SaaS)
- Android Play Billing / iOS StoreKit **device-wide** Manage Subscriptions (those APIs are this-app IAP only)
- LinkedIn / Meta / Microsoft MSA “all my subscriptions” catalogs
- Hidden-WebView scrape of logged-in billing dashboards

---

### UI cross-cutting rules

- One phase at a time. Commit the phase. Do not start the next phase in the same commit.
- Never carry a regression forward (`overlay fixed, create broken`).
- Every visual gate uses the generic skill loop. No button coordinates in the skill.
- Update `docs/CODEBASE.md` and this file when a phase lands.
- Training stays frozen. Do not modify `scripts/train/` or `assets/models/*`.
- Three-strike safeguard still applies to each UI root issue.

---

## Changelog (plan)

| Date       | Note                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-11 | Phases 1–5 implemented and smoke-tested; `plan.md` created as living board                                                                                                                                                                                                                                                                |
| 2026-08-11 | **Phase 5.5** inserted: professional cleanup (artifacts, docs, src layout) between Phase 5 and Phase 6                                                                                                                                                                                                                                    |
| 2026-08-11 | **5.5-A done:** artifacts removed, gitignore, APKs→`build-out/apk/`, gate passed                                                                                                                                                                                                                                                          |
| 2026-08-11 | **5.5-B done:** docs under `docs/`; stubs/autopsy removed                                                                                                                                                                                                                                                                                 |
| 2026-08-11 | **5.5-C done:** components merged into `src/components/`; gate passed                                                                                                                                                                                                                                                                     |
| 2026-08-11 | **5.5-D done:** lib/services/constants → src/; aliases `@/*`→src+root, `@assets/*`; gate passed                                                                                                                                                                                                                                           |
| 2026-08-11 | **5.5-E done:** scripts/{android,train,models,poc}; train:registry OK; gate passed                                                                                                                                                                                                                                                        |
| 2026-08-11 | **5.5-F done:** README rewrite; `@/` imports; Phase 5.5 complete; Phase 6 unblocked                                                                                                                                                                                                                                                       |
| 2026-08-11 | **Phase 5.5 complete**                                                                                                                                                                                                                                                                                                                    |
| 2026-08-13 | **MAJOR FIX inserted:** crawler → picker → card/cache → upscale recovery is now the blocking pre-Phase-6 work; full-pipeline contracts and cross-layer regression gates defined                                                                                                                                                           |
| 2026-08-14 | **MAJOR FIX complete (Tranches A–F):** provenance precision gating removed picker pollution; lifecycle/ownership/stale-gen added; verified on-device with real companies                                                                                                                                                                  |
| 2026-08-14 | **UI Improvements inserted:** nav-overlay fix, Subscriptions "+", insights chart bounds, connect Google/Apple; Phase 0 (docs + generic skill) precedes all build/emulator verification                                                                                                                                                    |
| 2026-08-15 | **UI Phase 1 done (`e4e383e`):** `useBottomClearance()` on all four tab lists + colliding sheets; emulator visual gate passed (Create/picker/Sign Out above nav)                                                                                                                                                                          |
| 2026-08-15 | **UI Phase 2 done (`77a83bb`):** Subscriptions tab `+` reuses CreateSubscriptionModal; created Crunchyroll $7.99 on-device                                                                                                                                                                                                                |
| 2026-08-15 | **UI Phase 3 done (`913b08f`):** Insights bar row is a horizontal ScrollView; 6-month/Year stay inside the card; labels hide after 3 points                                                                                                                                                                                               |
| 2026-08-15 | **UI Phase 4 rewritten:** email receipt scan only (native mail OAuth + IMAP last). Hollow Google/Apple SSO Connect dropped. SSO catalogs / Play / StoreKit parked in Backburner.                                                                                                                                                          |
| 2026-08-15 | **UI Phase 4 test split:** Gmail connect+empty Scan; Workspace/Outlook full scan; Tuta/Proton via IMAP; other branded rows connect-only. Gmail ≠ Workspace.                                                                                                                                                                               |
| 2026-08-15 | **UI Phase 5 parked:** Subscriptions List/Graph toggle; explicit depends-on links (Tuta→Porkbun/Proton→GitHub…). After email scan. Do not auto-infer from receipts.                                                                                                                                                                       |
| 2026-08-17 | **UI Phase 4 scan strategy:** account≠bill; incremental cache + cursor; subject-first classify; body/PDF only for money; display filters (default recurring) do not refetch.                                                                                                                                                              |
| 2026-08-18 | **UI Phase 4 scan brain:** subject-first classifier + rollup + display-filter function + fixtures/unit tests in `src/services/emailscan/`. No Settings UI, OAuth, or live mail yet. Yahoo/AOL/Zoho/Fastmail stay fully wired when providers land; live-scan deferred/unverified.                                                          |
| 2026-08-18 | **UI Phase 4 provider/cursor:** catalog (IMAP last; no fake iCloud/Proton/Tuta) + incremental scan engine (cursor, parser-version reparse, display filters do not refetch). Still no Settings UI or live OAuth.                                                                                                                           |
| 2026-08-18 | **UI Phase 4 Settings + persist:** Email scan section, schema v10 local-only cache, honest OAuth/IMAP connect. IMAP fetch and Yahoo/AOL/Zoho/Fastmail live-scan remain unverified. No emulator gate yet. No mail client IDs in `.env`.                                                                                                    |
| 2026-08-20 | **UI Phase 4 is NOT done.** Official mail-API docs (2026-08-19) contradict shipped catalog/copy: Proton/Tuta are not IMAP; Yahoo/AOL branded OAuth is closed (IMAP + app password); IMAP fetch has no native socket. No Bridge/tunnels. Remedy: H1 catalog+copy (later commit), H2 native IMAP, H3 HTTPS fetchers. This row is plan-only. |
| 2026-08-21 | **H4/H5 login evidence.** Tuta SessionService login proven on saved `picksandshovels@tutamail.com` (`MailTuta: Tuta session created … user=["OxYUg5W----9"]`). Proton SRP now reaches `/auth/v4`; same saved Proton account is blocked by **CAPTCHA 9001**, not password. Mail list/decrypt still later. Commits `4836864`, `526361f`.    |
| 2026-08-21 | **Proton CAPTCHA sheet.** Scan on saved `david@picksandshovels.app` opens official `verify.proton.me` in-app (`Proton verification` + puzzle). User completed the puzzle; Proton scan returned messages. Retry + persist refresh remain unverified on a later scan.                                                                       |
| 2026-08-21 | **Scan-strategy restore (`2b1dbca`).** Live Scan had auto-imported every candidate and named merchants from From-domain (Stripe, Me). Classifier now drops self-mail and unnamed processors; live import is recurring-only. Unit tests pass. Live Proton rescan unverified (Clerk sign-in). Tuta list/decrypt still later.                |
| 2026-08-22 | **From-TLD leak.** After restore, Metro Scan still created **Me**. `merchantFromAddress` treated `me`/`ai`/`app` as the company (`proton.me` → Me). Parser skips those labels; `PARSER_VERSION` 3. Tests pass. Live TLD-fix rescan unverified (Clerk Welcome back after Metro reload).                                                    |
| 2026-08-22 | **Tuta HMAC unwrap + red-screen cause.** `39ab18b` retries standard/URL-safe/base64ext Bytes and official no-padding decryptKey. Live Scan: session OK, **0 Inbox messages**, no HMAC error. Red screen was `--dev` debug APK after emulator restart dropped `adb reverse`, not Tuta/Clerk. Reconnected Metro; Clerk stayed signed in.    |
| 2026-08-22 | **Tuta 0-Inbox was IdTuple wrap.** Node POC listed 7 Inbox entries. `1456` is `[[listId, elementId]]`; flatten skipped every mail. After unwrap: Porkbun + Tuta invoice headers. Kotlin `firstObjectOrArray` now unwraps that nest.                                                                                                       |
| 2026-08-22 | **Proton Node POC.** `scripts/poc/proton-list.mjs` reaches `/auth/v4`. This run: **422 Code 2028** unusual-activity lock, not CAPTCHA 9001. POC opens official verify.proton.me if 9001 returns. Do not retry until the lock lifts.                                                                                                       |
| 2026-08-23 | **Connect ≠ subscription, not mailbox-vendor drop.** Removed `isMailboxVendor`. A Tuta/Proton invoice in that mailbox classifies. Persist wipes scan cache on `PARSER_VERSION` 6. x86_64 release installed `-r` (firstInstall still 2026-08-13). Live Scan after this APK unverified until you tap Scan. Amounts still need body/PDF.     |
| 2026-08-23 | **Tuta list no longer aborts; body hop 405.** `d8ec2b8` x86_64 APK installed `-r`. Live Scan listed 7; skipped 2-char attr 115. All 7 `maildetailsblob` hops HTTP 405. Home after Scan is leftover Proton `?` + X `?`, not Porkbun $47.74 / Tuta ?. Classify/body gap only. Proton login untouched. |
| 2026-08-23 | **Porkbun $47.74 yearly on Home.** `d00bff3` parser 9 + x86_64 APK. Live Scan after install: native money hit `chars=6078`, Home Porkbun **$47.74 Yearly**, Monthly Spend **$3.98** ($47.74/12), Tuta `?`. Prior $8.75 was HTML in `text` so TOTAL CHARGED missed. Proton/X leftovers stay. |
| 2026-08-24 | **Proton list+decrypt proven.** `596a77e` paginates Almost All Mail (`LabelID=15`) and decrypts bodies; `56675e0` adds official locked-scope SRP unlock. Live Scan: **N=227 of 227**, **D=227 fail=0**, `userKeys=1 addrKeys=9`. Home Proton **$29.98** recurring; Linode **$17.00**; Porkbun **$47.74** remains. Monthly Spend **$50.96**. |
| 2026-08-24 | **Hop A nav overlay proven (`ff3f3b9`).** Absolute tab pill still overlays the scene; list padding alone left mid-scroll cards under the bar. Tab pages now reserve `pagePadding` (pill + lift) and omit SafeArea bottom so the viewport ends at the pill top. Live: list `185–2085`, pill `2085–2274`, last card Tuta `1744–2043`. Mid-scroll X clips at 2085, not under the pill. Tab bar style unchanged. |
| 2026-08-24 | **Hop B scan icon crawl proven (`ed16b0f`).** Import no longer hardcodes `icon_key: plus`. Live Scan after `-r` install: `startIconCrawl` for proton/linode/x/linkedin/openai/porkbun/tuta on leftover plus-key rows. OpenAI bloom + Porkbun pig landed on Home. Crawler quality still later; this hop only starts the existing crawl. |
| 2026-08-24 | **Hop C this-month actuals proven (`30de520`).** Sparse cards default to mail charges in the current window. Live: Linode **This month $93.00**; Monthly Spend **$122.98** (`29.98+93`). Proton tap Monthly→Yearly **$359.76**. Porkbun this month **$0.00**, tap → **This year $47.74**. Stored cadence unchanged. |
| 2026-08-24 | **Hop D Insights this-month proven (`a6e6774`).** Live Insights: this-month actuals **$122.98**, recurring **$29.98**, sparse **$93.00**, top merchant **Linode $93**. Chart bars were still cloned run-rate until hop E. |
| 2026-08-24 | **Hop E Insights mail bars proven (`b510a35`).** x86_64 release installed `-r`. Title **Monthly spend from mail**. This Month: one **Aug $122.98** bar. Last 3 Months: **Jun $29.98**, **Jul $94.72**, **Aug $122.98**. Year: 12 bars Sep→Aug; Jan is run-rate (no Porkbun spike). Jul/Aug taller than Apr–Jun. Chips change bar count. Live Jul is **$94.72** (`29.98+17+47.74`); Porkbun mail date is July on device, not January. After Year horizontal scroll, switching to This Month can look empty until remount (leftover offset). |
| 2026-08-24 | **Docs synced to hops A–E.** Plan header/UI board now say A–E proven; leftover Year→This Month scroll is a note, not a new hop. `docs/CODEBASE.md` Home/Insights/chargeDisplay map refreshed. Lessons: live Porkbun is July not January; leftover Year offset; do not restyle the tab bar. |
| 2026-08-24 | **Icon quality hops 1–5 recorded.** Crawler files were not restored. Combined plan: Hop 1 two-track official domain (scan From-host / search TLD, no `.com` first guess); Hop 2 stop first-icon lock-in; Hop 3 provenance holes; Hop 4 blank reject on card; Hop 5 yield after precision. |
| 2026-08-24 | **Hop 1 official-domain code landed.** Scan sanitizes From-host (`proton.me`) onto crawl session. Manual TIER 0 uses `html.duckduckgo.com` and ranks without a `.com` bonus. No deterministic `.com` official fallback. Device gate still open. |
| 2026-08-24 | **Hop 2 cache-ownership code landed.** `icon_cache.chosen` marks picker/AI rows. Crawler-owned cards may upgrade via `pickBestIcon` as better valid icons land. User/AI choices stay locked. Device gate still open. |
| 2026-08-25 | **Hop 4 blank-refuse + paintable auto-select proven.** `2d0ba23` refused empty/invalid cache on card/previews (RN `Image` kept). Follow-up `32521cb`: cream-plate only for near-white; `isPaintableCardIcon` skips SVG as card default. Crawler still `210c908` (not `063ac4b`). Device: Ace ACE; typed Spotify auto-selected `icons8` PNG. Leftover slugs / Bing junk remain Hop 3. |
| 2026-08-25 | **Icon hops 1–2 + 5 proven on `5dc46ed`.** x86_64 APK installed `-r` on existing `emulator-5554` (`lastUpdateTime=22:22:41`). Typed Linear: TIER 0 `linear.app`; first `official_favicon` then upgrade to `spider:apple_touch_icon`; picker 19 / 20 valid. Typed Proton: seeded `proton.me`; picker 33. Typed Ground News: TIER 0 `ground.news`. `IMMEDIATE_FETCH_BATCH=6`. Not `063ac4b`. Scan From-host seed not re-proven (Scan: no new rows). |
| 2026-08-26 | **xAI compound-label hop proven (`029c509`).** Two-label 2-letter TLD hosts ≤5 chars keep TLD in the name (`x.ai` → **xAI** / `xai`; `x.com` stays **X**). `PARSER_VERSION` 11. Device: deleted leftover **X**, Scan added **xAI**; `[CRAWL] startIconCrawl for xai … official=x.ai`; auto-assigned `official_site` from `x.ai` (not Twitter); picker 4 first-party tiles. |
| 2026-08-28 | **Cadence display-name hop proven.** x86_64 APK on `emulator-5554` (`pixel_6a_API34`): `application-label:'Cadence'`, package still `com.ctocrm.jsmastery`, scheme still `jsmastery`. Home launched with existing Clerk session. App drawer: uiautomator `text="Cadence"`; frame [`docs/reference/cadence-launcher-2026-08-28.png`](./reference/cadence-launcher-2026-08-28.png). That leftover package/scheme/Clerk split is **not** the next hop. |
| 2026-08-28 | **Cadence identity hop locked (plan-only).** Next implement: remove Clerk; local mock Continue login (`userId: "local"`); package **`app.picksandshovels.cadence`**; scheme **`cadence://`**. Drop `jsmastery://`. GitHub / Expo slug stay. Mail OAuth IDs after that APK is proven. This row is docs, not the APK. |
| 2026-08-30 | **Entra mail reply URI locked to `cadence://auth`.** Portal rejected `cadence://` (Must be a valid URI — no host). Platform **Mobile and desktop applications**; do not check nativeclient / LiveSDK / `msal…://auth`. Personal accounts need Manifest `requestedAccessTokenVersion: 2` first. Microsoft client ID `fba1737f-1879-41fc-b82d-42dc773e5a86` → `EXPO_PUBLIC_MICROSOFT_MAIL_CLIENT_ID` (not tenant/object ID; no secret). Later code hop: `providers.ts` must send exactly `cadence://auth`. This row is docs, not the APK. |
| 2026-08-30 | **Ship-time mail OAuth notes (not Phase 4).** Microsoft other-tenant end-user consent needs Partner One / publisher verification; home-tenant / admin consent still works for Phase 4. Gmail `gmail.readonly` is restricted: Testing-mode test users for Phase 4; public users need brand verification + restricted-scope verification + CASA. Recheck package/SHA-1/`cadence://auth` before Play. |
| 2026-09-02 | **`cadence://auth` code hop.** `providers.ts` `promptOAuth` uses `native: "cadence://auth"`. Google / Microsoft / Zoho IDs live in gitignored `.env`. Fastmail skipped. Next: Wave 1 Outlook Graph → Workspace → IMAP. Agent stops at the sheet. Live Connect is not this commit. |
| 2026-09-02 | **Wave 1 #1 Outlook Graph PROVEN + PKCE fix (`e5bde4c`).** First live run: redirect `cadence://auth/?code=…&state=…` reached the app, but `promptOAuth` only read `params.access_token` (implicit flow) → alert "OAuth returned no access token". Fix: `AuthSession.exchangeCodeAsync` with `code_verifier` via `extraParams` (SDK 54 has no `codeVerifier` field on token requests). Rebuilt release APK (3m49s), re-ran live: SSO straight to redirect, mailbox saved with Graph `/me` hint `ctocrm@outlook.com`, Scan **imported 9 real rows**. Cosmetic issue (NOT fixed, separate hop): expo-router shows "Unmatched Route" for the `/auth` deep link; auth flow unaffected. Zoho client secret pasted in chat earlier must still be regenerated. Workspace #2 blocked on test user; IMAP #3 next. |
| 2026-09-02 | **Wave 1 #2 Google Workspace PROVEN — Gmail API enablement was the 403.** Console toggle (Custom URI scheme on Android client `9790232816-…`) fixed Error 400; connect saved `workspace-1788391178048`. First scan 403 dropped its response body; `fa0a58b` added `providerErrorReason` so Gmail/Graph list failures now surface the API's error text. Rescan named it: "Gmail API has not been used in project 9790232816 … Enable it". User enabled the Gmail API; rescan imported real rows **Aws**, **Audible**, **Bohbotweb** on device. Open holes (NOT this hop): (a) self-mail leak — own domain `bohbotweb.com` became a merchant row despite PARSER_VERSION 3 self-mail drop; (b) Outlook leg alerts `IDX14100: JWT is not well formed` — stored token corrupt/stale, no refresh-before-list, and `app/(tabs)/index.tsx` swallows per-mailbox scan errors whenever ≥1 row imports. |
| 2026-09-02 | **Outlook `IDX14100` RESOLVED — corrupt token was the PC/emulator restart, not hop-2 code; reconnect re-proves the mailbox.** Timeline evidence: the 401 was already in the scan alert BEFORE `fa0a58b` (old no-body format), and that commit only appends error-body text inside the `!res.ok` branch — it cannot touch tokens. Hop 1 proved the token valid at connect (`/me` OK, 9 rows); the machine/emulator restart between hops is the corrupting event (pre-restart SecureStore blob unreadable after Keystore invalidation; the workspace blob written post-restart reads fine, matching the asymmetry). Fix: in-app reconnect — Subscriptions → Outlook row **Edit → Reconnect** → MS sign-in (remembered MSA session completed passwordless after email entry) → redirect `cadence://auth/?code=…` ("Unmatched Route" cosmetic page, known) → upsert reordered the mailbox list, proving the save. Verification scan: status **"Added 2 subscription(s)."**, **no Scan-errors alert**, Graph list succeeded — gate met. New deferred hole (separate hop): icon-crawler retry backlog saturated the JS thread for ~20 min and dropped UI taps (Add-mailbox sheet taps silently no-oped) until app cold-restart. |
| 2026-09-02 | **Clean-room 4-mailbox regression test — "hop 2 broke Outlook" dispute ANSWERED: the Outlook leg scans clean on a fresh build.** Fresh install (Cadence local onboarding, `cr_s33`) → connected **4/4 mailboxes**: Outlook `ctocrm@outlook.com`, Google Workspace `david@bohbotweb.com`, Tuta `picksandshovels@tutamail.com`, Proton `david@picksandshovels.app` (`cr_s36`). Connect produced **no 401 / IDX14100** anywhere; the "Unmatched Route" cosmetic page reconfirmed on the MS redirect (`cr_s32` shows `cadence://auth/?code=M.C557_…MsaArtifacts…` — auth code delivered, mailbox row saved) — token exchange succeeds behind it. Scan final alert ("Scan errors") listed exactly **2** per-mailbox failures: `workspace:david@bohbotweb.com: Gmail list failed (401): Request had invalid authentication credentials. Expected OAuth 2 access token…` and `proton:david@picksandshovels.app: Proton rejected the password or 2FA code (HTTP 422)` (`cr_s38`) — Outlook absent ⇒ Outlook Graph list succeeded. Scan results: **11 subscriptions imported** (Tuta, Porkbun, Posthog, Microsoft, Firefox, Coderabbit, Cerebras, Bot, Openrouter, Cline Bot Inc., Github; `cr_s39–s44`); icons mostly brand-correct (Porkbun, Posthog, Microsoft, Coderabbit, Cerebras, Openrouter, Github), Firefox/Cline still loading at capture. Proton leg: fetch hit Proton **anti-abuse CAPTCHA** (app surfaced it with a Cancel escape hatch; user solved it, `cr_s37`) then login returned **422** — Proton fetch still unproven. Open holes (NOT this hop): (a) **Workspace Gmail list 401 at scan time despite connect-time token-exchange success** — same list-time-credential class as the old IDX14100, now reproduced on the Gmail path in a clean run (no refresh-before-list?); (b) **Proton 422 password/2FA rejection** root-cause unknown — solving the CAPTCHA did not clear it; (c) icon quality: Tuta icon is a wrong generic illustration and merchant "Bot" is a generic name; (d) Tuta alias observation during connect was not captured in screenshots — re-verify at the next Tuta hop. Logcat buffer rotated (icon-crawl spam) before scan-error lines could be grepped; screenshots `cr_s32–s44` are evidence of record. |
| 2026-09-03 | **Proton anti-abuse 422 RESOLVED — CAPTCHA solve cleared the block; full fetch proven end-to-end (443/443 listed, 443/443 bodies decrypted, 0 failures).** Continuation of the clean-room run above: user cleared Proton's anti-abuse CAPTCHA in-app and the scan resumed without re-auth. Logcat chain (pid 7936, `MailProton` tag): 23:20:33 `HTTP 422 {"Code":9001 …complete CAPTCHA}` — the pre-solve challenge and the ONLY 422/9001 in the entire scan window → 23:21:53 `Proton listed 443 of 443 label=15 pages=3` → 23:21:53 patterns `recurring=1 sparse=88 account=9 security=5 drop=340` → 23:21:54 `locked-scope unlock ok` → 23:21:58 `unlocked userKeys=1 addrKeys=9 mode=one` → 23:25:24 `Proton decrypted 443 of 443 bodies fail=0`. Zero 422/9001/CAPTCHA recurrence across the remaining ~40 min while the icon/search-engine queue drained (brand searches zoho→openai→linode→xai→linkedin→google→microsoft→proton→accounts all finished; Proton social images fetched). Final "Scan errors" alert + inline card banner list exactly **ONE** failure: `workspace:david@bohbotweb.com: Gmail list failed (401): Request had invalid authentication credentials…` — Proton, Outlook, Tuta all absent ⇒ all three scanned clean (`pr_s20`). Tuta leg: session created, 0 Inbox messages (empty mailbox, not an error). Gate met. Open hole (NOT this hop): Workspace Gmail list-time 401 persists — the final alert doubles as its current-status confirmation. |
| 2026-09-03 | **Regression audit locked — fix sequence R1→R7, hop by hop with gates (user picked full sequence).** R1 (Hop 1) OAuth **refresh-before-list**: `providers.ts` `fetcherFor` (775-784) passes stored `accessToken` with no `expiresAt` check and zero refresh logic in the scan path — root cause of the recurring Workspace Gmail 401 and the same class as the old Outlook IDX14100; fix = refresh via provider token endpoint when expired/near, persist, `invalid_grant` ⇒ explicit "reconnect required". R2 (Hop 2) Home scan (`index.tsx:135`) shows per-mailbox errors only when `imported === 0`; Subscriptions path (`EmailScanSection.tsx:290`) shows always — parity. R3 (Hop 3) `isSelfMail` matches exact owner address only ⇒ own-domain senders (`no-reply@bohbotweb.com`) leak as merchant rows; drop by owner-domain + `PARSER_VERSION` bump + clean bogus row. R4 (Hop 4) crawler precision: characterize on current HEAD first (baseline method), then pre-fetch admission filters (wallpaper/photo-farm blocklist, icon-ish signals, per-source caps); gate = ≥5 diverse real brands, picker long-press, brand-correct tiles; UI responsiveness out of scope (yield already landed). R5 (Hop 6, UX pending user confirm) decouple scan-complete alert from icon-queue drain (~40 min blocking spin last night); bound dead-host retries ≤2. R6 (Hop 5) no-op `app/auth.tsx` for `cadence://auth` "Unmatched Route". R7 (Hop 7) generic single-word merchant guard ("Bot"). Hygiene: Zoho client secret regeneration (user action); re-verify $0.00/Upcoming(0) rows after R1 restores Workspace charges. Each hop: edit → tsc/lint → commit → build+emu → behavioral gate → docs row. |
| 2026-09-03 | **Hop 1 (R1) code live + first clean scan; refresh-branch live-trigger pending token expiry.** Commits `6658f99` (refresh-before-list: `ensureFreshOAuthTokens` in `fetcherFor` — 60s-skew expiry check → RFC 6749 refresh at provider token endpoint → `saveTokens`; `invalid_grant` ⇒ explicit "reconnect required" via `MailScanUnverifiedError`; transient ⇒ fall back to stored token) and `30f76ec` (hard 15s timeout on the refresh POST via Promise.race + AbortController so a black-holed request can never stall the scan loop; per-mailbox breadcrumbs `[MailScan] fetcherFor …` / token state / `[MailOAuth] refreshed`). New pure module `oauthRefresh.ts` + 12 unit tests (expiry skew, reject vs transient classification, rotated-refresh adoption, timeout) — 12/12 green, tsc clean. Live (emulator-5554, release APK): scan swept all 4 mailboxes in ~25s — Workspace `token fresh — using as-is` → listed; Proton listed/decrypted (0 bodies this run); Tuta session + 0 Inbox; Outlook `token fresh` → listed; UI status **"Added 2 subscription(s)."**, NO Scan errors alert, NO 401. **Not yet done:** the refresh branch itself did not fire (both OAuth tokens were still valid after recent reconnects); its live trigger is the next scan after a stored token crosses expiry (~1h tokens — expect `token expired — refreshing` → `access token refreshed`, or the new reconnect error if the grant was revoked). **New regression found (R9 candidate, NOT this hop):** the 00:52 scan hung 18+ min at mailbox #1 with zero logs — mail LIST fetches (Gmail/Graph RN fetch) have no timeout, so a transient network black-hole freezes the whole scan (same run later completed in 25s on a healthy path); fix = race-timeout wrapper on per-page list fetches, separate hop. |
