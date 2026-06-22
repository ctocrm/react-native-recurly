import React from "react";
import { render } from "@testing-library/react-native";

// jest.mock is hoisted; use jest.fn() inside the factory
jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => {
    const { Text } = require("react-native");
    return <Text testID={`link-${href}`}>{children}</Text>;
  },
}));

import SubscriptionsDetails from "@/app/subscriptions/[id]";

const expoRouterMock = jest.requireMock("expo-router");

describe("SubscriptionsDetails (app/subscriptions/[id].tsx)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders without crashing", async () => {
    expoRouterMock.useLocalSearchParams.mockReturnValue({ id: "spotify" });
    const { toJSON } = await render(<SubscriptionsDetails />);
    expect(toJSON()).not.toBeNull();
  });

  it("renders the subscription details text with the id param", async () => {
    expoRouterMock.useLocalSearchParams.mockReturnValue({ id: "spotify" });
    const { getByText } = await render(<SubscriptionsDetails />);
    expect(getByText("SubscriptionsDetails: spotify")).toBeTruthy();
  });

  it("renders the claude subscription detail when id is claude", async () => {
    expoRouterMock.useLocalSearchParams.mockReturnValue({ id: "claude" });
    const { getByText } = await render(<SubscriptionsDetails />);
    expect(getByText("SubscriptionsDetails: claude")).toBeTruthy();
  });

  it("renders the adobe subscription detail when id is adobe", async () => {
    expoRouterMock.useLocalSearchParams.mockReturnValue({ id: "adobe" });
    const { getByText } = await render(<SubscriptionsDetails />);
    expect(getByText("SubscriptionsDetails: adobe")).toBeTruthy();
  });

  it("renders the Go back link text", async () => {
    expoRouterMock.useLocalSearchParams.mockReturnValue({ id: "github" });
    const { getByText } = await render(<SubscriptionsDetails />);
    expect(getByText("Go back")).toBeTruthy();
  });

  it("renders Go back link with href /", async () => {
    expoRouterMock.useLocalSearchParams.mockReturnValue({ id: "github" });
    const { getByTestId } = await render(<SubscriptionsDetails />);
    expect(getByTestId("link-/")).toBeTruthy();
  });

  it("handles an empty id gracefully", async () => {
    expoRouterMock.useLocalSearchParams.mockReturnValue({ id: "" });
    const { getByText } = await render(<SubscriptionsDetails />);
    expect(getByText("SubscriptionsDetails: ")).toBeTruthy();
  });

  it("displays the id in the text regardless of value", async () => {
    const ids = ["figma", "notion", "openai", "dropbox"];
    for (const id of ids) {
      expoRouterMock.useLocalSearchParams.mockReturnValue({ id });
      const { getByText, unmount } = await render(<SubscriptionsDetails />);
      expect(getByText(`SubscriptionsDetails: ${id}`)).toBeTruthy();
      await unmount();
    }
  });
});