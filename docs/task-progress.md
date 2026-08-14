# Task progress — Major Fix (updated 2026-08-13, honest state)

- [x] Tranche A: Characterize + baseline — DONE (with noted gaps)
  - [x] Jest infrastructure added (jest-expo preset); 20/20 characterization tests pass; `tsc` clean (commit fb65af6)
  - [x] 3 tests that encoded assumed-not-actual behavior corrected to assert actual current behavior
  - [x] Premature Tranche B commit e08f5cd REVERTED (370dc55) — latent infinite-recursion bug, never end-to-end verified; preserved on branch tranche-b-attempt-e08f5cd + stash tranche-b-wip-sync-fix
  - [x] Real emulator baseline via real UI path (user-driven) for netflix + 3 uncommon brands (Le Devoir, Ace Hardware, Ground News): docs/crawler-baseline.md (+ .log, -multibrand.log) — findings F1–F12 (commits 9b38445, 4d26c1c, 0c41ffb)
  - [x] Selection → card persistence → kill/relaunch smoke — VERIFIED (Ace Hardware manual selection survives force-stop + relaunch; user-confirmed)
  - [ ] Low-res → Upscale eligibility smoke — NOT DONE (no upscale run; deferred to Tranche D/E integration testing)
  - [ ] 5th baseline brand — 4 tested; full 8-brand acceptance list is Tranche F scope
- [ ] Tranche B: Official-domain discovery — NOT STARTED (first attempt reverted; redo per plan after A)
- [ ] Tranche C: First-party extraction
- [ ] Tranche D: Provenance-aware acceptance and ranking
- [ ] Tranche E: Resilience, terminal state and cache ownership
- [ ] Tranche F: Full end-to-end acceptance
