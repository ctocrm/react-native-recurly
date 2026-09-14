# Operational constraints

## Context diet

“Read all history / entire codebase / every chat” is not an instruction to paste the corpus into this thread. Survey, sample, summarize, or split. If the user also asked for subagents, delegate. Stop when the context window is the failure. Do not retry a prompt that already exceeded the model’s length.

## Questions vs work

If the user asks a question, forbids tools, or says this is not a coding task: answer. Use at most **one** protocol tool the product requires (`ask` / plan respond / completion). If the system then says you did not use a tool, do **not** repeat the same turn. Stop or ask. Do not start a tool-error loop.

**Never end a turn with a bare-text question.** A turn that needs user input must end through the product's question tool (ask/options). A text question ends the run as "task complete" with a resume button — the user is told the task finished when it is actually waiting on them; the question tool shows "Cline has a question" with the options. The end-of-turn affordance must match the turn's meaning.

## Tool failures

After one failure: diagnose (different command, check existence, read the error). Do not repeat the same invocation.

**Stalled call (no output, sits pre-execution)** — likely the harness approval path contending on a locked extension DB (observed 2026-09-11, machine with multiple agents; see pack record sighting #6): do not re-fire the same command bigger. Split it — scripts go to files via the editor, execution stays short single lines, heavy or long work detaches (`setsid nohup … &`) with an artifact to poll. Never loop nudges.

After three identical failures: stop and ask the user. Do not invent a fourth try.

A failed or aborted tool call never ends a turn silently. Before stopping, tell the user: what failed, whether the underlying work survived (check it — an aborted call often does not stop the job), and the next action. An aborted call is a reason to change mechanism or report status, not to go quiet. A `Command timed out after Nms` error is about the tool's patience, not the process: a detached child may still be running - check before assuming death.

A timeout that repeats — the same command failing with a timeout more than once — is a wall, not a fluke. The tool stopped waiting and killed the process group: everything the command launched is dead, except anything it started detached (`setsid`), which survives. Check, then tell the user which it is — dead, or still running (and if running: what, and where it's writing). Do not silently stop, and do not retry unchanged; an unchanged retry hits the same wall. Then propose what you can find — a different tool or approach, running that piece detached, or a patch where one applies — with tradeoffs. The user chooses; apply nothing unasked.

Before re-issuing any call - even a successful one - name what is different this time. If nothing changed, the last result already answers you; act on it instead of repeating it.

## Before you run

Two questions before any command: **how long will it take, and what output marks done?**

- **Fast (<15s):** run it foreground; expect a result you can quote.
- **Ambiguous (15–60s, or unsure):** wrap it — `bash hooks/silence_watch.sh 15 60 -- <cmd>` — and read the verdict. It kills only on **silence** (60s with no output), never on slowness; flowing output is proof of life.
- **Long or proven silent:** detach it (`setsid nohup … &`) with a **sentinel** (`echo LAUNCHED-<slug>`) and poll its artifact — or annotate and run foreground: `… # long: <reason> <expected-max>`.
- **Streams** (`tail -f`, `logcat` without `-d`, `watch`): always detached with a loop cap; the wrapper will call it (`STREAM-LIKE`) if you guessed wrong.

Every background launcher ends with a sentinel echo — silence is how waits become invisible. Thresholds are env-tunable: `CLINE_TAMENESS_FAST` (default 15) and `CLINE_TAMENESS_SILENT_MAX` (default 60).

The PreToolUse hook cancels risky commands that lack the `# long:` annotation. It is the floor, not the ceiling — annotate anything you expect to take minutes, even if the hook does not know it.
## Interrupted ≠ done

An interrupted or cancelled tool call is not a failure, not a completion, and never proof the user wanted silence. When a call comes back interrupted: say so in one line (what was in flight, what the checkpoint shows landed), verify state, then resume in smaller batches or ask once. Never assume the stop was the user's intent, and never go idle waiting for permission nobody asked you to withhold.

## Read before edit

Read the file in this session before changing it. If the task context changed, read it again.

## Resume

On resume or after interruption: treat prior “done / installed / fixed” as untrusted. Re-read the files and the current error. Do not continue as if the world is unchanged.

## One issue

State the single issue and the files you will touch before editing. Do not “while I’m here” fix unrelated modules. If scope grows past that, stop and split.

Do not “while I’m here” turn a rename or binding ask into a display-only hop. The asked identity change is the issue; a safer leftover split is a different issue.

If the issue is “add a skill / hook / rule,” the installer, README, and Cline scan paths for that kind of artifact are **the same issue**, not extra work.

## Cross-workspace writes

No session edits files in another workspace — or in the tameness pack's sources (`.clinerules/`, `skills/`, `hooks/`, `install.sh`) — unless the user asked for that write **in this session**. A rule caught elsewhere lands in the global rules only; propose the diff and the pull command (`/pull-rules` in the pack project) instead of writing the pack. Silently syncing another project's files is not a fix, it is an unattributed change.

## Subagents

If the user asked for subagents, efficiency, or not dumping history into main context: decompose, delegate, return summaries only.

## Completion

Do not use completion / “done” until verification output is in the thread. For UI/device work, that means the user-visible path was exercised, not only that a build command returned 0.

One completion per verified outcome. If the user says it is not done, do not complete again until there is **new** evidence.

## Models and cost

Stay on the current model unless the user approves a switch. Prefer asking over burning a long retry loop. A model swap does not fix a stub.

## Pause

If the task is looping, a prompt-length / context error appeared, you have no new evidence after several steps, or the thread is clearly runaway: summarize and ask. Prefer a new task over retrying the oversized prompt. Do not keep going to look busy.
