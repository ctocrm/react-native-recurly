# Crawler Baseline — Tranche A (characterization, no behavior change)

**HEAD:** `fb65af6` (baseline = reverted Tranche A state `3138c74` + runnable characterization tests)
**Build:** `build-out/apk/app-release-x86_64.apk` on `pixel_6a_API34` emulator
**Date:** 2026-08-13
**Evidence log:** `docs/crawler-baseline.log` (1307 lines, filtered ReactNativeJS: FETCH/SEARCH_ENGINE/QUEUE/COLLECTION/SEARCH/PICKER/LOCAL/CRAWL/WEBVIEW_*)
**Method:** real UI path — add subscription via CreateSubscriptionModal, crawl fires, picker opened by long-press on the subscription card icon. User drove the emulator UI; assistant captured/analyzed logs.

## Baseline findings (netflix crawl)

### F1 — Precision failure is real and user-visible (CONFIRMED)

User visual confirmation: some picker tiles are brand-correct (Netflix) but most are garbage — Microsoft icons, random pictures, "What's On Netflix (WON)" site imagery.

Log evidence of wrong-brand fetches during/after the netflix add:

- `https://netplus.com/favicon.ico` (netplus ISP, not Netflix)
- `https://cicgroup.com/.../ne-favicon-150x150.png` (CIC Group "ne" favicon)
- `https://dotnet.microsoft.com/.../stackoverflow.svg`, `blip-light.svg`
- `https://en.wikipedia.org/static/images/icons/enwiki-25.svg`, wikipedia wordmark/tagline SVGs
- `https://commons.wikimedia.org/wiki/File:Microsoft_NET_Logo.svg` (rejected at fetch — HTML page, see F4)
- `https://apps.microsoft.com/assets/icons/logo-*.png` (40x40, 16x16, maskable-700x700, monochrome-256x256)
- `https://fitliferegime.com/.../Inchworm.webp` (fitness site imagery)
- `https://img1.wsimg.com/.../logo-default.png` (GoDaddy CDN default logo)
- `https://assets.superlander.com/newimages/favicon.png`

Brand-correct candidates that did land for netflix:

- local bundled `assets/icons/netflix.png` (`[LOCAL] Found local icon`)
- `https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/netflix.svg` (368 bytes — suspiciously small for that SVG)
- `https://img.icons8.com/color/512/netflix.png` (11688 bytes, icons8 aggregator)
- `https://assets.nflxext.com/us/ffe/siteui/common/icons/nficon2023.ico` (13140 bytes, Netflix CDN)
- `https://occ.a.nflxso.net/.../....svg` (1100 bytes, Netflix CDN — likely title art, not logo)

### F2 — Autocomplete prefix crawl storm

Typing "Netflix" fired full crawls for every prefix (CreateSubscriptionModal per-keystroke `startIconCrawl(slug)`):

```
20:35:00 [CRAWL] startIconCrawl for ne    (sub: none)
20:35:01 [CRAWL] startIconCrawl for net   (sub: none)
20:35:02 [CRAWL] startIconCrawl for netf  (sub: none)
20:35:03 [CRAWL] startIconCrawl for netflix (sub: none)
20:35:04 [CRAWL] Already crawling netflix, skip duplicate start  (dedupe works)
```

Each prefix crawl ran the full tier pipeline including TIER 3 web search. The prefix-crawl queues were still draining wrong-brand URLs 10+ minutes later (fitliferegime, superlander, apps.microsoft.com, wsimg fetched at 20:46+). Prefix crawls pollute `icon_crawl_results`, `crawled_urls`, and the fetch queue.

### F3 — Picker growth + reload loop

- Picker opened 20:39:44: "6 icons available", "Deep discovery complete: 212 candidates, 4 saved so far".
- Picker later: "32 icons available" — background queue keeps publishing candidates into the open picker, including the wrong-brand ones above.
- Picker/collection reload loop: `[PICKER] Loaded 6 icons for netflix` + `[COLLECTION] Loading icons for netflix` every ~2 seconds while open. 18 reloads in 42 s (20:39:46–20:40:28). (Characterization note: constant reloads; not a fix target in this tranche.)
- Reports hidden by default confirmed in logs ("reports hidden by default").

### F4 — Fetch-level format contract works (partial bright spot)

HTML/error responses masquerading as image URLs are correctly rejected at fetch:

```
[FETCH] REJECT non-image response https://www.netflix.com/favicon.svg (content-type=text/html)
[FETCH] REJECT non-image response https://commons.wikimedia.org/wiki/File:Microsoft_NET_Logo.svg (content-type=text/html)
[FETCH] FAILED https://en.wikipedia.org/apple-touch-icon-152x152.png: 404
```

So the pollution enters upstream (candidate acceptance), not at the bytes/type check.

### F5 — Provider anti-bot evidence

DuckDuckGo HTML endpoint returned a CAPTCHA/anomaly challenge page instead of results:

```
[SEARCH_ENGINE] DuckDuckGo DEBUG: Sample src/data-src: ../assets/anomaly/images/challenge/4a4e...jpg, ...
```

Provider failure ≠ "brand has no icons"; baseline shows search degrading silently to fallback behavior.

### F6 — First-result timing (netflix)

- 20:35:03.754 crawl start → LOCAL icon found instantly
- 20:35:11.685 TIER 1: 2 library icons (≈8 s)
- 20:35:17.2 simple-icons netflix.svg fetched (≈13.5 s)
- 20:35:26.5 nflxext nficon2023.ico (≈23 s)
- 20:36:14.8 "Search completed for netflix", 210 URLs quality-queued (≈71 s)
- Picker first opened 20:39:44 (user-driven), 6 icons shown.

