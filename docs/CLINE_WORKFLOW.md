# Cline Workflow — jsmastery Project

**Last updated:** 2026-08-12  
**Purpose:** Human-readable documentation for the jsmastery repair process.

> **This file is documentation, not the Cline-managed Workflow.**
> The native workspace Workflow discovered by Cline lives at `.clinerules/workflows/jsmastery-repair-loop.md` and is available in **Manage Cline Rules & Workflows**. Invoke that managed workflow when you want Cline to execute this process.

The always-on safeguards live in `.clinerules/00-core-safeguards.md`. Detailed on-demand repair guidance lives in `.cline/skills/jsmastery-repair/SKILL.md`. Historical evidence is recorded in `docs/LESSONS_LEARNED.md`.

---

## Main Loop

The native workflow is authoritative for execution details. Its core phase order is:

Each phase follows this loop until the phase is complete:

```
┌─────────────┐
│  1. Analyse │  ← Read ALL relevant code, git history, prior conversations
└──────┬──────┘
       │
┌──────▼──────┐
│  2. Edit    │  ← Make targeted changes ONLY for this issue
└──────┬──────┘
       │
┌──────▼──────┐
│  3. Lint/   │  ← Check lint + syntax (tsc, eslint)
│  Syntax     │
└──────┬──────┘
       │
┌──────▼──────┐
│  4. Commit  │  ← Git commit before proceeding
└──────┬──────┘
       │
┌──────▼──────┐
│  5. Build   │  ← Build the app
│  + Emulator │  ← Launch on emulator
└──────┬──────┘
       │
┌──────▼──────┐
│  6. Test    │  ← Test on device with 5+ real subscriptions
└──────┬──────┘
       │
┌──────▼──────┐
│  7. Doc/    │  ← Update docs, clean up, hygiene
│  Hygiene    │
└──────┬──────┘
       │
┌──────▼──────┐
│  8. Commit  │  ← Git commit the doc/hygiene changes
└──────┬──────┘
       │
       ▼
  Phase done? ── No ──→ back to step 1
       │
      Yes
       │
       ▼
  Next phase
```

### Step 1: Analyse

- Read ALL relevant source files, git history, and prior conversations.
- Use subagents for broad exploration.
- Identify the root cause, not just symptoms.
- Do NOT start editing until you fully understand the problem.

### Step 2: Edit

- Make targeted changes ONLY for this specific issue.
- Do NOT touch unrelated files.
- If you discover a new issue, note it but do not fix it in this pass.

### Step 3: Lint/Syntax

- Run `npx tsc --noEmit` — must pass with no errors.
- Run `npx eslint .` — must pass with no errors.
- Fix any issues before proceeding.

### Step 4: Commit

- Review `git status` and stage only the files belonging to the current issue.
- Commit the focused change with a descriptive message.
- Commit before building so you can always revert.

### Step 5: Build + Emulator

- Build the app: `npm run build:android:x86_64` (or appropriate arch).
- Launch on emulator.
- Verify the app starts without crashes.

### Step 6: Test

- Test the actual user-facing behavior on the device.
- Test with 5+ real, diverse subscriptions (rare companies, not just Netflix/Spotify).
- Verify icon quality is brand-correct, not random images.
- **Do not claim success without this step.**

### Step 7: Doc/Hygiene

- Update `docs/plan.md` with what was done.
- Update any relevant documentation.
- Clean up temporary files.
- Delete stale docs, don't create new ones alongside them.

### Step 8: Commit

- Review `git status`, stage only the documentation/hygiene changes produced by the current phase, and commit them separately when appropriate.

---

## Phase Gates

After each risky tranche (especially file moves, alias changes, or structural changes), run the full gate:

```bash
npx tsc --noEmit
npm run build:android:x86_64   # install + launch on emu when self-contained
# logcat: Running "main", no RN fatal; crawler may start
```

**Never combine high-risk changes untested.** For example, do not combine alias changes with file moves in the same pass.

---

## 3-Strike Safeguard Loop

If 3 consecutive implementation attempts fail validation for the same root issue, **STOP immediately**. Do not make a fourth speculative fix:

```
┌─────────────────────────────────┐
│ 3 consecutive fix attempts fail │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 1. Interrupt the main loop      │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 2. Provide detailed resume to   │
│    the user (what was tried,     │
│    what failed, why)             │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 3. Git commit current state     │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 4. Brainstorm with the user     │
│    back and forth until settled  │
│    on a new solution             │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 5. Update docs (plan.md) with   │
│    the new approach              │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 6. Git commit the updated plan  │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 7. Resume the main loop with    │
│    the updated plan for that    │
│    part of the issue            │
└─────────────────────────────────┘
```

**What counts as a "failed attempt":**

- The fix doesn't resolve the reported issue on the emulator.
- The fix introduces a new regression.
- The build fails after the fix.
- `tsc` or `eslint` fails after the fix.

**What does NOT count:**

- A fix that works but has a minor lint issue (fix the lint and retry).
- A fix that works but needs a doc update (update the doc and continue).

---

## Phase Board (from docs/plan.md)

| Phase   | Name                                                 | Status           | Gate                          |
| ------- | ---------------------------------------------------- | ---------------- | ----------------------------- |
| **1**   | Registry → map + picker/persist                      | Done             | tsc, x86_64 build, emu launch |
| **2**   | Visual without training (iconQuality + source order) | Done             | same + scorer smoke           |
| **3**   | Crawl reliability                                    | Done             | same                          |
| **4**   | DB split / schema hygiene                            | Done             | same                          |
| **5**   | Sync honesty                                         | Done             | same                          |
| **5.5** | Professional cleanup (artifacts, docs, structure)    | Done             | gate after each tranche       |
| **6**   | Ship polish                                          | Open (after 5.5) | full smoke + doc pass         |

**Frozen (do not reopen casually):**

- Training — see `docs/AI_UPSCALING.md` §2. Entry remains `npm run train:models:force` only when explicitly unfrozen.
- Inference hybrid — `bilin + 0.25 · clamp(residual)` — brand-safe defaults in `iconProcessing.ts`
- TFLite export — Float32 only — never default quant

---

## Standard Gate (every phase / risky tranche)

Use the current commands from `package.json` and `docs/BUILD.md`; do not rely on stale remembered command names. The normal baseline includes:

```bash
npx tsc --noEmit
npm run build:android:x86_64   # install + launch on emu when self-contained
# logcat: Running "main", no RN fatal; crawler may start
```

A successful gate is still not proof of a user-facing fix. The actual reproduction must pass on emulator/device.

---

## Cline customization layers

- **Always-on Rule:** `.clinerules/00-core-safeguards.md` — compact non-negotiable behavior.
- **Managed Workflow:** `.clinerules/workflows/jsmastery-repair-loop.md` — user-invoked phased repair and three-strike recovery process.
- **Project Skill:** `.cline/skills/jsmastery-repair/SKILL.md` — detailed repair knowledge loaded by Cline only when relevant.
- **This document:** human-readable explanation/reference only.
- **Hooks:** deliberately not added in this tranche. The project confirmed that this Cline lineage supports `.clinerules/hooks/`, but did not establish the installed 4.1.6 hook execution/input/exit contract strongly enough to add blocking automation safely. A hook should only be added after that contract is verified; speculative guard automation would itself violate the safeguards.
