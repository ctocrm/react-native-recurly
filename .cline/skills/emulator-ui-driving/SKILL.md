---
name: emulator-ui-driving
description: Drive Android emulator UI via adb. Every UI-affecting adb command is followed by a screenshot then vision assert before the next UI command. No app-specific or button-specific instructions.
---

# Skill: Emulator UI Driving (generic)

Use this whenever you drive an Android emulator or device with adb and need to
prove the UI actually changed.

## The invariant (non-negotiable)

> **Every** adb command that affects the UI is IMMEDIATELY followed by a
> screenshot, the screenshot is read back, and the expected state is asserted
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
layout, so coordinates go stale. One UI action → one screenshot → one
assertion → next action.

A command that only reads state (`uiautomator dump`, `wm size`, `logcat`) does
not need a screenshot. A command that changes pixels does.

## Loop

```
1. Locate the target (uiautomator dump + bounds, or a prior screenshot).
2. Issue ONE UI-affecting adb command.
3. adb exec-out screencap -p > /tmp/after.png
4. Read the screenshot and assert the expected change.
5. Only then issue the next UI command.
```

## Locating targets (never guess a button)

1. `adb shell wm size` — use the live size. Do not assume a resolution.
2. `adb shell uiautomator dump /sdcard/ui.xml`
3. Read the dump. Match `text=` or `content-desc=`. Parse `bounds="[x1,y1][x2,y2]"`. Tap the center: `((x1+x2)/2, (y1+y2)/2)`.
4. Screenshot + vision-assert.

Never bake a control's x,y into this skill. Never write "tap Add Subscription
at 540,2240" or any other app-specific recipe here.

## Generic techniques

- **Keyboard:** after `input text`, a BACK keyevent is often needed; then
  screenshot (the keyboard covers bottom controls and shifts layout).
- **Dropdowns / autocomplete:** they intercept taps. Resolve or dismiss them,
  screenshot, then tap the real target.
- **Long-press:** `adb shell input swipe X Y X Y 800` (hold ~800ms).
- **Scroll:** `adb shell input swipe X Y1 X Y2 300`.
- **Nav / gesture bar:** the bottom strip of the screen is system UI. A tap
  there usually leaves the app. If a target is under it, scroll first, then
  re-locate.

## Failure handling

- A tap that does nothing, or sends the app HOME, landed in dead space or
  system UI. Re-dump uiautomator and re-screenshot. Do **not** repeat the
  same coordinate.
- After two failed attempts at the same interaction, change strategy
  (scroll, different anchor, re-dump). After three, stop and report.

## Out of scope

This skill does **not** contain app-specific flows (which button to press,
which package to launch, which screen to open). Those belong in the current
task or project plan. This skill only defines the adb → screenshot → verify
loop.
