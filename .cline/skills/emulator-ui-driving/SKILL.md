---
name: emulator-ui-driving
description: Drive Android emulator UI via adb. Every UI-affecting adb command is followed by a uiautomator dump read back as text and asserted before the next UI command. Screenshots are saved to disk for the user, never read into the conversation. No app-specific or button-specific instructions.
---

# Skill: Emulator UI Driving (generic)

Use this whenever you drive an Android emulator or device with adb and need to
prove the UI actually changed.

## Text-only history (non-negotiable)

Never read an image into the conversation. One image content block in the task
history makes every later API request fail with
`messages.content.type is invalid, allowed values: ['text']`, and the block
replays on every retry — the session locks permanently (three sessions lost;
see `.clinerules/01-text-only-history.md`). Screenshots exist only as files on
disk whose path you hand to the user.

## The invariant (non-negotiable)

> **Every** adb command that affects the UI is IMMEDIATELY followed by a
> `uiautomator` dump read back as **text**, and the expected state is asserted
> **before** the next UI command.

UI-affecting commands include, at minimum:

- `adb shell input tap`
- `adb shell input swipe`
- `adb shell input text`
- `adb shell input keyevent`
- `adb shell am start` / `am force-stop`
- `adb shell monkey` (launcher)
- orientation / wm size changes

Never chain blind UI commands. Keyboards, dropdowns, scrolls, and modals move
layout, so coordinates go stale. One UI action → one dump → one text
assertion → next action.

A command that only reads state (`uiautomator dump`, `wm size`, `logcat`) does
not need a re-dump. A command that changes the UI does.

## Loop

```
1. Locate the target (uiautomator dump + bounds).
2. Issue ONE UI-affecting adb command.
3. adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml /tmp/ui.xml
4. Read the dump (text) and assert the expected change: node present/gone,
   text= / content-desc= updated, expected activity/window.
5. Only then issue the next UI command.
```

Extra text evidence when the dump is ambiguous: `adb shell dumpsys activity
top`, `adb shell dumpsys window windows`, logcat greps.

Pixel-level proof for the user (optional, never into the chat):
`adb exec-out screencap -p > /tmp/after.png`, confirm the file with
`ls -l` / `file` (text output), and give the user the path.

## Locating targets (never guess a button)

1. `adb shell wm size` — use the live size. Do not assume a resolution.
2. `adb shell uiautomator dump /sdcard/ui.xml`
3. Read the dump. Match `text=` or `content-desc=`. Parse `bounds="[x1,y1][x2,y2]"`. Tap the center: `((x1+x2)/2, (y1+y2)/2)`.
4. Re-dump + text assert.

Never bake a control's x,y into this skill. Never write "tap Add Subscription
at 540,2240" or any other app-specific recipe here.

## Generic techniques

- **Keyboard:** after `input text`, a BACK keyevent is often needed; then
  re-dump (the keyboard covers bottom controls and shifts layout).
- **Dropdowns / autocomplete:** they intercept taps. Resolve or dismiss them,
  re-dump, then tap the real target.
- **Long-press:** `adb shell input swipe X Y X Y 800` (hold ~800ms).
- **Scroll:** `adb shell input swipe X Y1 X Y2 300`.
- **Nav / gesture bar:** the bottom strip of the screen is system UI. A tap
  there usually leaves the app. If a target is under it, scroll first, then
  re-locate.

## Failure handling

- A tap that does nothing, or sends the app HOME, landed in dead space or
  system UI. Re-dump uiautomator. Do **not** repeat the same coordinate.
- After two failed attempts at the same interaction, change strategy
  (scroll, different anchor, re-dump). After three, stop and report.

## Out of scope

This skill does **not** contain app-specific flows (which button to press,
which package to launch, which screen to open). Those belong in the current
task or project plan. This skill only defines the adb → dump → text-verify
loop.
