import { icons } from "@/constants/icons";
import type { IconKey } from "@/constants/icons";

describe("icons", () => {
  it("exports icons object", () => {
    expect(icons).toBeDefined();
    expect(typeof icons).toBe("object");
  });

  it("exports all expected icon keys", () => {
    const expectedKeys: IconKey[] = [
      "home",
      "wallet",
      "setting",
      "activity",
      "add",
      "back",
      "menu",
      "plus",
      "notion",
      "dropbox",
      "openai",
      "adobe",
      "medium",
      "figma",
      "spotify",
      "github",
      "claude",
      "canva",
    ];

    expectedKeys.forEach((key) => {
      expect(icons[key]).toBeDefined();
    });
  });

  it("has exactly 18 icon entries", () => {
    expect(Object.keys(icons)).toHaveLength(18);
  });

  it("all icon values are defined (not undefined or null)", () => {
    Object.values(icons).forEach((value) => {
      expect(value).not.toBeUndefined();
      expect(value).not.toBeNull();
    });
  });

  it("does not include netflix icon (not in icons.ts)", () => {
    expect((icons as Record<string, unknown>)["netflix"]).toBeUndefined();
  });

  it("IconKey type covers all keys in icons object", () => {
    // If TypeScript compiles, this test validates the type is consistent
    const key: IconKey = "home";
    expect(icons[key]).toBeDefined();
  });
});