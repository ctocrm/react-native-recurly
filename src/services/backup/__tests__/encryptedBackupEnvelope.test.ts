import {
  escapeSqlText,
  validateExportPassphrase,
} from "../encryptedBackupEnvelope";

describe("encrypted backup pure helpers (Phase O)", () => {
  it("enforces the export passphrase rules", () => {
    expect(validateExportPassphrase("short", "short")).toMatch(/8 characters/);
    expect(validateExportPassphrase("longenough", "different")).toMatch(
      /do not match/i,
    );
    expect(validateExportPassphrase("longenough", "longenough")).toBeNull();
  });

  it("escapes single quotes for SQL key literals", () => {
    expect(escapeSqlText("plain")).toBe("plain");
    expect(escapeSqlText("it's here")).toBe("it''s here");
    expect(escapeSqlText("a''b")).toBe("a''''b");
  });
});

