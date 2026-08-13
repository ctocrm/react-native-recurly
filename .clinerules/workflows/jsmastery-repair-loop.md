# jsmastery Repair Loop

Use this workflow for bug fixes, regressions, recovery work, and any change where a prior fix may have broken adjacent behavior.

The execution-plan source of truth is `docs/plan.md`. The historical failure evidence is in `docs/LESSONS_LEARNED.md`. Always obey `.clinerules/00-core-safeguards.md`.

## Operating rule

Work on one root issue at a time. Do not skip a gate and do not call a phase complete from static inspection alone.

Maintain an attempt counter for the current root issue. An implementation attempt fails when the proposed fix fails its relevant validation, fails to reproduce the requested behavior, introduces a regression, or cannot pass a required build/device gate because of the change.

## Main loop

### 1. Analyse

Before editing:

1. Restate the requested outcome and distinguish it from possible but materially different interpretations.
2. If the user names a product/tool feature, verify what that native feature means and how it is discovered before implementing it.
3. Read `docs/plan.md` and the relevant sections of `docs/LESSONS_LEARNED.md`.
4. Read every source/config/doc file relevant to the issue.
5. Read git history and diffs around the last known working behavior and suspected regression.
6. Read relevant prior project conversations when historical context matters.
7. Read the actual UI interaction path before testing it.
8. Record:
   - observed symptom
   - expected behavior
   - last known working state when known
   - evidence
   - current hypothesis
   - files that should be in scope
   - explicit non-goals
   - validation/reproduction procedure
9. If the evidence set is broad, use focused subagents rather than filling the main context indiscriminately.
10. Do not edit until the hypothesis and intended outcome are coherent.

### 2. Checkpoint before risky work

Before deletion, broad movement/refactor, schema changes, dependency changes, model/training work, or other high-blast-radius edits:

1. Inspect `git status`.
2. Preserve unrelated user changes.
3. Create a focused checkpoint containing only the state that needs protection.
4. Never use a broad `git add -A` when unrelated work is present.

### 3. Edit

1. Make the smallest change that tests the current hypothesis.
2. Touch only files relevant to the current issue.
3. Do not opportunistically fix newly discovered unrelated problems.
4. If a new issue is found, record it in `docs/plan.md` or task notes for later.
5. Do not modify tests merely to make a broken implementation appear correct.

### 4. Lint / syntax / static checks

Run the checks relevant to the changed files, including the project's normal gates where applicable:

- `npx tsc --noEmit`
- `npm run lint`
- relevant existing tests

If a check fails because of the change:

1. Treat the implementation attempt as not yet validated.
2. Diagnose the failure before changing code again.
3. Do not weaken validation to obtain a pass.

### 5. Commit the validated code state

After static checks pass:

1. Review `git diff` and `git status`.
2. Confirm unrelated files are not included.
3. Commit the focused implementation with a descriptive message.

This commit is a recovery point, not proof that the user-facing bug is fixed.

### 6. Build + emulator/device

1. Use the documented Android path in `docs/BUILD.md` and current `package.json`.
2. Build the appropriate target.
3. Install/launch on the emulator or device.
4. Confirm the app actually reaches the running UI without a React Native fatal/runtime crash.
5. Do not substitute “build succeeded” for “app launched.”

If the environment itself blocks this gate, separate infrastructure failure from implementation failure and report the gate as unverified.

### 7. Test the actual behavior

Reproduce the user's path, not a proxy for it.

For icon/crawler work:

1. Clear icon/crawl state when a clean crawl is part of the reproduction.
2. Test at least 5 real, diverse subscriptions, including uncommon companies.
3. Reach the icon picker through the real interaction: long-press the subscription card icon.
4. Verify candidate images are actually brand-correct, not merely downloadable/valid images.
5. Verify progressive/background behavior and UI responsiveness separately.
6. Inspect relevant logs/network behavior when results fail.

For other work, use the real user-facing reproduction procedure established during Analyse.

Only mark an attempt successful when the reported behavior is demonstrated end-to-end.

### 8. Docs + hygiene

After the behavior is proven:

1. Update `docs/plan.md` to reflect reality.
2. Update the relevant SSOT documentation if behavior/configuration changed.
3. Remove only temporary artifacts created by this work.
4. Do not create overlapping documentation when an existing SSOT should be updated.
5. Run a final `git status`/diff review for accidental unrelated changes.

### 9. Final documentation commit

Commit the focused documentation/hygiene changes separately when appropriate.

### 10. Repeat or finish

- If the current phase has additional scoped issues, return to Analyse for the next issue.
- If all required behavior and gates are proven, report completion with the concrete validation evidence.
- If a required gate remains unverified, say so explicitly instead of claiming full completion.

## Three-strike interrupt loop

If three consecutive implementation attempts fail for the same root issue, STOP the main loop. Do not make a fourth speculative fix.

### A. Freeze and preserve

1. Stop editing the issue.
2. Inspect the current diff/status.
3. Create a focused checkpoint if there is uncommitted investigative state worth preserving.
4. Do not discard evidence from the failed attempts.

### B. Give the user a detailed resume

Report:

- original symptom and expected behavior
- last known working state
- reproduction steps
- relevant architecture/code paths
- evidence collected
- attempt 1: hypothesis, exact change, validation result
- attempt 2: hypothesis, exact change, validation result
- attempt 3: hypothesis, exact change, validation result
- commits/checkpoints involved
- what is known versus inferred
- remaining hypotheses and uncertainty
- any cost/risk implications of further experimentation

### C. Brainstorm with the user

1. Enter a back-and-forth planning discussion.
2. Do not edit while the replacement approach is unsettled.
3. Offer materially different approaches based on evidence, including tradeoffs.
4. Do not merely rename/repackage the same failed hypothesis.
5. Continue until the user and Cline agree on a new direction.

### D. Update and commit the revised plan

1. Update the relevant section of `docs/plan.md` with:
   - failed approach
   - evidence that invalidated it
   - newly agreed hypothesis/strategy
   - exact next validation
2. Commit the revised plan before implementation resumes.

### E. Resume the main loop

Return to Analyse using the revised plan. Reset the three-attempt counter only because the underlying approach/hypothesis has materially changed.

## Tool/infrastructure failure interrupt

Tool failures are not an excuse to loop:

1. After one tool failure, diagnose it.
2. Never repeat the identical call solely because it failed or produced no useful result.
3. Change quoting, encoding, tool, or investigation mechanism as appropriate.
4. After two failures on one infrastructure path, choose a different mechanism.
5. After three failures on that path, stop and report the blocker.

## Hard cost safeguard

Do not start model training, rent/recommend paid compute, or regenerate a training matrix during this workflow unless:

1. the user explicitly unfreezes training, and
2. the existing app inference wiring has first been proven end-to-end with a known existing model.

A training run is never a substitute for proving app wiring, preprocessing, inference, model selection, or validation first.
