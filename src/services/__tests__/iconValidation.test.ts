import { isBase64IconValid, isPaintableCardIcon } from "../iconValidation";

function btoaUtf8(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function tinyJpeg(): string {
  // Minimal SOI + padding; too small / too uniform to be a logo.
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...Array(40).fill(0)]);
  return Buffer.from(bytes).toString("base64");
}

describe("isBase64IconValid (hop 4)", () => {
  it("rejects empty payloads", () => {
    expect(isBase64IconValid("", "png")).toBe(false);
    expect(isBase64IconValid("abcd", "png")).toBe(false);
  });

  it("accepts SVGs with drawing commands and rejects empty SVGs", () => {
    const good = btoaUtf8(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z"/></svg>',
    );
    const empty = btoaUtf8(
      '<svg xmlns="http://www.w3.org/2000/svg"><g></g></svg>',
    );
    expect(isBase64IconValid(good, "svg")).toBe(true);
    expect(isBase64IconValid(empty, "svg")).toBe(false);
    expect(isPaintableCardIcon(good, "svg")).toBe(false);
  });

  it("rejects tiny/uniform JPEGs and undersized ICO headers", () => {
    expect(isBase64IconValid(tinyJpeg(), "jpeg")).toBe(false);
    const ico = Buffer.from(
      Uint8Array.from([0, 0, 1, 0, 0, 0, 1, 1, ...Array(20).fill(0)]),
    ).toString("base64");
    expect(isBase64IconValid(ico, "ico")).toBe(false);
  });
});
