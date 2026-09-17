// R18: clockwork cadence inference — charge-spacing bands, regex precedence,
// and the recurring-only wiring inside rollupCandidates.
import { inferCadenceFromPayments } from "../classifier";
import { rollupCandidates } from "../rollup";
import type { ClassifiedMessage } from "../types";

let seq = 0;
function hit(
  date: string,
  extra: Partial<ClassifiedMessage> = {},
): ClassifiedMessage {
  seq += 1;
  return {
    message: {
      mailboxId: "tuta:picksandshovels@tutamail.com",
      messageId: `m-${seq}`,
      from: "billing@merchant.com",
      subject: "receipt",
      date,
    },
    subjectClass: "recurring",
    merchantKey: "merchant",
    merchantName: "Merchant",
    kind: "recurring",
    amount: 9.99,
    amountUnknown: false,
    needsBody: false,
    evidence: [],
    confidence: "high",
    ...extra,
  };
}

describe("inferCadenceFromPayments", () => {
  it("names a cadence only when EVERY gap sits in the same band", () => {
    expect(
      inferCadenceFromPayments(["2026-06-01", "2026-07-01", "2026-08-01"]),
    ).toBe("monthly");
    expect(
      inferCadenceFromPayments(["2026-08-03", "2026-08-10", "2026-08-17"]),
    ).toBe("weekly");
    expect(
      inferCadenceFromPayments(["2024-09-06", "2025-09-06", "2026-09-06"]),
    ).toBe("yearly");
  });

  it("stays unknown for too few or irregular charges", () => {
    expect(
      inferCadenceFromPayments(["2026-06-01", "2026-07-01"]),
    ).toBeUndefined();
    expect(
      inferCadenceFromPayments(["2026-06-01", "2026-06-20", "2026-08-01"]),
    ).toBeUndefined();
    expect(inferCadenceFromPayments([])).toBeUndefined();
  });
});

describe("rollupCandidates clockwork wiring", () => {
  it("infers the cadence for recurring groups whose emails never name one", () => {
    const candidates = rollupCandidates([
      hit("2026-06-01"),
      hit("2026-07-01"),
      hit("2026-08-01"),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].cadence).toBe("monthly");
    expect(candidates[0].evidence).toContain("cadence:clockwork-monthly");
  });

  it("keeps regex-detected cadence and adds no clockwork evidence", () => {
    const candidates = rollupCandidates([
      hit("2024-09-06", { cadence: "yearly", evidence: ["cadence:yearly"] }),
      hit("2025-09-06", { cadence: "yearly", evidence: ["cadence:yearly"] }),
      hit("2026-09-06", { cadence: "yearly", evidence: ["cadence:yearly"] }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].cadence).toBe("yearly");
    expect(
      candidates[0].evidence.some((e) => e.startsWith("cadence:clockwork")),
    ).toBe(false);
  });

  it("promotes a clockwork-regular sparse merchant to recurring (2026-09-16)", () => {
    // Same strict spacing evidence as recurring, plus amount consistency.
    const candidates = rollupCandidates([
      hit("2026-06-01", { kind: "sparse" }),
      hit("2026-07-01", { kind: "sparse" }),
      hit("2026-08-01", { kind: "sparse" }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe("recurring");
    expect(candidates[0].cadence).toBe("monthly");
    expect(candidates[0].evidence).toContain(
      "cadence:clockwork-promoted-monthly",
    );
  });

  it("keeps an irregular sparse merchant sparse (no promotion)", () => {
    // One irregular gap → no cadence → no promotion.
    const candidates = rollupCandidates([
      hit("2026-06-01", { kind: "sparse" }),
      hit("2026-06-20", { kind: "sparse" }),
      hit("2026-08-01", { kind: "sparse" }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe("sparse");
    expect(candidates[0].cadence).toBeUndefined();
  });

  it("refuses promotion when the amounts are wildly inconsistent", () => {
    // Clockwork spacing, but the amounts are NOT "approximately the same".
    const candidates = rollupCandidates([
      hit("2026-06-01", { kind: "sparse", amount: 5 }),
      hit("2026-07-01", { kind: "sparse", amount: 40 }),
      hit("2026-08-01", { kind: "sparse", amount: 5 }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe("sparse");
  });

  it("refuses promotion with fewer than three known amounts", () => {
    const candidates = rollupCandidates([
      hit("2026-06-01", { kind: "sparse" }),
      hit("2026-07-01", { kind: "sparse" }),
      hit("2026-08-01", { kind: "sparse", amount: undefined }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe("sparse");
  });
});
