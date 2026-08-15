import { components } from "@/constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const GAP = 16;

/**
 * Bottom clearance for Android edge-to-edge (`edgeToEdgeEnabled: true`).
 *
 * The floating tab bar is `position: "absolute"` with
 * `bottom: max(insets.bottom, tabBar.horizontalInset)` and height 72.
 * Lists used `pb-25`, but the theme spacing scale jumps 24 → 30, so that
 * class is a no-op and content sits under the tab pill and the system nav.
 *
 * Sheets sit at the physical bottom and only need the system-nav inset.
 */
export function useBottomClearance() {
  const insets = useSafeAreaInsets();
  const tabBar = components.tabBar;
  const tabLift = Math.max(insets.bottom, tabBar.horizontalInset);

  return {
    navInset: insets.bottom,
    tabListPadding: tabBar.height + tabLift + GAP,
    sheetPadding: tabLift,
  };
}
