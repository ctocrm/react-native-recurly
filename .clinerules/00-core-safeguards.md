# Core Safeguards — jsmastery

These are mandatory invariants for every Cline task in this project. The detailed failure history is in `docs/LESSONS_LEARNED.md`; keep this rule concise enough to remain useful as always-on context.

## Understand intent before implementation

- Before acting, identify the user's actual requested outcome, not merely a plausible interpretation of their words.
- When the user names a product/tool feature such as a Cline Workflow, Rule, Hook, Skill, MCP, plugin, command, or checkpoint, verify that feature's current semantics and discovery/storage format before implementing it.
- Do not silently substitute a generic artifact for a native feature. Example: a markdown document describing a workflow is not a Cline Workflow.
- Resolve intent from the code, project history, documentation, and surrounding context first. If materially different interpretations remain and they lead to different work, ask the user before editing.
- Do not ask unnecessary questions when the intent can be established from available evidence.

## Read relevant evidence before editing

- Never edit before reading all source files, documentation, git history, and prior project conversations relevant to the requested change.
- Use focused exploration or subagents when the evidence set is broad; do not consume the main context by indiscriminately dumping files.
- Check git history (`git log`, `git show`, diffs) to understand previous behavior and regressions before changing code.
- Read interaction code before trying to test the UI. Example: the subscription icon picker is reached by long-pressing the card icon.

## One issue at a time

- Fix one problem, verify it, then move to the next.
- Do not touch unrelated files while fixing an issue.
- If another issue is discovered, record it in the plan but do not silently expand scope.
- Before risky changes or deletion, create a focused git checkpoint that excludes unrelated working-tree changes.

## No claims without end-to-end evidence

- Never claim a fix is complete solely because code looks correct, lint passes, or a build succeeds.
- Bug fixes must pass the relevant syntax/type/lint checks, build, emulator/device launch, and actual user-facing reproduction test unless the user explicitly changes the gate.
- If a required gate cannot be run, state that it remains unverified; do not convert partial evidence into a success claim.
- For crawler/icon quality work, test at least 5 real, diverse subscriptions, including uncommon companies, after clearing state when needed.
- Verify results are brand-correct icons, not merely valid images.

## No tool-call spirals

- Never submit an identical tool call merely because the previous call failed, was rejected, or returned no useful result.
- After the first tool/infrastructure failure, diagnose the cause before the next call.
- If the failure is caused by command encoding, quoting, XML escaping, permissions, or the selected tool, change the mechanism rather than retrying the same payload.
- After two infrastructure failures on one path, use a different tool or investigation strategy.
- After three failures on one path, stop that path and report the blocker instead of consuming more time/tokens.
- Do not issue duplicate tool invocations in one response.

## Three-strike fix safeguard

- Count consecutive implementation attempts for the same root issue.
- If three consecutive fix attempts fail validation, STOP the main repair loop.
- Produce a detailed resume for the user: symptoms, evidence, attempts, diffs/commits, observed failures, hypotheses, and remaining uncertainty.
- Preserve the current state with a focused git checkpoint.
- Brainstorm with the user until a materially different approach is agreed.
- Update `docs/plan.md` with that approach and commit the plan before resuming implementation.
- Reset the attempt counter only after the approach materially changes or the failed hypothesis is replaced.

## Expensive/destructive work requires proof first

- Training is frozen per `docs/plan.md` and `docs/AI_UPSCALING.md`. Do not start model training unless the user explicitly unfreezes it.
- Before any future training, first prove end-to-end that the app loads and runs an existing known model through the intended inference path.
- Never recommend paid compute to compensate for an unverified wiring, data, validation, or inference problem.
- Never delete data/files or rewrite broad repository history without a checkpoint and explicit need.

## Documentation and workflow

- `docs/plan.md` is the execution-plan SSOT.
- `docs/LESSONS_LEARNED.md` records failure patterns and their evidence.
- `docs/CLINE_WORKFLOW.md` is human-readable workflow documentation.
- The native Cline repair workflow lives at `.clinerules/workflows/jsmastery-repair-loop.md`; do not confuse the documentation with the Cline-managed artifact.
- Follow the native repair workflow for bug/recovery work: Analyse → Edit → Lint/Syntax → Commit → Build+Emulator → Test → Docs/Hygiene → Commit → Repeat.
