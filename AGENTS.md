# AGENTS.md — jsmastery Project

## Expo HAS CHANGED

Read the exact versioned docs at <https://docs.expo.dev/versions/v54.0.0/> before writing any code.

## Cline Rules

This project enforces strict Cline rules in `.clinerules/`. These rules are **mandatory** on every task and exist to prevent the mistakes documented in `docs/LESSONS_LEARNED.md`. The always-on core safeguards are in `.clinerules/00-core-safeguards.md`. Key rules:

1. **Read everything before acting** — never edit code before reading all relevant source files, git history, and prior conversations.
2. **No claims without verification** — never claim a fix is complete without building and testing on the emulator.
3. **One issue at a time** — do not touch unrelated files when fixing one issue.
4. **Test with 5+ real, diverse subscriptions** — verify icon quality is brand-correct.
5. **Commit before risky changes** — git commit first, then edit.
6. **No model training without wiring verification** — training is frozen per `docs/plan.md`.
7. **3-strike safeguard** — if 3 consecutive attempts of the **same hypothesis** fail, pause, give 2–5 options, wait for the user to pick; do not close the task. Resume the option they pick.
8. **No tool-call spirals** — if a tool call is rejected, do not repeat the same command.
9. **Update documentation** — after the user-facing gate is proven, not after a failed attempt.

10. **Follow the phased workflow** — the native Cline Workflow is `.clinerules/workflows/jsmastery-repair-loop.md`; `docs/CLINE_WORKFLOW.md` is human-readable documentation.
11. **Text-only conversation history** — never read images or screenshots into the chat: one image block makes every later request fail (`messages.content.type is invalid, allowed values: ['text']`) and permanently locks the session. Verify UI with `uiautomator` text dumps; screenshots only as on-disk paths handed to the user (`.clinerules/01-text-only-history.md`).

## Cline Workflow

For bug fixes, regressions, and recovery work, use the native Cline Workflow at `.clinerules/workflows/jsmastery-repair-loop.md`:

**Analyse → Edit → Lint/Syntax → Commit → Build+Emulator → Test → Doc/Hygiene → Commit → Repeat**

Detailed project repair knowledge is packaged as the Cline Skill `.cline/skills/jsmastery-repair/SKILL.md`, which Cline loads when relevant.

With the 3-strike safeguard loop: if 3 consecutive attempts of the same hypothesis fail, pause (do not close the task), provide a detailed resume, offer 2–5 options, wait for the user to pick, update `docs/plan.md` only after they pick, commit the revised plan, and resume the option they picked. A plan commit is not the task.


`docs/CLINE_WORKFLOW.md` documents this process for humans; it is not the Cline-managed Workflow artifact.

## Key Documentation

| Doc                                              | Role                                                     |
| ------------------------------------------------ | -------------------------------------------------------- |
| `.clinerules/00-core-safeguards.md`              | Mandatory always-on Cline safeguards                     |
| `.clinerules/01-text-only-history.md`            | Text-only chat history (prevents fatal session locks)   |
| `.clinerules/workflows/jsmastery-repair-loop.md` | Native Cline repair Workflow                             |
| `.cline/skills/jsmastery-repair/SKILL.md`        | On-demand project repair Skill                           |
| `docs/LESSONS_LEARNED.md`                        | All mistakes made during the project, with direct quotes |
| `docs/CLINE_WORKFLOW.md`                         | Human-readable workflow documentation                    |
| `docs/plan.md`                                   | Execution plan (single source of truth for phases)       |
| `docs/AI_UPSCALING.md`                           | AI/train/inference SSOT (training frozen)                |
| `docs/BUILD.md`                                  | Android build documentation                              |
| `CLAUDE.md`                                      | Points to this file                                      |
