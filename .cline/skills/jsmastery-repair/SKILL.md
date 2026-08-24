---
name: jsmastery-repair
description: For bug fixes, regressions, recovery, crawler/icon failures, build/runtime breakage, or debugging in the jsmastery Expo app. Performs evidence-first git/history analysis, follows the phased repair loop, verifies on emulator/device, and applies the three-strike recovery safeguard. Do not use for simple questions or unrelated greenfield work.
---

# jsmastery Repair

Use this skill when repairing existing behavior in this repository.

Always obey `.clinerules/00-core-safeguards.md`. For a user-invoked full repair lifecycle, follow `.clinerules/workflows/jsmastery-repair-loop.md`.

## Sources of truth

Read these as applicable before editing:

- `docs/plan.md` — execution-plan SSOT and current frozen/non-goal decisions
- `docs/LESSONS_LEARNED.md` — historical failure evidence and recurring anti-patterns
- `docs/BUILD.md` — Android build/emulator procedure
- `docs/AI_UPSCALING.md` — training/inference SSOT; training is frozen
- `AGENTS.md` — repository-level agent guidance
- exact Expo SDK 54 documentation before writing Expo-sensitive code

Do not treat historical autopsy claims as current runtime truth without checking current code and git history.

## Evidence-first diagnosis

For a regression:

1. Establish the exact user-visible symptom and expected behavior.
2. Read the relevant current implementation end-to-end, including the interaction path.
3. Inspect git history for:
   - last known working state
   - suspected regression commit
   - later attempted repairs
4. Compare code, not commit-message wording alone.
5. Read relevant prior Cline conversations if the regression spans prior agent work.
6. State the current hypothesis and what evidence would falsify it.
7. Keep unrelated issues out of scope.

When broad history must be examined, use focused subagents to summarize bounded evidence sets instead of dumping everything into the main context.

## Repair lifecycle

Use this sequence:

1. Analyse
2. Edit one root issue
3. Run syntax/type/lint and relevant existing tests
4. Review diff and make a focused recovery-point commit
5. Build Android and launch emulator/device
6. Reproduce the actual user behavior
7. Update documentation/hygiene only after behavior is proven
8. Commit documentation/hygiene
9. Repeat for the next scoped issue

A successful static check or build is not evidence that the behavior is fixed.

Documentation and rules-editing turns are hygiene; they are never the agreed behavior step and never count as progress on the user's named outcome. They may not loosen a hard gate. When the next hop for the diagnosis is already known, implement that hop; do not present a list of easier adjacent changes as the completed change.

## Three-strike safeguard

Track consecutive implementation attempts of the **same hypothesis**, not every edit toward the user's named outcome.

After three consecutive failed attempts of that hypothesis:

1. Pause that hypothesis; no fourth speculative fix of the same guess.
2. Preserve useful state with a focused checkpoint.
3. Give the user a detailed resume containing:
   - symptom and expected behavior (the named outcome — still open)
   - reproduction
   - relevant code paths
   - last known working state
   - evidence collected
   - each attempt, change, and validation result
   - commits/checkpoints
   - known facts versus hypotheses
   - unresolved uncertainty
4. Offer 2–5 materially different options with tradeoffs. Wait for the user to pick.
5. Do not resume implementation until an approach is agreed. Do not quit or call the task done/failed/"gap only."
6. After the user picks, update `docs/plan.md` with the failed approach, new strategy, and next validation. A plan commit is not a substitute for the agreed action.
7. Commit the revised plan.
8. Resume is required. Implement the option the user picked. Reset the attempt counter only because the hypothesis materially changed. Strikes do not carry across an agreed new hop.


## Icon/crawler-specific knowledge

Current unresolved project issue at the time this skill was created: the crawler regression still needs proper recovery. UI freezing was addressed separately; do not conflate crawler correctness with UI responsiveness.

Relevant areas include:

- `src/services/iconBackgroundCrawler.ts`
- `src/services/searchEngines.ts`
- `src/services/htmlIconExtractor.ts`
- `src/services/iconProcessing.ts`
- database crawl/cache paths under `src/services/`
- `src/components/SubscriptionIconPickerModal.tsx`

Before changing crawler behavior, inspect the git history from before the upscaling work and the later responsiveness repairs. Do not assume the latest crawler commit restored search quality merely because it restored asynchronous/progressive behavior.

Crawler validation must:

1. Start from clean icon/crawl state when testing fresh discovery.
2. Use at least 5 diverse real subscriptions, including uncommon companies.
3. Inspect progressive results rather than waiting only for a final state.
4. Verify each candidate is actually associated with the intended brand.
5. Reject random page images, generic placeholders, and technically valid but incorrect images as failures.
6. Verify UI responsiveness separately from icon discovery correctness.
7. Inspect crawler/network logs for rate limits, search failures, and queue behavior.

The picker is reached by **long-pressing the subscription card icon**. Read the current interaction code before testing in case it changes.

## Upscaling/training guard

Historical failure: the user spent substantial time and money repeatedly training models while app-side inference/model-selection wiring was wrong or unverified.

Therefore:

- Training is frozen unless the user explicitly unfreezes it.
- Never propose retraining as the first response to an app-side quality/inference problem.
- Before any future training expense, prove that a known existing model:
  1. is selected as expected,
  2. loads successfully,
  3. receives the expected preprocessing/input shape,
  4. runs through the actual app inference path,
  5. produces output that reaches the UI/persistence path.
- Distinguish training quality, model export, model selection, inference wiring, preprocessing, and UI integration as separate hypotheses.
- Never spend compute to compensate for an unverified software path.

## Build/runtime verification

Use the current commands documented by `package.json` and `docs/BUILD.md`; do not rely on remembered script names from old conversations.

Required evidence for a runtime fix normally includes:

- relevant static checks pass
- build succeeds
- APK/app installs and launches
- React Native reaches the running UI without fatal error
- exact reproduction path demonstrates the requested behavior

If any required gate cannot be completed, report it as unverified.

## Change isolation

Before committing:

1. Run `git status`.
2. Review the focused diff.
3. Exclude unrelated user changes and generated/reference material not part of the task.
4. Never use broad staging merely for convenience when unrelated work exists.
5. Do not change tests to bless a regression.

## Tool-failure behavior

A failed tool call is evidence about the mechanism.

- Do not resend an identical failed call.
- Diagnose encoding/quoting/path/permission/tool-selection failures.
- Switch mechanism after repeated infrastructure trouble.
- Stop a failing investigation path after three failures and report the blocker.
- Never emit duplicate tool invocations in one response.

## Completion language

State exactly what was demonstrated. Separate:

- implemented
- statically validated
- built
- launched
- behaviorally reproduced
- still unverified

Never collapse these into “fixed” unless the required end-to-end evidence exists.
