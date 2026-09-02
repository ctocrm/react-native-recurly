# Codebase overview — jsmastery

**Last verified against source:** 2026-08-25 (Hop 4 proven `2d0ba23` + `32521cb`; crawler still `210c908`).

Expo **~54.0.34** / React Native **0.81.5** / expo-router **~6.0.23** subscription tracker with an on-device icon crawler, optional TFLite AI upscaler, SQLCipher storage, and scoped cloud sync. NativeWind v5 (`^5.0.0-preview.4`). Auth is Clerk (`@clerk/expo@3.1.12`). Analytics is PostHog.

**Training is frozen.** Do not modify `scripts/train/`, `assets/models/*.keras`, or start `npm run train:models*`. See `docs/AI_UPSCALING.md` and `docs/plan.md` §Frozen.

This file is the current-code map for UI work. Icon-pipeline _contracts_ live in `docs/plan.md` Major Fix; do not restate them as if they were still open work.

---

## Runtime stack and provider nesting

```
app/_layout.tsx
  PostHogProvider
    ClerkProvider
      IconCacheProvider          // in-memory icon map; exists before DB is open
        Stack (headerless)
          (auth)/*               // signed-out
          onboarding
          (tabs)/_layout.tsx     // signed-in only
            DatabaseProvider     // SQLCipher open / migrations
              SubscriptionProvider
                CloudSyncProvider
                  Tabs + HiddenSearchWebView
```

`IconCacheProvider` is outermost among app data providers so the cache can exist before the encrypted DB is ready. `SubscriptionProvider` owns foreground crawl-queue kicks because it sits inside `DatabaseProvider`. `HiddenSearchWebView` in the tab layout is the background scrape surface.

---

## App screens (`app/`, expo-router)

| Route         | File                                  | Purpose                                                                                                  | Safe area / bottom padding                                                                                                                                                                                         | Create / add                                                                |
| ------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Root stack    | `app/_layout.tsx`                     | Fonts (Plus Jakarta), splash hide, PostHog screen tracking, Clerk + IconCache                            | None. No `SafeAreaProvider` here.                                                                                                                                                                                  | n/a                                                                         |
| Onboarding    | `app/onboarding.tsx`                  | First-run placeholder                                                                                    | Minimal                                                                                                                                                                                                            | n/a                                                                         |
| Auth layout   | `app/(auth)/_layout.tsx`              | Clerk-gated auth stack                                                                                   | —                                                                                                                                                                                                                  | n/a                                                                         |
| Sign in / up  | `app/(auth)/signIn.tsx`, `signUp.tsx` | Clerk screens                                                                                            | Auth classes (`auth-safe-area` / `auth-screen`)                                                                                                                                                                    | n/a                                                                         |
| Tabs layout   | `app/(tabs)/_layout.tsx`              | Clerk-gated `<Tabs>`; floating pill tab bar; mounts `HiddenSearchWebView` + `ProtonCaptchaModal`         | Tab bar is **`position: "absolute"`** with `bottom: Math.max(insets.bottom, tabBar.horizontalInset)` (`horizontalInset` = 20). Height 72, radius 32, icon frame 48 (`src/constants/theme.ts` `components.tabBar`). **Do not restyle this pill.** | n/a                                                                         |
| Home          | `app/(tabs)/index.tsx`                | Monthly spend from mail, upcoming, preview list, header `icons.add`, Scan                                | `SafeAreaView` edges `top/left/right` + `pagePadding`. List `tabListPadding`. `useChargeDisplay`.                                                                                                                                                  | Header `+` opens `CreateSubscriptionModal` via `addSubscription` then crawl |
| Subscriptions | `app/(tabs)/subscriptions.tsx`        | Full list: search, All/Upcoming, expand/edit/delete/stats, header `+`, **long-press card icon → picker** | Same `useBottomClearance()` + `useChargeDisplay`. Header `+` opens the same `CreateSubscriptionModal` as Home.                                                                                                                                     | Header `+` → `addSubscription` then crawl                                   |
| Insights      | `app/(tabs)/insights.tsx`             | This-month actuals, kind bars, top merchants, **Monthly spend from mail** + period chips                 | Same clearance. Bars from `monthlyChartFromMail`. After Year swipe, leftover horizontal offset can hide This Month until remount.                                                                                                                  | n/a                                                                         |
| Settings      | `app/(tabs)/settings.tsx`             | Profile, Account, Cloud Sync, Backup/Restore, Cache & Crawl clear, scan-cache clear, Sign out            | Same clearance. Email scan UI lives on Subscriptions (`EmailScanSection`), not only Settings.                                                                                                                                                      | n/a                                                                         |
| Detail        | `app/subscriptions/[id].tsx`          | Single subscription                                                                                      | Standard                                                                                                                                                                                                           | n/a                                                                         |

