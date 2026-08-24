# Core Safeguards — jsmastery

These are mandatory invariants for every Cline task in this project. The detailed failure history is in `docs/LESSONS_LEARNED.md`; keep this rule concise enough to remain useful as always-on context.

## Understand intent before implementation

- Before acting, identify the user's actual requested outcome, not merely a plausible interpretation of their words.
- When the user names a product/tool feature such as a Cline Workflow, Rule, Hook, Skill, MCP, plugin, command, or checkpoint, verify that feature's current semantics and discovery/storage format before implementing it.
- Do not invent paths, discovery directories, or storage formats for native Cline features. If you have not read the actual location (or the user has not shown it), say you do not know. Do not present a guess as fact.
- Global Skills live at `/home/d/.agents/skills/<name>/SKILL.md`. That path was established by user evidence, not inference. Do not put Global Skills in `Documents/Cline/Skills` or claim a directory is the Global Skills location without listing it first.
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
- One issue is the **user's named outcome**, not a smaller milestone the agent invents after a partial win.
- Finding a new hole does not let the agent abandon the named outcome.
- Recording the hole in the plan is not permission to stop.

## The user's named outcome is the only definition of done

- The user-visible sentence the user asked for is the only definition of done.
- Forbidden substitutes for done: listed N messages, an HTTP status, unit tests, a rebuild, a cache wipe, a screenshot of the wrong screen, a plan note, a changelog, an apology, or acknowledging the outcome.
- Also forbidden: a stack of adjacent "showroom" changes (rebuild/wipe/screenshot, cache bump, parse tweak, adjacent refactor) presented together as the same completed change when the user-facing gate has actually moved.
- When the exact next hop toward the named outcome is already known and agreed (for example the BlobAccessToken POST then BlobService GET path), that hop is the deliverable. Shipping a list of nearby, easier improvements instead is not the same change and is not done.
- A rules-editing or documentation turn during a feature cycle is not progress on the user's named outcome and must not be mixed into the same turn as the agreed code hop.
- Do not ask the user to weaken, remove, or rephrase safeguards so a different finish line becomes legal.

## Process is not the product

- Updating `docs/plan.md`, `docs/LESSONS_LEARNED.md`, writing a fail report, or making a docs commit is **not the task** unless the user asked only for documentation.
- Docs/hygiene only after the user's named gate is proven.
- Committing "we failed at X" instead of doing the agreed next action is a rule violation.

## No claims without end-to-end evidence

- Never claim a fix is complete solely because code looks correct, lint passes, or a build succeeds.
- Bug fixes must pass the relevant syntax/type/lint checks, build, emulator/device launch, and actual user-facing reproduction test unless the user explicitly changes the gate.
- If a required gate cannot be run, state that it remains unverified; do not convert partial evidence into a success claim.
- For crawler/icon quality work, test at least 5 real, diverse subscriptions, including uncommon companies, after clearing state when needed.
- Verify results are brand-correct icons, not merely valid images.
- An honest fail write-up is not a completed task.
- Unverified and failed are not done. The original outcome stays open until the **user** changes it.

## No tool-call spirals

- Never submit an identical tool call merely because the previous call failed, was rejected, or returned no useful result.
- After the first tool/infrastructure failure, diagnose the cause before the next call.
- If the failure is caused by command encoding, quoting, XML escaping, permissions, or the selected tool, change the mechanism rather than retrying the same payload.
- After two infrastructure failures on one path, use a different tool or investigation strategy.
- After three failures on one path, stop that path and report the blocker instead of consuming more time/tokens.
- Do not issue duplicate tool invocations in one response.

## Three-strike fix safeguard

- Count consecutive implementation attempts of the **same hypothesis**, not every edit toward the user's outcome.
- Three-strike stops a **fourth blind implementation of the same hypothesis**.
- It is a **pause**, not task completion. Do not say done, fail, or "gap only" as if the outcome is closed.
- After three failed attempts: stop that hypothesis, preserve a focused checkpoint, give a detailed resume, then offer 2–5 materially different options with tradeoffs and wait for the user to pick.
- Then implement **the option the user picked**. That resets the counter because the hypothesis changed.
- Strikes do not carry across an agreed new hop (example: list/header HMAC unwrap is not the same hypothesis as a body BlobAccessToken fetch).
- After the user picks, resume is required. Quitting is a violation.
- Update `docs/plan.md` with the agreed approach only after the user picks, then resume implementation. A plan commit is not a substitute for the agreed action.

## Expensive/destructive work requires proof first

- Training is frozen per `docs/plan.md` and `docs/AI_UPSCALING.md`. Do not start model training unless the user explicitly unfreezes it.
- Before any future training, first prove end-to-end that the app loads and runs an existing known model through the intended inference path.
- Never recommend paid compute to compensate for an unverified wiring, data, validation, or inference problem.
- Never delete data/files or rewrite broad repository history without a checkpoint and explicit need.
- If the next action is already agreed, **do that action**. Do not re-acknowledge, re-read the plan, or rebuild first.
- Ceremony (reread / wipe / screenshot / plan note) while an agreed code/POC change is pending is a cost violation.
- Token spend after the correct hop is known, without implementing it, is the failure this section exists to stop.

## Documentation and workflow

- `docs/plan.md` is the execution-plan SSOT.
- `docs/LESSONS_LEARNED.md` records failure patterns and their evidence.
- `docs/CLINE_WORKFLOW.md` is human-readable workflow documentation.
- The native Cline repair workflow lives at `.clinerules/workflows/jsmastery-repair-loop.md`; do not confuse the documentation with the Cline-managed artifact.
- Follow the native repair workflow for bug/recovery work: Analyse → Edit → Lint/Syntax → Commit → Build+Emulator → Test → Docs/Hygiene → Commit → Repeat.
- Update documentation after the user-facing gate is proven, not after a failed attempt.

