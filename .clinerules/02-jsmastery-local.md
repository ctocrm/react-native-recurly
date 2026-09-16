# jsmastery local rules

## This machine's known stall class (cline/cline#14065)

`run_commands` calls whose text contains dev-server-like tokens — or
**parallel batched calls** — stall BEFORE execution on this setup; the
call hangs until a human interrupts. Observed live in this workspace
2026-09-11: parallel batching froze the run three times; single
sequential calls passed every time.

- **One command per call, sequential.** Never batch `run_commands`
  calls in parallel.
- **Write scripts via the editor/file tool** and execute them with a
  short, clean single-line command. Never inline heredocs whose bodies
  mention server names (npm run dev, flask run, expo start, uvicorn,
  next dev) — mention-only text is enough to trigger the stall.
- Keep those tokens out of echo/printf arguments and `git commit -m`
  messages.
- Serve-forever commands: always detach with a sentinel
  (`setsid nohup … </dev/null >/tmp/x.log 2>&1 & echo LAUNCHED-<slug>`)
  and poll the artifact. The 300s auto-proceed does not fire here — do
  not rely on it. `systemd-run --user --unit=<name> …` counts as
  detachment too (gate ≥ v2.1) — pair it with a log-file poll
  (`wc -l /tmp/<log>`) rather than streaming.
- **Annotate any capture/stream command before the first attempt**
  (`… # long: capture check, ~30s`). Proven live 2026-09-11 (A1/A2
  experiment, conv pv7z3tr): the identical `systemd-run` logcat capture
  froze pre-execution unannotated and ran immediately with the
  annotation — the gate's cancel never reaches the model, so a
  correct gate hit looks like a dead freeze until a human intervenes.
  Annotate first; never discover this by freezing.
- **If the user says "pre-exec stall"** (in any short message, e.g.
  "resume long pre-exec stall"), that names this class: retry the last
  command with ` # long: <reason> <expected-max>` appended, and never
  sleep >30s, stream, or run a dev-server bare. If the annotated retry
  also freezes, it is the token-content class instead — rewrite without
  dev-server words in echo/heredoc/commit text (script via editor).
- If a call is interrupted ("Tool execution was interrupted"), that is
  the stall class, not your command failing — do not retry the same
  batch; go sequential and split it.

## "Run a baseline" — pinned meaning (user vocabulary, 2026-09-14)

A baseline is a **claims-vs-reality verification pass**. It NEVER
mutates git state: no stash, no reset, no checkout, no clean. In-flight
work stays in the working tree; if it blocks a test, report the
blockage — don't park it. Read-only git (`status --short`,
`log --oneline`) is context only, never the headline.

Procedure, in order (steps 1–2 via `bash scripts/baseline.sh`):
1. `npx tsc --noEmit`
2. `npx jest --silent`
3. Build + emulator walkthrough: re-prove each claimed fix on its real
   user path — the user's last complaint is the acceptance test, not a
   green build.
4. Append `{ claim, verdict, receipt }` rows to
   `docs/baselines/<date>.md` (create if absent).

"Baseline" NEVER means: clean slate, reset, stash, re-clone.

## "drain-inject" — pack keyword (2026-09-16)

drain-inject is a PACK keyword, not project vocabulary: it force-revives
an interrupted session. The hooks inject a revival message explaining
what was in flight — act on that: acknowledge the interruption, verify
state, resume smaller. It NEVER means draining mailboxes, re-scanning,
or injecting subscriptions (wild misresolution 2026-09-16 [5166]: the
agent constructed exactly that meaning and started reconnecting
mailbox legs). If the word arrives alone, it is this keyword.