### Hardcoded spacing facts (hop A closed the overlay)

- `src/constants/theme.ts` `spacing` and `global.css` `--spacing-*` both jump **24 → 30**. There is **no `--spacing-25`**.
- Tab lists used `contentContainerClassName="pb-25"`. That class is a **no-op**.
- Tab bar occupies ~72px plus `max(insets.bottom, 20)` from the physical bottom. **Hop A (`ff3f3b9`)** now applies `pagePadding = tabBar.height + tabLift` on tab pages and omits SafeArea bottom so the viewport ends at the pill top. Lists only need `tabListPadding` (16). Sheets use `sheetPadding`. **Do not restyle the tab bar to “fix” overlay.**
- Live 1080×2400: list `185–2085`, pill `2085–2274`. Mid-scroll cards clip at 2085, not under the pill.

---

## Components (`src/components/`)

None of these files call `useSafeAreaInsets`. Shared sheet chrome is `.modal-container` (`mt-auto max-h-[85%] rounded-t-3xl`) or an inline equivalent. Typical last-button padding is `p-5` / `pb-5` only.

| File                                                | Role                                                                                                                                                                                                                                                     | How opened                                                                    | Overlay collision                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `CreateSubscriptionModal.tsx`                       | New sub: name + autocomplete + live crawled icon (`isPaintableCardIcon`; SVG stays plus), price, Monthly/Yearly, category. `await onCreate` then fire-and-forget `startIconCrawl`. Submit is **pinned outside** the `ScrollView` (`px-5 pb-5 pt-2`, `accessibilityLabel="Create Subscription"`). | Home and Subscriptions header `+`                                             | Phase 1 inset via `useBottomClearance()`. KeyboardAvoidingView is iOS-only. |
| `SubscriptionIconPickerModal.tsx`                   | Long-press picker: tiles, Wrong/Broken reports, Clear White BG, Upscale (AI), Show incorrect/broken, Fast/Sharp quality. Uses `getIconCollection` / `replaceIconWithAiUpscale`.                                                                          | `SubscriptionCard` long-press → `onIconLongPress` from Home and Subscriptions | **Yes.** Sheet + footer actions share the same bottom collision.            |
| `SubscriptionCard.tsx` + `SubscriptionCardMenu.tsx` | Card + overflow menu (edit/delete/status/stats). Icon via `useCachedIcon` + RN `Image` (not `expo-image` / `SmartIcon`); invalid/SVG cache falls back to plus. Icon long-press is the **real picker path**.                                                                                                                                                            | Lists on Home / Subscriptions                                                 | Card itself is fine; picker it opens is not.                                |
| `UpcomingSubscriptionCard.tsx`                      | Compact upcoming row on Home                                                                                                                                                                                                                             | Home list                                                                     | —                                                                           |
| `EditSubscriptionModal.tsx`                         | Edit existing sub                                                                                                                                                                                                                                        | Card menu                                                                     | Same sheet chrome / `pb-5` risk                                             |
| `SubscriptionStatsModal.tsx`                        | Spend stats + renew                                                                                                                                                                                                                                      | Card menu                                                                     | Same                                                                        |
| `ConfirmModal.tsx`                                  | Generic confirm                                                                                                                                                                                                                                          | Various                                                                       | Same                                                                        |
| `ConflictResolutionModal.tsx`                       | Cloud sync conflicts                                                                                                                                                                                                                                     | CloudSync                                                                     | Same                                                                        |
| `UserSettingsModal.tsx`                             | Profile/settings sheet                                                                                                                                                                                                                                   | Settings                                                                      | Same                                                                        |
| `ListHeading.tsx`                                   | Section title                                                                                                                                                                                                                                            | Lists                                                                         | —                                                                           |
| `HiddenSearchWebView.tsx`                           | Headless WebView for search/scrape                                                                                                                                                                                                                       | Mounted in tab layout                                                         | Not user-facing                                                             |
| `EmailScanSection.tsx`                              | Connect/scan mailbox list used from Subscriptions                                                                                                                                                                                                        | Subscriptions (`addMailbox` param)                                            | —                                                                           |
| `ProtonCaptchaModal.tsx`                            | Official `verify.proton.me` puzzle during Proton scan                                                                                                                                                                                                    | Mounted in tab layout                                                         | Not a tab-bar overlay                                                       |

