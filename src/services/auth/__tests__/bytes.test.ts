import { b64ToUtf8, utf8ToB64 } from "../bytes";

describe("auth/bytes (Hermes-safe base64 helpers)", () => {
  it("round-trips ascii", () => {
    const value = "deadbeef123";
    expect(b64ToUtf8(utf8ToB64(value))).toBe(value);
  });

  it("round-trips multibyte text", () => {
    const value = ":key→é€ hello world";
    expect(b64ToUtf8(utf8ToB64(value))).toBe(value);
  });

  it("round-trips empty and long strings", () => {
    expect(b64ToUtf8(utf8ToB64(""))).toBe("");
    const value = "x".repeat(1000);
    expect(b64ToUtf8(utf8ToB64(value))).toBe(value);
  });

  it("handles lengths hitting all base64 padding cases", () => {
    for (const len of [1, 2, 3, 4, 5, 6, 7, 31, 32, 33]) {
      const value = "a".repeat(len);
      expect(b64ToUtf8(utf8ToB64(value))).toBe(value);
    }
  });
});
