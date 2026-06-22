import React from "react";
import { render } from "@testing-library/react-native";

// Mock expo-router Stack
jest.mock("expo-router", () => {
  const MockStackScreen = ({ name }: { name: string }) => {
    const { View, Text } = require("react-native");
    return (
      <View testID={`stack-screen-${name}`}>
        <Text>{name}</Text>
      </View>
    );
  };

  const MockStack = ({
    children,
    screenOptions,
  }: {
    children: React.ReactNode;
    screenOptions?: object;
  }) => {
    const { View } = require("react-native");
    return (
      <View
        testID="stack-container"
        accessibilityHint={JSON.stringify(screenOptions)}
      >
        {children}
      </View>
    );
  };
  MockStack.Screen = MockStackScreen;

  return { Stack: MockStack };
});

import RootLayout from "@/app/_layout";

describe("RootLayout (app/_layout.tsx)", () => {
  it("renders without crashing", async () => {
    const { toJSON } = await render(<RootLayout />);
    expect(toJSON()).not.toBeNull();
  });

  it("renders a Stack container", async () => {
    const { getByTestId } = await render(<RootLayout />);
    expect(getByTestId("stack-container")).toBeTruthy();
  });

  it("renders the (tabs) Stack.Screen", async () => {
    const { getByTestId } = await render(<RootLayout />);
    expect(getByTestId("stack-screen-(tabs)")).toBeTruthy();
  });

  it("does not render (tabs)/index as a named screen (was changed in PR)", async () => {
    const { queryByTestId } = await render(<RootLayout />);
    expect(queryByTestId("stack-screen-(tabs)/index")).toBeNull();
  });

  it("passes headerShown: false in screenOptions", async () => {
    const { getByTestId } = await render(<RootLayout />);
    const container = getByTestId("stack-container");
    const screenOptions = JSON.parse(
      container.props.accessibilityHint || "{}"
    );
    expect(screenOptions.headerShown).toBe(false);
  });
});