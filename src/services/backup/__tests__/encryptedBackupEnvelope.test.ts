import {
  buildEncryptedBackupEnvelope,
  ENCRYPTED_BACKUP_MAGIC,
  parseEncryptedBackupEnvelope,
  validateExportPassphrase,
} from "../encryptedBackupEnvelope";

const KDF = { salt: "c2FsdA==", iterations: 600_000, bits: 256 };

describe("encrypted backup envelope (Phase O)", () => {
  it("round-trips a valid envelope", () => {
    const text = buildEncryptedBackupEnvelope({
      kdf: KDF,
      wrappedKey: "d3JhcHBlZA==",
      db: "ZGJieXRlcw==",
    });
    const parsed = parseEncryptedBackupEnvelope(text);
    expect(parsed.magic).toBe(ENCRYPTED_BACKUP_MAGIC);
    expect(parsed.v).toBe(1);
    expect(parsed.kdf).toEqual(KDF);
    expect(parsed.wrappedKey).toBe("d3JhcHBlZA==");
    expect(parsed.db).toBe("ZGJieXRlcw==");
  });

  it("rejects non-JSON and wrong-magic files", () => {
    expect(() => parseEncryptedBackupEnvelope("not json")).toThrow(
      /invalid JSON/i,
    );
    expect(() =>
      parseEncryptedBackupEnvelope(JSON.stringify({ magic: "other", v: 1 })),
    ).toThrow(/Not a Cadence encrypted backup/);
  });

  it("rejects unsupported versions and incomplete payloads", () => {
    expect(() =>
      parseEncryptedBackupEnvelope(
        JSON.stringify({ magic: ENCRYPTED_BACKUP_MAGIC, v: 99 }),
      ),
    ).toThrow(/Unsupported backup version/i);
    expect(() =>
      parseEncryptedBackupEnvelope(
        JSON.stringify({ magic: ENCRYPTED_BACKUP_MAGIC, v: 1 }),
      ),
    ).toThrow(/incomplete or corrupted/i);
    expect(() =>
      parseEncryptedBackupEnvelope(
        JSON.stringify({
          magic: ENCRYPTED_BACKUP_MAGIC,
          v: 1,
          kdf: { salt: "s", iterations: 1, bits: 256 },
          wrappedKey: "w",
          db: "",
        }),
      ),
    ).toThrow(/incomplete or corrupted/i);
  });

  it("enforces the export passphrase rules", () => {
    expect(validateExportPassphrase("short", "short")).toMatch(/8 characters/);
    expect(validateExportPassphrase("longenough", "different")).toMatch(
      /do not match/i,
    );
    expect(validateExportPassphrase("longenough", "longenough")).toBeNull();
  });
});
