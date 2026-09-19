/**
 * Phase A vault orchestration. The native CadenceVault module and
 * expo-secure-store are faked in-memory; the fake KDF is deterministic
 * (NOT cryptographic — crypto correctness is the native module's job, and
 * the BIP-39 checksum is proven with real SHA-256 in bip39.test.ts).
 * What is proven here: the custody choreography — enrollment wraps and
 * DELETES the plaintext, unlocks round-trip the exact key, wrong
 * pass/phrase fail with the right errors, change/regenerate/disable
 * leave the store in the documented state.
 */
import {
  changeAppPass,
  disableAppPass,
  enrollAppPass,
  getVaultMode,
  regenerateRecoveryPhrase,
  setAppPassFromKey,
  unlockWithPass,
  unlockWithPhrase,
} from "../vault";
import { validateRecoveryPhrase } from "../bip39";

const mockStore = new Map<string, string>();
let mockSaltCounter = 0;
let mockGenCount = 0;

const mockPhrase1 = [
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot",
  "golf", "hotel", "india", "juliet", "kilo", "lima",
];
const mockPhrase2 = [
  "mango", "nectar", "ocean", "piano", "quartz", "river",
  "solar", "tiger", "ultra", "velvet", "willow", "xenon",
];

jest.mock("react-native", () => ({
  NativeModules: {
    CadenceVault: {
      pbkdf2Sha256: jest.fn(
        async (password: string, salt: string) => `k:${password}:${salt}`,
      ),
      aesGcmEncrypt: jest.fn(
        async (keyB64: string, plainB64: string) => `W|${keyB64}|${plainB64}`,
      ),
      aesGcmDecrypt: jest.fn(
        async (keyB64: string, blob: string) => {
          const [tag, k, p] = blob.split("|");
          if (tag !== "W" || k !== keyB64) {
            const err = new Error("auth failed");
            (err as { code?: string }).code = "WRONG_KEY";
            throw err;
          }
          return p;
        },
      ),
      randomBytesB64: jest.fn(async () => `salt-${(mockSaltCounter += 1)}`),
      isDeviceSecure: jest.fn(async () => false),
      confirmDeviceCredential: jest.fn(async () => true),
      setSecureWindow: jest.fn(),
    },
  },
  Platform: { OS: "android", select: (o: any) => o.android },
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

jest.mock("../../db/connection", () => ({
  getOrCreateDbKey: jest.fn(async () => {
    // Mimics connection.ts: returns the stored key or mints one.
    const key = "db_key_local";
    if (mockStore.has(key)) return mockStore.get(key) as string;
    const minted = "deadbeefdeadbeefdeadbeefdeadbeef";
    mockStore.set(key, minted);
    return minted;
  }),
}));

jest.mock("../bip39", () => ({
  generateRecoveryPhrase: jest.fn(async () =>
    mockGenCount++ === 0 ? [...mockPhrase1] : [...mockPhrase2],
  ),
  validateRecoveryPhrase: jest.fn(async () => true),
}));

const USER = "local";
const DB_KEY = "db_key_local";
const KEY_WRAPPED = "cadence_vault_wrapped";
const KEY_RECOVERY_WRAPPED = "cadence_recovery_wrapped";
const MINTED = "deadbeefdeadbeefdeadbeefdeadbeef";

async function enrollFresh() {
  mockStore.clear();
  mockSaltCounter = 0;
  mockGenCount = 0;
  return enrollAppPass(USER, "correct horse battery");
}

describe("auth/vault (custody orchestration)", () => {
  it("mode detection: none -> plain -> pass", async () => {
    mockStore.clear();
    await expect(getVaultMode(USER)).resolves.toBe("none");
    mockStore.set(DB_KEY, "abc");
    await expect(getVaultMode(USER)).resolves.toBe("plain");
    mockStore.set(KEY_WRAPPED, "W|k|p");
    await expect(getVaultMode(USER)).resolves.toBe("pass");
  });

  it("enrollment wraps both blobs, deletes the plaintext, returns the phrase", async () => {
    const phrase = await enrollFresh();
    expect(phrase).toEqual(mockPhrase1);
    expect(mockStore.has(DB_KEY)).toBe(false); // custody switch
    expect(mockStore.has(KEY_WRAPPED)).toBe(true);
    expect(mockStore.has(KEY_RECOVERY_WRAPPED)).toBe(true);
    expect(mockStore.has("cadence_vault_meta")).toBe(true);
    expect(mockStore.has("cadence_recovery_meta")).toBe(true);
    await expect(getVaultMode(USER)).resolves.toBe("pass");
  });

  it("unlockWithPass round-trips the exact key; wrong pass is WRONG_PASS", async () => {
    await enrollFresh();
    await expect(unlockWithPass("correct horse battery")).resolves.toBe(MINTED);
    await expect(unlockWithPass("wrong pass")).rejects.toThrow("WRONG_PASS");
  });

  it("unlockWithPhrase round-trips; an unknown phrase is WRONG_PHRASE", async () => {
    await enrollFresh();
    await expect(unlockWithPhrase(mockPhrase1)).resolves.toBe(MINTED);
    (validateRecoveryPhrase as jest.Mock).mockResolvedValueOnce(true);
    await expect(unlockWithPhrase([...mockPhrase1].reverse())).rejects.toThrow(
      "WRONG_PHRASE",
    );
    (validateRecoveryPhrase as jest.Mock).mockResolvedValueOnce(false);
    await expect(unlockWithPhrase(mockPhrase1)).rejects.toThrow("WRONG_PHRASE");
  });

  it("changeAppPass: old stops working, new works", async () => {
    await enrollFresh();
    await changeAppPass("correct horse battery", "new pass 123");
    await expect(unlockWithPass("correct horse battery")).rejects.toThrow(
      "WRONG_PASS",
    );
    await expect(unlockWithPass("new pass 123")).resolves.toBe(MINTED);
  });

  it("setAppPassFromKey re-wraps from an already-recovered key", async () => {
    await enrollFresh();
    await setAppPassFromKey(MINTED, "recovered 99");
    await expect(unlockWithPass("recovered 99")).resolves.toBe(MINTED);
  });

  it("regenerateRecoveryPhrase invalidates the old phrase", async () => {
    await enrollFresh();
    const fresh = await regenerateRecoveryPhrase("correct horse battery");
    expect(fresh).toEqual(mockPhrase2);
    // Old phrase still checksums (fake validate=true) but the wrapped key
    // no longer matches — exactly the WRONG_PHRASE contract.
    (validateRecoveryPhrase as jest.Mock).mockResolvedValueOnce(true);
    await expect(unlockWithPhrase(mockPhrase1)).rejects.toThrow("WRONG_PHRASE");
    await expect(unlockWithPhrase(fresh)).resolves.toBe(MINTED);
  });

  it("disableAppPass restores the plaintext and clears pass mode", async () => {
    await enrollFresh();
    await disableAppPass(USER, "correct horse battery");
    expect(mockStore.get(DB_KEY)).toBe(MINTED);
    expect(mockStore.has(KEY_WRAPPED)).toBe(false);
    expect(mockStore.has(KEY_RECOVERY_WRAPPED)).toBe(false);
    await expect(getVaultMode(USER)).resolves.toBe("plain");
  });
});

