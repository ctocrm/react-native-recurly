import { resolveGate } from "../authGate";

describe("auth/authGate (factor routing)", () => {
  it("pass mode always requires the app pass", () => {
    expect(resolveGate("pass", true)).toBe("enter-pass");
    expect(resolveGate("pass", false)).toBe("enter-pass");
  });

  it("plain mode with a device lock is a ceremony, not enrollment", () => {
    expect(resolveGate("plain", true)).toBe("device-prompt");
  });

  it("plain mode WITHOUT a device lock is the foot-down", () => {
    expect(resolveGate("plain", false)).toBe("create-pass");
  });

  it("fresh install with a device lock prompts before first open", () => {
    expect(resolveGate("none", true)).toBe("device-prompt");
  });

  it("fresh install without a device lock enrolls before the key exists", () => {
    expect(resolveGate("none", false)).toBe("create-pass");
  });
});
