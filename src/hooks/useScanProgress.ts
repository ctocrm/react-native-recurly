import { useSyncExternalStore } from "react";
import {
  getScanProgress,
  subscribeScanProgress,
  type ScanProgress,
} from "@/services/emailscan/scanProgress";

/**
 * Phase I (J3/I1): read the live scan progress from React. Backed by an
 * external store so the indicator survives navigation — the scan outlives
 * any single screen.
 */
export function useScanProgress(): ScanProgress {
  return useSyncExternalStore(
    subscribeScanProgress,
    getScanProgress,
    getScanProgress,
  );
}
