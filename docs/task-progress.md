# Task progress — Major Fix (updated 2026-08-13, honest state)

- [~] Tranche A: Characterize + baseline — PARTIAL
  - [x] Jest infrastructure added (jest-expo preset); 20/20 characterization tests pass; `tsc` clean (commit fb65af6)
  - [x] 3 tests that encoded assumed-not-actual behavior corrected to assert actual current behavior
  - [x] Premature Tranche B commit e08f5cd REVERTED (370dc55) — it contained a latent infinite-recursion bug and was never end-to-end verified; preserved on branch tranche-b-attempt-e08f5cd + stash tranche-b-wip-sync-fix
  - [x] Real emulator baseline captured for netflix via real UI path (user-driven): docs/crawler-baseline.md + .log (commit 9b38445) — precision failure CONFIRMED (wrong-brand tiles in picker), autocomplete prefix crawl storm, picker 6→55 icon growth, ~2s picker reload loop, fetch-level content-type rejection works, DDG CAPTCHA evidence
  - [ ] Selection → card persistence smoke — NOT DONE
  - [ ] Low-res → Upscale eligibility smoke — NOT DONE
  - [ ] Picker reopen / app relaunch persistence smoke — NOT DONE
  - [ ] Baseline for 4+ more diverse brands (Spotify, GitHub, Linear, 1Password, Miro, Toggl Track, Backblaze) — NOT DONE
- [ ] Tranche B: Official-domain discovery — NOT STARTED (first attempt reverted; redo per plan after A)
- [ ] Tranche C: First-party extraction
- [ ] Tranche D: Provenance-aware acceptance and ranking
- [ ] Tranche E: Resilience, terminal state and cache ownership
- [ ] Tranche F: Full end-to-end acceptance
