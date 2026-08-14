# Skill: Emulator UI Driving (adb + screenshot + vision)

Drive the running Android emulator's UI reliably with `adb`, verifying EVERY
interaction with a screenshot read back via vision. This skill exists because
blind coordinate taps on this project's Expo/RN app repeatedly missed targets,
sent the app to the launcher, or hit the software nav bar.

## When to use

- Any task requiring real-UI verification on the emulator (add subscription,
  open the icon picker via long-press, select an icon, submit a form).
- Whenever you need on-device logs from a user-facing flow (crawler, picker).

## Hard rules (violating these caused every past failure)

1. **Screenshot after EVERY UI-mutating adb command, and read it with vision
   before the next command.** Never chain more than one blind tap. The layout
   shifts (keyboard, autocomplete dropdown, scroll), so prior coordinates go
   stale immediately.
2. **Prefer `uiautomator dump` for exact target bounds; never guess coordinates
   from a screenshot by eye.** Parse `bounds="[x1,y1][x2,y2]"` and tap the center:
   `cx=(x1+x2)/2, cy=(y1+y2)/2`.
3. **The software nav bar occupies the bottom ~y>2320 (of 2400).** Tapping there
   sends the app HOME (launcher). Keep taps above ~2300, or scroll content up so
   the target sits in the safe area.
4. **Focusing a text input raises the keyboard, which covers bottom buttons and
   shifts layout.** After typing, send `KEYCODE_BACK` to dismiss the keyboard,
   screenshot, THEN locate/tap the submit button.
5. **Autocomplete dropdowns intercept taps.** If a suggestion list is open over
   the form, tap the suggestion (to select+close) or dismiss it before tapping
   other controls.
6. **A tap that "does nothing" usually landed in dead space or on the nav bar.**
   Re-dump `uiautomator` and re-screenshot; do not repeat the same coordinate.
7. **Verify the outcome, not the tap.** After a submit tap, screenshot AND check
   the expected state change (modal closed, card appears, log line emitted).

## Coordinate space

- `adb shell wm size` = `1080x2400`; screenshots are `1080x2400`; `uiautomator`
  bounds and `input tap` share this space. They agree for mid-screen elements.
- Bottom-sheet buttons near the nav bar are the exception: their reported bounds
  can extend under the nav bar, so only the upper slice is tappable. Scroll up.

## Recipes

### Launch app fresh

```
adb shell am force-stop com.ctocrm.jsmastery
adb logcat -c
adb shell monkey -p com.ctocrm.jsmastery -c android.intent.category.LAUNCHER 1
sleep 8   # RN boot
```

### Screenshot + read

```
adb exec-out screencap -p > /tmp/s.png   # then read_file /tmp/s.png
```

### Dump UI + get a target's center

```
adb shell uiautomator dump /sdcard/ui.xml
adb shell cat /sdcard/ui.xml | grep -oE 'content-desc="TARGET"[^>]*bounds="\[[0-9,]+\]\[[0-9,]+\]"'
# compute center and: adb shell input tap CX CY
```

### Type into a field (tap field first, then text, then dismiss keyboard)

```
adb shell input tap FX FY          # focus field (from uiautomator)
adb shell input text "Netflix"
adb shell input keyevent KEYCODE_BACK   # dismiss keyboard
```

### Long-press a subscription card icon (opens the icon picker)

```
# card icon is on the left of the card; hold ~800ms:
adb shell input swipe IX IY IX IY 800
```

### Capture crawler/picker logs

```
adb logcat -d -s ReactNativeJS > /tmp/crawl.log
grep -E "TIER 0|Ranked official|rejected|FETCH|PICKER|COLLECTION" /tmp/crawl.log
```

## Known gotchas in this app

- CreateSubscriptionModal: Name field autocomplete shows a suggestion row that
  overlaps the Price field; selecting it focuses Price (numeric keyboard).
- The Create button sits at the sheet bottom, partially under the nav bar;
  scroll the sheet up before tapping it.
- DDG web search is CAPTCHA/bot-blocked in this environment, so TIER 0 official
  discovery often sees 0 links and falls back to deterministic guesses (expected).
