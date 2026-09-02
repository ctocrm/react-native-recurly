# Text-Only Conversation History — jsmastery

The model API serving this project accepts **text content blocks only**. One image/binary block in the task history makes **every** subsequent request fail with:

    messages.content.type is invalid, allowed values: ['text']

The poisoned block replays on every retry, so the task locks permanently — there is no in-task recovery. Three sessions have been lost this way (most recent 2026-09-02; see `docs/LESSONS_LEARNED.md` §3.10).

## Never put image content into the conversation

- Never read image files (`png jpg jpeg webp gif bmp ico svg`) with a file-read tool, even when the tool says it supports images. Read text only. Describe images via text metadata (`ls -l`, `file`, ImageMagick `identify`).
- Never embed base64 image data in a message or tool result.
- Never call a screenshot/vision tool whose result becomes an image block in this chat.

## Emulator verification is text-first (replaces the old "screenshot + vision assert")

- After each UI-affecting adb command: `adb shell uiautomator dump /sdcard/ui.xml` + `adb pull`, read the XML, assert on `text=` / `content-desc=` / node present-gone / expected activity. One UI action → one dump → one text assert → next action.
- Extra text evidence: `dumpsys activity top`, `dumpsys window`, logcat greps, RN console lines.
- When human eyes are genuinely required: `adb exec-out screencap -p > /tmp/x.png`, verify the artifact with `ls -l` / `file` (text output), and give the user the **path**. The image itself never enters the conversation.
- Anywhere `docs/plan.md`, `docs/CODEBASE.md`, or a skill still says "read screenshot + vision assert", this rule replaces it with the dump + text assert above.

## If the error appears anyway

1. Treat `messages.content.type is invalid, allowed values: ['text']` as history poisoning, not a transient API error. Retrying cannot fix it.
2. Stop the task immediately. Do not re-send anything and do not "test" with another request.
3. Write a short text summary of state (what is done, the next hop) and tell the user to start a new task (or restore a checkpoint from before the image read).
4. In the new task, use the text-only loop; never reload the same image.
