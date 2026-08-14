# Codebase overview (jsmastery)

Expo ~54 / React Native 0.81 / expo-router 6 subscription-tracker with an
on-device icon crawler, AI (TFLite) upscaler, SQLCipher storage and scoped cloud
sync. **Training is frozen** (see `docs/AI_UPSCALING.md`).

## App screens (`app/`, expo-router)

| Route                            | Purpose                                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `(tabs)/index.tsx`               | Home: monthly spend, upcoming, all-subs preview, header "+" opens `CreateSubscriptionModal`                                                                    |
| `(tabs)/subscriptions.tsx`       | Full list: search, All/Upcoming filters, expand/edit/delete/stats, long-press card icon → icon picker. **No "+" header (Phase 2 adds it)**                     |
| `(tabs)/insights.tsx`            | Spend summary, category bars, "Estimated Monthly Spend" bar chart with period chips (This Month/3/6/Year). **Chart overflows card on 6mo/1yr (Phase 3 fixes)** |
| `(tabs)/settings.tsx`            | Profile, Account, Cloud Sync (provider connect), Backup/Restore, Cache & Crawl clearing, Sign out. **Phase 4 adds Connected Accounts**                         |
| `(auth)/signIn`, `(auth)/signUp` | Clerk auth                                                                                                                                                     |
| `subscriptions/[id].tsx`         | Detail                                                                                                                                                         |
| `onboarding.tsx`                 | First-run                                                                                                                                                      |

`(tabs)/_layout.tsx`: Clerk-gated `<Tabs>`; tab bar absolutely positioned with
`bottom: Math.max(insets.bottom, tabBar.horizontalInset)` (uses
`useSafeAreaInsets`). Providers: Database → Subscription → CloudSync; plus
`HiddenSearchWebView` for background scraping.

## Components (`src/components/`)

`CreateSubscriptionModal` (name/price/frequency/category + autocomplete + crawl
trigger), `EditSubscriptionModal`, `SubscriptionCard` (+`SubscriptionCardMenu`),
`UpcomingSubscriptionCard`, `SubscriptionIconPickerModal` (long-press picker:
tiles, Wrong/Broken reports, Clear-White-BG, Upscale(AI), Show incorrect/broken,
AI Upscale Quality Fast/Sharp), `SubscriptionStatsModal`, `ConfirmModal`,
`ConflictResolutionModal`, `UserSettingsModal`, `ListHeading`,
`HiddenSearchWebView`.

## Context (`src/context/`)

`SubscriptionContext` (CRUD + refresh), `DatabaseProvider` (SQLCipher open),
`IconCacheContext` (in-memory icon map), `CloudSyncContext` (scoped sync).

## Services (`src/services/`)

- `database.ts` + `db/` — SQLCipher facade; schema v8; crawl results, queue,
  crawled_urls, reports, icon_cache; backup/import/sync-scope.
- `iconBackgroundCrawler.ts` — staged discovery (TIER 0 official-domain rank →
  0.5 first-party extract → 1 libraries → 2 favicon → 3 image/dork + spider),
  provenance-gated publication, bounded/yielding downloads, truthful terminal
  status, stale-gen cancellation, explicit cache ownership (`crawlLifecycle.ts`).
- `domain/domainDiscovery.ts` — provider-independent domain ranking/confidence.
- `domain/provenance.ts` — `classifyCandidate` (official/library/brand-token/
  untrusted) gating TIER 3 + spider (precision fix).
- `iconQuality.ts` (source/format/dimension scoring), `iconScraper.ts`
  (library sources + nameToSlug), `faviconExtractor.ts`, `htmlIconExtractor.ts`,
  `iconUpscaler.ts` (TFLite ESPCN/FSRCNN; crawl-time upscale disabled; manual
  Upscale(AI) only), `iconValidation.ts`, `iconReportService.ts`,
  `rateLimitTracker.ts`, `iconLoadingRegistry.ts`, `cloudsync/`.

## Theme / styles

NativeWind v5 + `global.css` (Tailwind). Component classes: `tabs-*`,
`home-*`, `insights-*` (incl. `insights-chart-*`), `auth-*`, modal sheets.
`src/constants/` icons/images/theme/data (tabs).

## Models (`assets/models/`)

Pre-trained ESPCN/FSRCNН `.tflite` (+ `.keras` sources) and generated
`model_map.json`. Inference hybrid frozen: `bilin + 0.25·clamp(residual)`.

## Icon pipeline contracts (frozen)

Original-source, candidate-identity, resolution, format, provenance, picker,
manual-selection, auto-promotion, upscale-eligibility, AI-replacement,
notification/atomicity, card, lifecycle, responsiveness — see `docs/plan.md`
"Major Fix" §Frozen full-pipeline contracts.

## Build / verify

`npm run build:android:x86_64` (install+launch), `verify:android`, emulator
scripts under `scripts/android/`. Gate: `npx tsc --noEmit` + build + logcat
`Running "main"` no RN fatal. Jest via `jest-expo`.

## Emulator driving

Generic loop in `.cline/skills/emulator-ui-driving/SKILL.md`: every UI-affecting
adb command → `adb exec-out screencap` → vision assert → next command.
