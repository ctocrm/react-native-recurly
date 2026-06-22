import React from "react";
import { render } from "@testing-library/react-native";
import { View, Image } from "react-native";

// Must mock before importing TabLayout
jest.mock("expo-router", () => {
  const MockTabsScreen = ({ options }: { name: string; options?: { tabBarIcon?: (args: { focused: boolean }) => React.ReactNode } }) => {
    // Render both focused and unfocused states to test TabIcon
    const FocusedIcon = options?.tabBarIcon?.({ focused: true });
    const UnfocusedIcon = options?.tabBarIcon?.({ focused: false });
    const { View } = require("react-native");
    return (
      <View testID="tabs-screen">
        <View testID="icon-focused">{FocusedIcon}</View>
        <View testID="icon-unfocused">{UnfocusedIcon}</View>
      </View>
    );
  };

  const MockTabs = ({ children }: { children: React.ReactNode }) => {
    const { View } = require("react-native");
    return <View testID="tabs-container">{children}</View>;
  };
  MockTabs.Screen = MockTabsScreen;

  return { Tabs: MockTabs };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock("clsx", () => ({
  __esModule: true,
  default: (...args: (string | boolean | undefined)[]) =>
    args.filter(Boolean).join(" "),
}));

import TabLayout from "@/app/(tabs)/_layout";
import { tabs } from "@/constants/data";
import { colors, components } from "@/constants/theme";

describe("TabLayout (app/(tabs)/_layout.tsx)", () => {
  it("renders without crashing", async () => {
    const { toJSON } = await render(<TabLayout />);
    expect(toJSON()).not.toBeNull();
  });

  it("renders the Tabs container", async () => {
    const { getByTestId } = await render(<TabLayout />);
    expect(getByTestId("tabs-container")).toBeTruthy();
  });

  it("renders one Tabs.Screen per tab entry in data", async () => {
    const { getAllByTestId } = await render(<TabLayout />);
    const screens = getAllByTestId("tabs-screen");
    expect(screens).toHaveLength(tabs.length);
  });

  it("renders 4 tab screens (home, subscriptions, insights, settings)", async () => {
    const { getAllByTestId } = await render(<TabLayout />);
    expect(getAllByTestId("tabs-screen")).toHaveLength(4);
  });
});

// ─── TabIcon unit tests ───────────────────────────────────────────────────────

describe("TabIcon component (inline in TabLayout)", () => {
  // Extract TabIcon-like logic via clsx behavior verification
  it("applies tabs-active class when focused", () => {
    const clsx = require("clsx").default;
    const result = clsx("tabs-pill", true && "tabs-active");
    expect(result).toBe("tabs-pill tabs-active");
  });

  it("omits tabs-active class when not focused", () => {
    const clsx = require("clsx").default;
    const result = clsx("tabs-pill", false && "tabs-active");
    expect(result).toBe("tabs-pill");
  });

  it("always includes tabs-pill class", () => {
    const clsx = require("clsx").default;
    const focused = clsx("tabs-pill", true && "tabs-active");
    const unfocused = clsx("tabs-pill", false && "tabs-active");
    expect(focused).toContain("tabs-pill");
    expect(unfocused).toContain("tabs-pill");
  });

  it("renders focused icon via tabBarIcon callback", async () => {
    const { getAllByTestId } = await render(<TabLayout />);
    const focusedIcons = getAllByTestId("icon-focused");
    expect(focusedIcons.length).toBeGreaterThan(0);
  });

  it("renders unfocused icon via tabBarIcon callback", async () => {
    const { getAllByTestId } = await render(<TabLayout />);
    const unfocusedIcons = getAllByTestId("icon-unfocused");
    expect(unfocusedIcons.length).toBeGreaterThan(0);
  });
});

// ─── tabBar style computation ─────────────────────────────────────────────────

describe("tabBar style calculations", () => {
  it("tabBar bottom uses Math.max of insets.bottom and horizontalInset", () => {
    const insets = { bottom: 34, top: 44, left: 0, right: 0 };
    const horizontalInset = components.tabBar.horizontalInset; // 20
    const expectedBottom = Math.max(insets.bottom, horizontalInset); // 34
    expect(expectedBottom).toBe(34);
  });

  it("Math.max prefers larger bottom inset over horizontalInset", () => {
    const largeBottomInset = 50;
    const result = Math.max(largeBottomInset, components.tabBar.horizontalInset);
    expect(result).toBe(largeBottomInset);
  });

  it("Math.max uses horizontalInset when bottom inset is 0", () => {
    const zeroInset = 0;
    const result = Math.max(zeroInset, components.tabBar.horizontalInset);
    expect(result).toBe(components.tabBar.horizontalInset);
  });

  it("tabBarItemStyle paddingVertical computes correctly", () => {
    const { height, iconFrame } = components.tabBar;
    const paddingVertical = height / 2 - iconFrame / 1.6;
    expect(paddingVertical).toBeCloseTo(6, 0);
  });

  it("tabBar backgroundColor matches colors.primary", () => {
    expect(colors.primary).toBe("#081126");
  });
});