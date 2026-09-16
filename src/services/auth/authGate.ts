/**
 * Phase A factor gate — pure routing, no native calls, fully unit-tested.
 *
 * The app never opens without at least one factor; the OS decides which:
 * - `enter-pass`: wrapped blobs exist (pass mode) — only the pass/phrase
 *   can produce the DB key.
 * - `device-prompt`: plaintext key exists and the device HAS a lock — the
 *   OS lock screen decides biometry-vs-PIN/pattern (never forced).
 * - `create-pass`: NO factor exists — the foot-down. Also the migration
 *   path for an existing `plain` install on a lock-free device.
 */
import type { VaultMode } from "./vault";

export type GateRoute =
  | "create-pass"
  | "enter-pass"
  | "device-prompt"
  | "open";

export function resolveGate(mode: VaultMode, deviceSecure: boolean): GateRoute {
  if (mode === "pass") return "enter-pass";
  if (deviceSecure) return "device-prompt";
  return "create-pass";
}
