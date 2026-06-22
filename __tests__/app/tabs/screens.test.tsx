import React from "react";
import { render } from "@testing-library/react-native";

// Mock nativewind styled before component imports
jest.mock("nativewind", () => ({
  styled: (Component: React.ComponentType) => Component,
}));

// Mock expo-router
jest.mock("expo-router", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string | object }) => {
    const { Text } = require("react-native");
    return <Text testID={`link-${typeof href === "string" ? href : JSON.stringify(href)}`}>{children}</Text>;
  },
}));

// Mock global.css import (side-effect only)
jest.mock("@/global.css", () => ({}), { virtual: true });

// Mock react-native-safe-area-context
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return {
    SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) => (
      <View {...props}>{children}</View>
    ),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

import App from "@/app/(tabs)/index";
import Insights from "@/app/(tabs)/insights";
import Settings from "@/app/(tabs)/settings";
import Subscriptions from "@/app/(tabs)/subscriptions";

// ─── App (index) ────────────────────────────────────────────────────────────

describe("App screen (app/(tabs)/index.tsx)", () => {
  it("renders without crashing", async () => {
    const { toJSON } = await render(<App />);
    expect(toJSON()).not.toBeNull();
  });

  it("renders the welcome text", async () => {
    const { getByText } = await render(<App />);
    expect(getByText("Welcome to Nativewind!")).toBeTruthy();
  });

  it("renders the Go to Onboarding link", async () => {
    const { getByText } = await render(<App />);
    expect(getByText("Go to Onboarding")).toBeTruthy();
  });

  it("renders the Go to SignIn link", async () => {
    const { getByText } = await render(<App />);
    expect(getByText("Go to SignIn")).toBeTruthy();
  });

  it("renders the Go to SignUp link", async () => {
    const { getByText } = await render(<App />);
    expect(getByText("Go to SignUp")).toBeTruthy();
  });

  it("renders the Spotify Subscription link", async () => {
    const { getByText } = await render(<App />);
    expect(getByText("Spotify Subscription")).toBeTruthy();
  });

  it("renders the Go to Claude link", async () => {
    const { getByText } = await render(<App />);
    expect(getByText("Go to Claude")).toBeTruthy();
  });
});

// ─── Insights ────────────────────────────────────────────────────────────────

describe("Insights screen (app/(tabs)/insights.tsx)", () => {
  it("renders without crashing", async () => {
    const { toJSON } = await render(<Insights />);
    expect(toJSON()).not.toBeNull();
  });

  it("renders the Insights text", async () => {
    const { getByText } = await render(<Insights />);
    expect(getByText("Insights")).toBeTruthy();
  });
});

// ─── Settings ────────────────────────────────────────────────────────────────

describe("Settings screen (app/(tabs)/settings.tsx)", () => {
  it("renders without crashing", async () => {
    const { toJSON } = await render(<Settings />);
    expect(toJSON()).not.toBeNull();
  });

  it("renders the Settings text", async () => {
    const { getByText } = await render(<Settings />);
    expect(getByText("Settings")).toBeTruthy();
  });
});

// ─── Subscriptions ───────────────────────────────────────────────────────────

describe("Subscriptions screen (app/(tabs)/subscriptions.tsx)", () => {
  it("renders without crashing", async () => {
    const { toJSON } = await render(<Subscriptions />);
    expect(toJSON()).not.toBeNull();
  });

  it("renders the Subscriptions text", async () => {
    const { getByText } = await render(<Subscriptions />);
    expect(getByText("Subscriptions")).toBeTruthy();
  });
});