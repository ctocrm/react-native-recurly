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
 * `pagePadding` reserves the overlay itself so tab pages stop above the
 * pill instead of drawing under it while scrolling. List padding then only
 * needs a small gap. Sheets sit at the physical bottom and only need the
 * system-nav inset.
 */
export function useBottomClearance() {
  const insets = useSafeAreaInsets();
  const tabBar = components.tabBar;
  const tabLift = Math.max(insets.bottom, tabBar.horizontalInset);
  // SafeAreaView on tab pages omits the bottom edge so this is the only
  // bottom reserve: system nav + pill lift + pill height.
  const pagePadding = tabBar.height + tabLift;

  return {
    navInset: insets.bottom,
    overlayHeight: pagePadding,
    pagePadding,
    tabListPadding: GAP,
    sheetPadding: tabLift,
  };
}
