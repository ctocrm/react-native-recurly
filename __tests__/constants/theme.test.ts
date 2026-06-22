import { colors, components, spacing, theme } from "@/constants/theme";

describe("colors", () => {
  it("exports all required color tokens", () => {
    expect(colors.background).toBeDefined();
    expect(colors.foreground).toBeDefined();
    expect(colors.card).toBeDefined();
    expect(colors.muted).toBeDefined();
    expect(colors.mutedForeground).toBeDefined();
    expect(colors.primary).toBeDefined();
    expect(colors.accent).toBeDefined();
    expect(colors.border).toBeDefined();
    expect(colors.success).toBeDefined();
    expect(colors.destructive).toBeDefined();
    expect(colors.subscription).toBeDefined();
  });

  it("has correct hex values for key colors", () => {
    expect(colors.background).toBe("#fff9e3");
    expect(colors.foreground).toBe("#081126");
    expect(colors.primary).toBe("#081126");
    expect(colors.accent).toBe("#ea7a53");
    expect(colors.success).toBe("#16a34a");
    expect(colors.destructive).toBe("#dc2626");
    expect(colors.subscription).toBe("#8fd1bd");
    expect(colors.card).toBe("#fff8e7");
    expect(colors.muted).toBe("#f6eecf");
  });

  it("has correct rgba value for mutedForeground", () => {
    expect(colors.mutedForeground).toBe("rgba(0, 0, 0, 0.6)");
  });

  it("has correct rgba value for border", () => {
    expect(colors.border).toBe("rgba(0, 0, 0, 0.1)");
  });

  it("foreground and primary share the same dark color", () => {
    expect(colors.foreground).toBe(colors.primary);
  });
});

describe("spacing", () => {
  it("exports spacing scale with all required keys", () => {
    const expectedKeys = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 30];
    expectedKeys.forEach((key) => {
      expect(spacing[key as keyof typeof spacing]).toBeDefined();
    });
  });

  it("spacing[0] is 0", () => {
    expect(spacing[0]).toBe(0);
  });

  it("spacing values are multiples of 4", () => {
    Object.values(spacing).forEach((value) => {
      expect(value % 4).toBe(0);
    });
  });

  it("spacing scale increases correctly", () => {
    expect(spacing[1]).toBe(4);
    expect(spacing[2]).toBe(8);
    expect(spacing[4]).toBe(16);
    expect(spacing[5]).toBe(20);
    expect(spacing[8]).toBe(32);
    expect(spacing[12]).toBe(48);
    expect(spacing[18]).toBe(72);
    expect(spacing[30]).toBe(120);
  });

  it("spacing values are strictly positive for non-zero keys", () => {
    Object.entries(spacing).forEach(([key, value]) => {
      if (Number(key) > 0) {
        expect(value).toBeGreaterThan(0);
      }
    });
  });
});

describe("components.tabBar", () => {
  it("exports tabBar with all required properties", () => {
    expect(components.tabBar.height).toBeDefined();
    expect(components.tabBar.horizontalInset).toBeDefined();
    expect(components.tabBar.radius).toBeDefined();
    expect(components.tabBar.iconFrame).toBeDefined();
    expect(components.tabBar.itemPaddingVertical).toBeDefined();
  });

  it("tabBar.height equals spacing[18] (72)", () => {
    expect(components.tabBar.height).toBe(spacing[18]);
    expect(components.tabBar.height).toBe(72);
  });

  it("tabBar.horizontalInset equals spacing[5] (20)", () => {
    expect(components.tabBar.horizontalInset).toBe(spacing[5]);
    expect(components.tabBar.horizontalInset).toBe(20);
  });

  it("tabBar.radius equals spacing[8] (32)", () => {
    expect(components.tabBar.radius).toBe(spacing[8]);
    expect(components.tabBar.radius).toBe(32);
  });

  it("tabBar.iconFrame equals spacing[12] (48)", () => {
    expect(components.tabBar.iconFrame).toBe(spacing[12]);
    expect(components.tabBar.iconFrame).toBe(48);
  });

  it("tabBar.itemPaddingVertical equals spacing[2] (8)", () => {
    expect(components.tabBar.itemPaddingVertical).toBe(spacing[2]);
    expect(components.tabBar.itemPaddingVertical).toBe(8);
  });
});

describe("theme", () => {
  it("re-exports colors, spacing, and components", () => {
    expect(theme.colors).toBe(colors);
    expect(theme.spacing).toBe(spacing);
    expect(theme.components).toBe(components);
  });

  it("is a single unified object", () => {
    expect(typeof theme).toBe("object");
    expect(Object.keys(theme)).toEqual(["colors", "spacing", "components"]);
  });
});