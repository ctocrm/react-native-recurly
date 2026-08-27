# Tranche C+D — Provenance-aware precision (picker pollution fix)

**Commit:** 9d2f715
**Date:** 2026-08-14
**Problem (user-confirmed):** picker still polluted with random/unrelated pictures
after Tranche B. Tranche B only touched TIER 0 (official-domain discovery), which
fell back because DDG is CAPTCHA-blocked here; the pollution entered downstream.

## Pollution entry points removed

1. **TIER 3 direct images** — `looksLikeDirectImage` accepted ANY image-extension
   URL from ANY domain (`fitliferegime.com/.../Inchworm.webp`). Now gated by
   `classifyCandidate` provenance; untrusted URLs rejected + counted.
2. **SPIDER** — fetched up to 40 arbitrary search-result pages and pulled _that
   page's_ favicon/og:image/logo. Now restricted to official-host (first-party)
   pages only.
3. **TIER 0.5 official `<img>`** — queued up to 50 generic `<img>` (menu chrome).
   Now only `<img>` with a real logo/brand/apple-touch signal (score>0).

## New module

`src/services/domain/provenance.ts` — `classifyCandidate(brand, officialHosts,
url)` → `official | library | brand-token | untrusted`; `officialHostsForBrand`.
6 unit tests (40 total pass).

## On-device verification (build installed, GitHub subscription added)

```
[SEARCH] TIER 3: Queued 1 direct image URLs; rejected 47 untrusted-provenance URLs
[SEARCH] SPIDER: Processing 4 official-host links (of 47)
[PICKER] Loaded 16 icons for github (16 total, reports hidden by default)
```

Picker screenshot: first tile = brand-correct GitHub octocat; NO random pictures.
Remaining blank tiles are transparent/white candidates behind Wrong/Broken report
chips (a separate quality issue, not the random-imagery pollution).

## Gates passed

- `npx tsc --noEmit` PASS; `npx jest` 40/40 PASS.
- Android build installed/launched; no RN fatal; no recursion.
- Downstream contracts (crawl-result rows, picker ordering, upscale UI) unchanged.
