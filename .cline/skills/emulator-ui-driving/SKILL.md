---
name: emulator-ui-driving
description: Drive the jsmastery Android emulator UI reliably via adb (input tap/swipe/text/keyevent, am start/force-stop, uiautomator dumps). Generic invariant: EVERY adb command that affects the UI must be followed by a screenshot read back via vision and asserted before the next UI command. Use for any real-UI verification or on-device log capture.
---

# Skill: Emulator UI Driving (generic adb + screenshot + vision)

## The invariant (non-negotiable)

> **Every** adb command that affects the UI (`input tap/swipe/text/keyevent`,
> `am start/force-stop`, orientation change, etc.) is IMMEDIATELY followed by
> `adb exec-out screencap -p > /tmp/x.png`, read back via vision, and the
> expected state is asserted **before** issuing the next UI command.

Never chain blind UI commands. Layout shifts (keyboard, dropdowns, scroll,
modals), so coordinates go stale between commands. One UI action → one
screenshot → one assertion → next action.

## Coordinate space facts (re-read, do not hardcode a button)

- Always re-read `adb shell wm size`. On the current Pixel-class AVD this is
  typically `1080x2400`; screenshots, `uiautomator` bounds, and `input tap`
  share that space. If `wm size` differs, use the live size.
- The software nav bar occupies the bottom strip (on 1080x2400, ~y>2320).
  Tapping there sends the app HOME. Keep taps above the nav, or scroll the
  target fully on-screen first.
- Never bake a control's x,y into this skill. Locate via uiautomator each time.

## Locating targets (never guess by eye)

1. `adb shell uiautomator dump /sdcard/ui.xml`
2. `adb shell cat /sdcard/ui.xml | grep -oE 'content-desc="TARGET"[^>]*bounds="\[[0-9,]+\]\[[0-9,]+\]"'`
   (or `text="TARGET"`).
3. Parse `bounds="[x1,y1][x2,y2]"`; center = `((x1+x2)/2,(y1+y2)/2)`; tap center.
4. Screenshot + vision-assert the result.

## Common techniques (generic)

- **Dismiss keyboard** after typing: `adb shell input keyevent KEYCODE_BACK`,
  then screenshot (keyboard covers bottom buttons and shifts layout).
- **Dismiss/resolve autocomplete dropdowns** before tapping other controls
  (they intercept taps).
- **Long-press** = `adb shell input swipe X Y X Y 800` (hold ~800ms).
- **Type** = `adb shell input text "..."` (tap the field first to focus).
- **Scroll** a list/sheet = `adb shell input swipe X Y1 X Y2 300`.

## Recipes

### Launch fresh + capture logs

```
adb shell am force-stop <pkg>
adb exec-out screencap -p > /tmp/stopped.png   # assert app is gone
adb logcat -c
adb shell monkey -p <pkg> -c android.intent.category.LAUNCHER 1
sleep 8                      # RN boot
adb exec-out screencap -p > /tmp/launched.png  # assert running UI
adb logcat -d -s ReactNativeJS > /tmp/log.txt
```

### Screenshot + read

```
adb exec-out screencap -p > /tmp/s.png   # then read_file /tmp/s.png
```

### Tap a located target

```
adb shell input tap CX CY
adb exec-out screencap -p > /tmp/after.png   # then read + assert
```

## Failure handling

- A tap that "does nothing" or goes HOME landed in dead space / nav bar.
  Re-dump uiautomator and re-screenshot; do NOT repeat the same coordinate.
- If a target is under the nav bar, scroll the sheet/list up first, then
  re-locate and tap.
- After two failed attempts at the same interaction, change strategy
  (different anchor, scroll, or uiautomator re-dump) rather than retrying.