---

## Context (`src/context/`)

| File                      | Export                                     | Role                                                                                                |
| ------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `DatabaseProvider.tsx`    | `DatabaseProvider`, `useDatabase`          | Opens SQLCipher, applies schema v11, exposes DB handle                                              |
| `SubscriptionContext.tsx` | `SubscriptionProvider`, `useSubscriptions` | CRUD, prefs, upcoming, refresh; kicks crawl queue once DB is ready                                  |
| `IconCacheContext.tsx`    | `IconCacheProvider`, `useIconCache`        | In-memory `icon_key →` display bytes. No AppState listener here (child of root; DB is a descendant) |
| `CloudSyncContext.tsx`    | `CloudSyncProvider`, `useCloudSync`        | Provider connect + scoped sync of **user tables only**                                              |

Three lanes:

1. **Subscriptions** — Clerk user → encrypted SQLite → CRUD + prefs + analytics.
2. **Icon pipeline** — crawl discover/fetch → `icon_crawl_results` (device-local) → optional auto-promote into `icon_cache` → in-memory IconCache + UI listeners. On-demand AI upscale is separate from crawl.
3. **Cloud sync** — scoped payload of subscriptions + preferences + chosen `icon_cache` only. Crawl ephemera never leaves the device.

---

## Services (`src/services/`)

### Icon pipeline (do not casually reopen)

| File                                          | Role                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `iconBackgroundCrawler.ts`                    | Staged discovery: TIER 0 official-domain rank → 0.5 first-party extract → 1 libraries → 2 favicon → 3 image/dork + spider. Progressive publish. Last-good tree `7309add` + spinner `210c908` (not `063ac4b`). Card auto-assign uses `isPaintableCardIcon` (no SVG default). Key exports: `startIconCrawl`, `queueIconForScraping`, `processIconQueue`, `getIconCollection`, `findIconUrls`, `promoteFirstIconToCache`. |
| `domain/domainDiscovery.ts`                   | **Pure** brand→domain ranking/confidence. No crawler/search imports (the reverted Tranche B recursion was `domainDiscovery → searchForLinksToSpider → getOfficialDomainGuesses → domainDiscovery`).                                                                                        |
| `domain/provenance.ts`                        | `classifyCandidate` → official / library / brand-token / untrusted. Gates TIER 3 + spider. Untrusted URLs are rejected (the random-picture fix).                                                                                                                                           |
| `searchEngines.ts`                            | DDG/Bing/Google image + dork helpers; `searchAllSources`, `searchForLinksToSpider`. DDG is often CAPTCHA-blocked on emulator; discovery must fall back, not crash.                                                                                                                         |
| `crawlLifecycle.ts`                           | Truthful terminal semantics (provider outage ≠ complete), explicit cache ownership (crawler must not overwrite a valid manual/AI icon), stale-generation cancellation.                                                                                                                     |
| `iconQuality.ts`                              | Pure `scoreIconQuality` / `pickBestIcon` / `sortUrlsByQuality`.                                                                                                                                                                                                                            |
| `iconScraper.ts`                              | Library sources + `nameToSlug` / `generateAlternativeSlugs`.                                                                                                                                                                                                                               |
| `faviconExtractor.ts`, `htmlIconExtractor.ts` | Page-level icon extraction.                                                                                                                                                                                                                                                                |
| `iconUpscaler.ts`                             | TFLite ESPCN/FSRCNN. **`CRAWL_TIME_UPSCALE_ENABLED = false`.** Bilinear `upscaleIconIfSmall` and `upscaleIconAi` run only on user “Upscale (AI)”.                                                                                                                                          |
| `iconProcessing.ts`                           | Frozen hybrid: `bilin + 0.25 · clamp(residual)`. `upscaleIconAi`.                                                                                                                                                                                                                          |
| `iconValidation.ts`, `iconReportService.ts`   | `isBase64IconValid` (empty/transparent/near-white plate). `isPaintableCardIcon` = valid and not SVG (RN `Image` cannot paint SVG). Wrong/Broken hide. |
| `iconLoadingRegistry.ts`                      | In-flight upscale/load guards.                                                                                                                                                                                                                                                             |
| `rateLimitTracker.ts`                         | Domain cooldown; `recordSuccess` clears; honors `Retry-After`.                                                                                                                                                                                                                             |
| `whiteBgRemoval.ts`                           | “Clear White BG” in picker.                                                                                                                                                                                                                                                                |
| `webViewSearchEngine.ts`                      | Hidden WebView search bridge.                                                                                                                                                                                                                                                              |
| `generatedModelMap.ts`                        | Generated from `assets/models/model_map.json`. Do not hand-edit.                                                                                                                                                                                                                           |