### F7 — Original dimensions not observable from logs

`originalWidth/originalHeight` are probed at download and stored in the DB, but never logged. DB is SQLCipher-encrypted (random passphrase in SecureStore per Clerk user) → offline dump not practical. For per-candidate dimensions, probe the public candidate URLs offline or add a diagnostic in a later tranche. Recorded as a baseline-evidence gap.

### F8 — Downstream contracts observed working (do not regress)

- Local bundled icon matched and used (netflix)
- Crawl-result rows written (placeholder → bytes on fetch), dedupe on in-flight crawl works
- Picker loads progressively, hides reported icons by default, exposes AI Upscale Quality UI (Fast/Sharp), "Show broken/Show incorrect", "Use Default Icon", report Wrong/Broken buttons present
- Background fetch worker continues after picker open; queue drains over time
- App stable: no RN fatal, no UI freeze during crawl (responsiveness work from 3ac6928/9e091c1 intact)

## What Tranche A did NOT do

No crawler/discovery/picker/upscale behavior was changed. Training untouched.

## Verification status (honest split)

**Verified end-to-end on emulator (HEAD fb65af6):**

- Build/install/launch — app runs, no RN fatal
- Crawler discovery smoke — netflix + 3 uncommon brands (Le Devoir, Ace Hardware, Ground News), full tier pipelines captured in logs
- Long-press picker smoke — picker opens via real interaction, renders candidates
- Progressive publication — picker grew 6 → 32 → 50 → 55 icons while open (background queue keeps publishing; this is also the pollution vector)
- Characterization tests runnable — `npx jest` 20/20 PASS, `npx tsc --noEmit` PASS
- **Selection → card persistence → kill/relaunch (VERIFIED)** — user selected an icon for Ace Hardware in the picker, closed it; app force-stopped and relaunched via adb; `[COLLECTION] Found cached icon for ace-hardware` after relaunch and user confirms the card shows the selected icon. Manual-selection + lifecycle contracts hold at baseline.
- Picker stale-state across subscription switch observed (F9) — transient, resolved to correct collection

**NOT verified (explicitly unverified, not claimed):**

- Low-resolution → Upscale eligibility integration smoke (no upscale run performed)
- 5th diverse brand for the baseline set (4 tested: netflix, le-devoir, ace-hardware, ground-news)
- Per-candidate original dimensions (F7)
- Full 8-brand acceptance list (Tranche F scope, not Tranche A)

## Open evidence gaps for later tranches

1. Per-candidate original dimensions (needs offline URL probe or diagnostics)
2. Which exact sources produced the 6 → 55 visible picker tiles (needs DB-level provenance dump or picker logging)
3. 368-byte simple-icons netflix.svg — verify whether truncated/stub
4. Remaining 4+ diverse brands baseline (Spotify, GitHub, Linear, 1Password, Miro, Toggl Track, Backblaze)
5. Selection/persistence/upscale/relaunch smokes from the verification list above

## Screenshot evidence

- `docs/test-screens/tranche-a-01-picker-netflix-50icons.png` — picker open, "50 icons available", AI Upscale Quality UI (Fast/Sharp), report (Wrong/Broken) UI, "Show broken/Show incorrect" toggles, "Use Default Icon"

## Multi-brand baseline (Le Devoir, Ace Hardware, Ground News — user-driven adds)

### F9 — Picker stale-state across subscription switch (transient, user-confirmed)

User opened pickers for the new subscriptions and initially saw the netflix tile set. Picker modal is a single shared instance (`iconPickerSubscription` state in subscriptions.tsx); `availableIcons` keeps the previous brand's tiles until the new key's `getIconCollection` completes (guarded by `latestKeyRef`, but the old list stays visible during the load). User later saw the correct per-brand collection → resolved transiently. 30 `[PICKER] Loaded … for le-devoir` reloads confirm the picker did load le-devoir's own collection. Recorded as a picker-state characterization item (async gap between shared modal state and per-key load), not fixed in this tranche.

### F10 — ace-hardware: brand-correct favicon auto-assigned (the one success)

- `https://acehardware.com/favicon.ico` (1192 bytes) fetched 23:06:15 → `[CRAWL] Auto-assigned first valid icon for ace-hardware (source=favicon)` at 23:10:19. User confirms the card shows the correct Ace icon.
- Pollution alongside it from official-site generic `<img>` scraping: `header-circle-user-regular.svg` (fetched 4+ times), `home.svg`, `star-double.svg` (ace.com menu chrome).

### F11 — ground-news: brand-correct asset landed under a PREFIX key

- `https://groundnews.com/apple-touch-icon.png` (5332 bytes — brand-correct) fetched 23:07:43, during the `ground-ne` prefix crawl, i.e. before `ground-news` was fully typed/created. The `ground-news` picker (2 icons, user: "no real icons found") never showed it — evidence consistent with the favicon bytes being saved under the prefix icon_key and the final key's crawl skipping the already-seen URL (crawled_urls is universal telemetry).
- Later ground-news fetches: app-store / googlePlayStore badges, mashable-logo.svg, forbes-logo.svg (publisher logos on their homepage) — generic `<img>` pollution even on the official domain.

### F12 — le-devoir: nothing usable (extraction gap, not fetch gap)

- Only brand-relevant lead: `https://en.wikipedia.org/wiki/File:Logo_Le_Devoir.svg` from duckduckgo_images — a Wikipedia **file description page**, not the file. Fetch correctly REJECTED it (text/html). No "wiki file page → upload.wikimedia.org actual file" resolution exists → le-devoir picker ends with no real icons (user-confirmed).
