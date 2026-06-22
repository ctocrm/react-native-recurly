import { tabs } from "@/constants/data";
import { icons } from "@/constants/icons";

describe("tabs data", () => {
  it("exports a tabs array", () => {
    expect(Array.isArray(tabs)).toBe(true);
  });

  it("has exactly 4 tabs", () => {
    expect(tabs).toHaveLength(4);
  });

  it("each tab has name, title, and icon properties", () => {
    tabs.forEach((tab) => {
      expect(tab).toHaveProperty("name");
      expect(tab).toHaveProperty("title");
      expect(tab).toHaveProperty("icon");
      expect(typeof tab.name).toBe("string");
      expect(typeof tab.title).toBe("string");
      expect(tab.icon).toBeDefined();
    });
  });

  it("contains Home tab with correct configuration", () => {
    const homeTab = tabs.find((tab) => tab.name === "index");
    expect(homeTab).toBeDefined();
    expect(homeTab!.title).toBe("Home");
    expect(homeTab!.icon).toBe(icons.home);
  });

  it("contains Subscriptions tab with correct configuration", () => {
    const subTab = tabs.find((tab) => tab.name === "subscriptions");
    expect(subTab).toBeDefined();
    expect(subTab!.title).toBe("Subscriptions");
    expect(subTab!.icon).toBe(icons.wallet);
  });

  it("contains Insights tab with correct configuration", () => {
    const insightsTab = tabs.find((tab) => tab.name === "insights");
    expect(insightsTab).toBeDefined();
    expect(insightsTab!.title).toBe("Insights");
    expect(insightsTab!.icon).toBe(icons.activity);
  });

  it("contains Settings tab with correct configuration", () => {
    const settingsTab = tabs.find((tab) => tab.name === "settings");
    expect(settingsTab).toBeDefined();
    expect(settingsTab!.title).toBe("Settings");
    expect(settingsTab!.icon).toBe(icons.setting);
  });

  it("tab order is: index, subscriptions, insights, settings", () => {
    expect(tabs[0].name).toBe("index");
    expect(tabs[1].name).toBe("subscriptions");
    expect(tabs[2].name).toBe("insights");
    expect(tabs[3].name).toBe("settings");
  });

  it("all tab names are unique", () => {
    const names = tabs.map((tab) => tab.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(tabs.length);
  });

  it("all tab titles are unique", () => {
    const titles = tabs.map((tab) => tab.title);
    const uniqueTitles = new Set(titles);
    expect(uniqueTitles.size).toBe(tabs.length);
  });

  it("tab icons reference distinct icon assets", () => {
    const iconValues = tabs.map((tab) => tab.icon);
    const uniqueIcons = new Set(iconValues);
    expect(uniqueIcons.size).toBe(tabs.length);
  });
});