### Data / sync

| File                                          | Role                                                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database.ts`                                 | Public facade (call sites stay here).                                                                                                                                                  |
| `db/schema.ts`                                | `SCHEMA_SQL`, `SCHEMA_VERSION = 11`, idempotent migrations, `applySchema()`. Crawl results plus local-only `mail_mailboxes` / `mail_messages`. |
| `db/connection.ts`                            | Key mgmt, open/close/`getDatabase`.                                                                                                                                                    |
| `db/syncScope.ts`                             | What is allowed to leave the device.                                                                                                                                                   |
| `cloudsync/CloudSyncService.ts` + `storage/*` | Google Drive / Dropbox / OneDrive / iCloud / OwnCloud. User tables + chosen icons only.                                                                                                |

### Tests (jest-expo, `npm test`)

- `src/services/__tests__/iconQuality.test.ts`
- `src/services/__tests__/iconScraper.test.ts`
- `src/services/__tests__/crawlLifecycle.test.ts`
- `src/services/domain/__tests__/domainDiscovery.test.ts`
- `src/services/domain/__tests__/provenance.test.ts`
- `src/services/emailscan/__tests__/chargeDisplay.test.ts`
- `src/services/emailscan/__tests__/classifier.test.ts`
- `src/services/emailscan/__tests__/scan.test.ts`

Characterization tests assert **actual** current behavior, not hoped-for behavior.

---

## Hooks / lib / constants / types

| Path                                             | Role                                                   |
| ------------------------------------------------ | ------------------------------------------------------ |
| `src/hooks/useCachedIcon.ts`                     | Card/picker image source from cache + bundled fallback |
| `src/hooks/useBottomClearance.ts`                | `pagePadding` / `tabListPadding` / `sheetPadding` for the absolute tab pill |
| `src/hooks/useChargeDisplay.ts`                  | Loads classified mail; `displayFor` / `cyclePeriod` / `monthlySpend` |
| `src/services/emailscan/chargeDisplay.ts`        | Display-only period math. Does not rewrite stored cadence. `thisMonthInsights`, `monthlyChartFromMail` |
| `src/lib/notifications.ts`                       | Cache-update notify (picker/card refresh)              |
| `src/lib/resolveLogo.ts`                         | Bundled / cached logo resolution                       |
| `src/lib/utils.ts`                               | Small helpers                                          |
| `src/constants/theme.ts`                         | Colors, spacing scale (no 25), `components.tabBar`     |
| `src/constants/icons.ts`, `images.ts`, `data.ts` | Bundled icons, images, tab/category data               |
| `src/types/fast-tflite.d.ts`                     | TFLite module types                                    |
| `src/config/`                                    | Not present as a source dir today                      |

---

## Theme / styles

NativeWind v5 + `global.css` (`@theme` spacing tokens listed above). Component classes: `tabs-*`, `home-*`, `insights-*` (incl. `insights-chart-*`), `auth-*`, `.modal-container` / `.modal-overlay`.

Insights chart structure today (`app/(tabs)/insights.tsx`):

- Title **Monthly spend from mail** (not “Estimated Monthly Spend”)
- Bars from `monthlyChartFromMail(subscriptions, messages, monthsToShow)`: sparse months use mail sums; recurring months use mail if present else stored monthly run-rate
- A **horizontal `ScrollView`** for the bar row (`width: 56` per bar)
- Value labels only when there are 3 or fewer points
- Period chips (`This Month` / `Last 3 Months` / `Last 6 Months` / `Year`) in a **separate** horizontal `ScrollView` below the card
- Leftover Year `contentOffset` can hide the single This Month bar until remount — note, not a new hop

---

## Models (`assets/models/`)

Pre-trained ESPCN/FSRCNN `.tflite` (+ `.keras` sources) and generated `model_map.json`. Inference hybrid frozen. **Do not train. Do not edit model files for UI work.**

---

## Icon pipeline contracts (frozen — see `docs/plan.md` Major Fix)

Original-source, candidate-identity, resolution, format, provenance, picker, manual-selection, auto-promotion, upscale-eligibility, AI-replacement, notification/atomicity, card, lifecycle, responsiveness.

UI phases must not regress these. After any UI change that rebuilds the app, the cross-layer smoke is still: crawler discovery still runs, long-press still opens the picker, selection still persists, upscale chips still exist.

---

## Build / verify / emulator

| Command                                      | Role                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit`                           | Types                                                                                             |
| `npx expo lint` / `npm run lint`             | Lint                                                                                              |
| `npm test`                                   | Jest (`preset: jest-expo`)                                                                        |
| `npm run build:android:x86_64`               | Self-contained release APK + install (`scripts/android/build-android.sh --arch x86_64 --install`) |
| `npm run emulator:start` / `stop` / `status` | `scripts/android/android-emulator.sh`                                                             |
| `npm run verify:android`                     | Launch + logcat smoke                                                                             |
| `npm run local:start`                        | Dev/watch x86_64                                                                                  |

APKs land in `build-out/apk/`. Docs: `docs/BUILD.md`.

Programmatic gate is **not** a completed visual gate. Visual gates use `.cline/skills/emulator-ui-driving/SKILL.md`.

---

## Emulator driving (generic skill)

`.cline/skills/emulator-ui-driving/SKILL.md` (YAML frontmatter `name: emulator-ui-driving` — required for Cline discovery).

Invariant: every UI-affecting adb command is followed by `adb exec-out screencap`, read back via vision, and asserted **before** the next UI command. No button-specific coordinates in the skill.

Known device facts (generic, not a button recipe): `wm size` 1080×2400; software nav occupies ~y>2320; long-press = `input swipe X Y X Y 800`; locate targets via uiautomator bounds.

---

## What UI Phases 1–4 must change (and what they must not)

Hops A–E already landed on top of Phases 1–3. Do not reopen them as if they were still the next work.

| Phase                | Touches                                                                                                | Must not touch                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 1 Nav overlay        | Tab list bottom padding; Create + picker (+ other sheets that share the collision) inset-aware padding | Crawler, models, schema; **tab-bar restyle**                    |
| 2 Subscriptions `+`  | `app/(tabs)/subscriptions.tsx` header + existing `CreateSubscriptionModal` wiring (copy Home)          | New create flow, crawler                                        |
| 3 Insights chart     | `app/(tabs)/insights.tsx` bar row scroll / label hide                                                  | Period-chip `ScrollView` (already scrolls); other tabs          |
| A–E Home/Insights    | Proven 2026-08-24. See `docs/plan.md` hop board.                                                       | Do not start a new hop from leftover Year scroll                |
| 4 Connected accounts | Settings / Subscriptions email-scan; H1 catalog honesty; H2 IMAP socket; H3 HTTPS                      | SSO catalogs, crawler, training; do not call Phase 4 done       |
