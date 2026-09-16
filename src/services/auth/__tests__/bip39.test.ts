import {
  generateRecoveryPhrase,
  mnemonicFromEntropy,
  validateRecoveryPhrase,
} from "../bip39";

// Real SHA-256 via node — the checksum math under test must be genuine.
jest.mock("expo-crypto", () => {
  // Lazy require inside the factory (babel-jest hoisting rule).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require("crypto") as typeof import("crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digest: jest.fn(async (_algo: string, data: BufferSource) =>
      new Uint8Array(
        nodeCrypto
          .createHash("sha256")
          .update(new Uint8Array(data as Uint8Array))
          .digest(),
      ),
    ),
    getRandomBytes: jest.fn((n: number) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) out[i] = Math.floor(Math.random() * 256);
      return out;
    }),
  };
});

describe("auth/bip39 (recovery phrase codec)", () => {
  it("matches the canonical BIP-39 vector for all-zero entropy", async () => {
    const words = await mnemonicFromEntropy(new Uint8Array(16));
    expect(words).toEqual([
      "abandon",
      "abandon",
      "abandon",
      "abandon",
      "abandon",
      "abandon",
      "abandon",
      "abandon",
      "abandon",
      "abandon",
      "abandon",
      "about",
    ]);
  });

  it("validates its own generated phrases", async () => {
    const words = await generateRecoveryPhrase();
    expect(words).toHaveLength(12);
    await expect(validateRecoveryPhrase(words)).resolves.toBe(true);
  });

  it("rejects a tampered phrase", async () => {
    const words = await generateRecoveryPhrase();
    const tampered = [...words];
    tampered[5] = tampered[5] === "absent" ? "agent" : "absent";
    await expect(validateRecoveryPhrase(tampered)).resolves.toBe(false);
  });

  it("is tolerant of case and stray whitespace", async () => {
    const words = await generateRecoveryPhrase();
    const messy = words.map((w) => `  ${w.toUpperCase()} `);
    await expect(validateRecoveryPhrase(messy)).resolves.toBe(true);
  });

  it("rejects wrong word counts and unknown words", async () => {
    await expect(validateRecoveryPhrase(["abandon"])).resolves.toBe(false);
    await expect(
      validateRecoveryPhrase(new Array(12).fill("notaword")),
    ).resolves.toBe(false);
  });

  it("refuses entropy of the wrong length", async () => {
    await expect(mnemonicFromEntropy(new Uint8Array(8))).rejects.toThrow();
  });
});
