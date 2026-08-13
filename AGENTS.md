# AGENTS.md — jsmastery Project

## Expo HAS CHANGED

Read the exact versioned docs at <https://docs.expo.dev/versions/v54.0.0/> before writing any code.

## Cline Rules

This project enforces strict Cline rules in `.clinerules`. These rules are **mandatory** on every task and exist to prevent the mistakes documented in `docs/LESSONS_LEARNED.md`. Key rules:

1. **Read everything before acting** — never edit code before reading all relevant source files, git history, and prior conversations.
2. **No claims without verification** — never claim a fix is complete without building and testing on the emulator.
3. **One issue at a time** — do not touch unrelated files when fixing one issue.
4. **Test with 20+ real, diverse subscriptions** — verify icon quality is brand-correct.
5. **Commit before risky changes** — git commit first, then edit.
6. **No model training without wiring verification** — training is frozen per `docs/plan.md`.
7. **3-strike safeguard** — if 3 consecutive fix attempts fail, stop and escalate to the user.
8. **No tool-call spirals** — if a tool call is rejected, do not repeat the same command.
9. **Update documentation** — after every fix, update the relevant documentation.
10. **Follow the phased workflow** — see `docs/CLINE_WORKFLOW.md`.

## Cline Workflow

Follow the phased workflow in `docs/CLINE_WORKFLOW.md`:

**Analyse → Edit → Lint/Syntax → Commit → Build+Emulator → Test → Doc/Hygiene → Commit → Repeat**

With the 3-strike safeguard loop: if 3 consecutive fix attempts fail, interrupt, provide a detailed resume to the user, git commit, brainstorm a new solution, update docs, and resume.

## Key Documentation

| Doc                       | Role                                                     |
| ------------------------- | -------------------------------------------------------- |
| `.clinerules`             | Mandatory Cline rules (enforced on every task)           |
| `docs/LESSONS_LEARNED.md` | All mistakes made during the project, with direct quotes |
| `docs/CLINE_WORKFLOW.md`  | The phased workflow with safeguards                      |
| `docs/plan.md`            | Execution plan (single source of truth for phases)       |
| `docs/AI_UPSCALING.md`    | AI/train/inference SSOT (training frozen)                |
| `docs/BUILD.md`           | Android build documentation                              |
| `CLAUDE.md`               | Points to this file                                      |
