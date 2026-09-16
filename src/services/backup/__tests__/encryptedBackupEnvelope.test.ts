import {
  buildEncryptedBackupHeader,
  ENCRYPTED_BACKUP_HEADER_SIZE,
  ENCRYPTED_BACKUP_MAGIC,
  parseEncryptedBackupHeader,
  validateExportPassphrase,
} from "../encryptedBackupEnvelope";

const META = { salt: "c2FsdA==", iterations: 600_000, bits: 256 };

describe("encrypted backup header (Phase O)", () => {
  it("round-trips a valid header at exactly 512 bytes", () => {
    const text = buildEncryptedBackupHeader(META);
    expect(text.length).toBe(ENCRYPTED_BACKUP_HEADER_SIZE);
    const parsed = parseEncryptedBackupHeader(text);
    expect(parsed.salt).toBe(META.salt);
    expect(parsed.iterations).toBe(META.iterations);
    expect(parsed.bits).toBe(META.bits);
  });

  it("rejects non-JSON and wrong-magic files", () => {
    expect(() => parseEncryptedBackupHeader("not json")).toThrow(
      /Not a Cadence encrypted backup/,
    );
    expect(() =>
      parseEncryptedBackupHeader(JSON.stringify({ magic: "other", v: 1 })),
    ).toThrow(/Not a Cadence encrypted backup/);
  });

  it("rejects unsupported versions and incomplete payloads", () => {
    expect(() =>
      parseEncryptedBackupHeader(
        JSON.stringify({ magic: ENCRYPTED_BACKUP_MAGIC, v: 99 }),
      ),
    ).toThrow(/Unsupported backup version/i);
    expect(() =>
      parseEncryptedBackupHeader(
        JSON.stringify({ magic: ENCRYPTED_BACKUP_MAGIC, v: 1 }),
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
