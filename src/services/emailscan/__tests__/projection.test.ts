/**
 * R26/DEC-001 equality gates: the merchant actuals projection must sum
 * EXACTLY what the legacy full-scan matcher sums, per (subscription, window).
 *
 * Fixtures deliberately include the matcher's fallback cases:
 *  - case-only name variants,
 *  - punctuation-stripping slugs ("McDonald's" → "mcdonalds"),
 *  - dashed-domain merchants whose merchantName lower-equals the sub name
 *    while the slug ALSO matches (the double-count trap: slug + name − both
 *    must equal one count),
 *  - underscore domain labels where ONLY the fallback predicate fires.
 *
 * Known boundary note (documented in DEC-001): legacy windows end at `now`,
 * so a same-day FUTURE-dated email would be excluded there but included in a
 * day bucket. Real mail is never future-dated, so equality holds in practice.
 */

import {
  bothBucketKey,
  foldActuals,
  loadActualsAsync,
  localDayKey,
  onProjectionRebuilt,
  rebuildProjectionAsync,
  type MerchantDayActual,
  type ProjectionSourceRow,
} from "../projection";
import {
  matchesSubscription,
  sumChargesInWindow,
  windowForPeriod,
} from "../chargeDisplay";
import { nameToSlug } from "@/services/iconScraper";
import type { ClassifiedMessage } from "../types";

import { getDatabase } from "@/services/db/connection";

jest.mock("@/services/db/connection", () => {
  const fake = {
    sourceRows: [] as {
      mailbox_id: string;
      date: string;
      classified_json: string;
    }[],
    actualRows: [] as MerchantDayActual[],
    deletes: [] as string[],
    async getAllAsync<T>(sql: string): Promise<T[]> {
      if (/FROM mail_messages/.test(sql)) {
        return fake.sourceRows as unknown as T[];
      }
      if (/FROM merchant_day_actuals/.test(sql)) {
        return fake.actualRows as unknown as T[];
      }
      return [] as unknown as T[];
    },
    async execAsync(sql: string): Promise<void> {
      if (/DELETE FROM merchant_day_actuals/.test(sql)) {
        fake.actualRows = [];
        fake.deletes.push(sql);
      }
    },
    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      await fn();
    },
    async prepareAsync() {
      return {
        executeAsync: async (...params: unknown[]) => {
          fake.actualRows.push({
            bucketType: params[0] as MerchantDayActual["bucketType"],
            bucketKey: params[1] as string,
            mailboxId: params[2] as string,
            kind: params[3] as MerchantDayActual["kind"],
            day: params[4] as string,
            total: params[5] as number,
            count: params[6] as number,
            unknownCount: params[7] as number,
          });
        },
        finalizeAsync: async () => undefined,
      };
    },
  };
  return { getDatabase: () => fake };
});
const fake = getDatabase() as unknown as {
  sourceRows: {
    mailbox_id: string;
    date: string;
    classified_json: string;
  }[];
  actualRows: MerchantDayActual[];
  deletes: string[];
};

let seq = 0;
function charge(
  over: Partial<ClassifiedMessage> & {
    date: string;
    merchantKey: string;
    merchantName: string;
    kind: "recurring" | "sparse";
    amount: number;
  },
): ClassifiedMessage {
  seq += 1;
  return {
    message: {
      mailboxId:
        (over.message as ClassifiedMessage["message"])?.mailboxId ?? "mb1",
      messageId: `m${seq}`,
      from: "no-reply@example.com",
      subject: "Your receipt",
      date: over.date,
    },
    subjectClass: "account",
    merchantKey: over.merchantKey,
    merchantName: over.merchantName,
    kind: over.kind,
    amount: over.amount,
  } as ClassifiedMessage;
}

function sub(name: string, over: Partial<Subscription> = {}): Subscription {
  return {
    id: `sub-${name}`,
    name,
    category: "recurring",
    paymentMethod: "",
    status: "active",
    price: 0,
    priceUnknown: false,
    currency: "USD",
    billing: "Monthly",
    ...over,
  } as unknown as Subscription;
}

const NOW = new Date(2026, 2, 15, 10, 0, 0); // Sun Mar 15 2026, 10:00 local

function projectionWindowSum(
  actuals: MerchantDayActual[],
  subscription: Subscription,
  start: Date,
  end: Date,
): number {
  const S = nameToSlug(subscription.name);
  const L = subscription.name.toLowerCase();
  const kind = subscription.category === "sparse" ? "sparse" : "recurring";
  let total = 0;
  for (const a of actuals) {
    if (a.kind !== kind) continue;
    if (
      subscription.paymentMethod &&
      a.mailboxId !== subscription.paymentMethod
    ) {
      continue;
    }
    const [y, m, d] = a.day.split("-").map(Number);
    const dayStart = new Date(y, m - 1, d);
    const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
    if (dayEnd < start || dayStart > end) continue;
    if (a.bucketType === "slug" && a.bucketKey === S) total += a.total;
    else if (a.bucketType === "name" && a.bucketKey === L) total += a.total;
    else if (a.bucketType === "both" && a.bucketKey === bothBucketKey(S, L)) {
      total -= a.total;
    }
  }
  return total;
}

describe("projection fold semantics", () => {
  it("writes a slug row always, and name/both rows only when lowerName differs", () => {
    const rows: ProjectionSourceRow[] = [
      { merchantKey: "netflix", merchantName: "Netflix", mailboxId: "mb1", kind: "recurring", amount: 15, date: "2026-03-10T09:00:00" },
      { merchantKey: "netflix_billing", merchantName: "Netflix Billing", mailboxId: "mb1", kind: "recurring", amount: 15, date: "2026-03-10T09:00:00" },
    ];
    const agg = foldActuals(rows);
    const keys = agg.map((a) => `${a.bucketType}:${a.bucketKey}`);
    // plain key: slug only (name === key suppressed, no both row)
    expect(keys).toContain("slug:netflix");
    expect(keys).not.toContain("name:netflix");
    // underscore key: slug + name + both correction
    expect(keys).toContain("slug:netflix_billing");
    expect(keys).toContain("name:netflix billing");
    expect(keys).toContain(
      `both:${bothBucketKey("netflix_billing", "netflix billing")}`,
    );
  });

  it("buckets by local day and skips unparseable dates and non-charges", () => {
    const agg = foldActuals([
      { merchantKey: "a", merchantName: "A", mailboxId: "mb1", kind: "recurring", amount: 1, date: "2026-03-10T09:00:00" },
      { merchantKey: "a", merchantName: "A", mailboxId: "mb1", kind: "recurring", amount: 2, date: "2026-03-10T20:00:00" },
      { merchantKey: "a", merchantName: "A", mailboxId: "mb1", kind: "recurring", amount: 4, date: "2026-03-11T09:00:00" },
      { merchantKey: "a", merchantName: "A", mailboxId: "mb1", kind: "recurring", amount: 8, date: "not-a-date" },
      { merchantKey: "a", merchantName: "A", mailboxId: "mb1", kind: "free", amount: 16, date: "2026-03-10T09:00:00" },
    ]);
    expect(agg).toHaveLength(2);
    expect(localDayKey("not-a-date")).toBeNull();
  });
});

describe("projection ≡ legacy matcher equality", () => {
  const messages: ClassifiedMessage[] = [
    // plain slug match (both predicates true, no name rows)
    charge({ date: "2026-03-10T09:00:00", merchantKey: "netflix", merchantName: "Netflix", kind: "recurring", amount: 15 }),
    // punctuated brand: slug "mcdonalds", lower "mcdonald's" (name+both rows)
    charge({ date: "2026-03-12T09:00:00", merchantKey: "mcdonalds", merchantName: "McDonald's", kind: "sparse", amount: 9.4 }),
    // dashed-domain: slug matches the "Netflix Billing" sub AND name rows exist
    charge({ date: "2026-03-13T09:00:00", merchantKey: "netflix-billing", merchantName: "Netflix Billing", kind: "sparse", amount: 41.99 }),
    // underscore domain: ONLY the fallback predicate can match this sub name
    charge({ date: "2026-03-14T09:00:00", merchantKey: "netflix_billing", merchantName: "Netflix Billing", kind: "sparse", amount: 7.25 }),
    // wrong mailbox for the mailbox-scoped sub
    charge({ date: "2026-03-11T09:00:00", merchantKey: "mcdonalds", merchantName: "McDonald's", kind: "sparse", amount: 100, message: { mailboxId: "mb2" } as ClassifiedMessage["message"] }),
    // outside every window under test
    charge({ date: "2026-02-20T09:00:00", merchantKey: "mcdonalds", merchantName: "McDonald's", kind: "sparse", amount: 55 }),
    charge({ date: "2026-04-02T09:00:00", merchantKey: "mcdonalds", merchantName: "McDonald's", kind: "sparse", amount: 77 }),
  ];

  const cases: [string, Subscription][] = [
    ["slug+name identical (Netflix)", sub("Netflix")],
    ["punctuation-stripped slug (McDonald's)", sub("McDonald's")],
    ["dashed-domain double-count trap (Netflix Billing)", sub("Netflix Billing")],
    [
      "fallback-only mailbox-scoped sparse (McDonald's)",
      sub("McDonald's", { category: "sparse", paymentMethod: "mb1" }),
    ],
    ["underscore-domain fallback (netflix billing)", sub("netflix billing")],
  ];

  const windows: [string, Date, Date][] = [
    ["week", windowForPeriod("week", NOW).start, NOW],
    ["month", windowForPeriod("month", NOW).start, NOW],
    ["year", windowForPeriod("year", NOW).start, NOW],
  ];

  it.each(cases)("%s", (_label, subscription) => {
    const actuals = foldActuals(
      messages.map((m) => ({
        merchantKey: m.merchantKey,
        merchantName: m.merchantName,
        mailboxId: m.message.mailboxId,
        kind: m.kind as string,
        amount: m.amount as number,
        date: m.message.date,
      })),
    );
    for (const [winName, start, end] of windows) {
      const legacy = sumChargesInWindow(subscription, messages, start, end);
      const projected = projectionWindowSum(actuals, subscription, start, end);
      expect(`${winName}:${projected}`).toBe(`${winName}:${legacy}`);
    }
  });

  it("matchesSubscription and the buckets agree per-message (mailbox filter)", () => {
    const sparseSub = sub("McDonald's", {
      category: "sparse",
      paymentMethod: "mb1",
    });
    for (const m of messages) {
      const legacyHit = matchesSubscription(m, sparseSub);
      const mailboxOk =
        !sparseSub.paymentMethod ||
        m.message.mailboxId === sparseSub.paymentMethod;
      const inBuckets =
        mailboxOk &&
        (m.merchantKey === nameToSlug(sparseSub.name) ||
          m.merchantName.toLowerCase() === sparseSub.name.toLowerCase()) &&
        m.kind === "sparse";
      expect(legacyHit).toBe(inBuckets);
    }
  });
});

describe("rebuild + load roundtrip", () => {
  it("folds mail_messages into the projection table and reads it back", async () => {
    fake.sourceRows = [
      {
        mailbox_id: "mb1",
        date: "2026-03-10T09:00:00",
        classified_json: JSON.stringify({
          merchantKey: "netflix",
          merchantName: "Netflix",
          kind: "recurring",
          amount: 15,
        }),
      },
      {
        mailbox_id: "mb1",
        date: "2026-03-12T09:00:00",
        classified_json: "{not json",
      },
      {
        // Paid-unknown (Tuta-invoice class): proven payment, unreadable
        // amount — buckets with total 0 + unknown_count 1 (schema v17).
        mailbox_id: "mb1",
        date: "2026-03-15T09:00:00",
        classified_json: JSON.stringify({
          merchantKey: "netflix",
          merchantName: "Netflix",
          kind: "recurring",
        }),
      },
    ];
    fake.actualRows = [];
    fake.deletes = [];

    const buckets = await rebuildProjectionAsync();
    expect(buckets).toBe(2);
    expect(fake.deletes).toHaveLength(1);
    expect(fake.actualRows).toEqual([
      {
        bucketType: "slug",
        bucketKey: "netflix",
        mailboxId: "mb1",
        kind: "recurring",
        day: localDayKey("2026-03-10T09:00:00"),
        total: 15,
        count: 1,
        unknownCount: 0,
      },
      {
        bucketType: "slug",
        bucketKey: "netflix",
        mailboxId: "mb1",
        kind: "recurring",
        day: localDayKey("2026-03-15T09:00:00"),
        total: 0,
        count: 0,
        unknownCount: 1,
      },
    ]);

    const loaded = await loadActualsAsync();
    expect(loaded).toEqual(fake.actualRows);
  });
});

describe("onProjectionRebuilt (F-6 staleness fix)", () => {
  it("notifies listeners after a successful rebuild, with the bucket count", async () => {
    const seen: number[] = [];
    const off = onProjectionRebuilt((n) => seen.push(n));
    try {
      const buckets = await rebuildProjectionAsync();
      expect(seen).toEqual([buckets]);
    } finally {
      off();
    }
  });

  it("stops notifying after unsubscribe", async () => {
    const seen: number[] = [];
    const off = onProjectionRebuilt((n) => seen.push(n));
    off();
    await rebuildProjectionAsync();
    expect(seen).toEqual([]);
  });

  it("listener errors never break the rebuild", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const off = onProjectionRebuilt(() => {
      throw new Error("listener boom");
    });
    try {
      const buckets = await rebuildProjectionAsync();
      expect(typeof buckets).toBe("number");
      expect(
        logSpy.mock.calls.some((call) =>
          String(call[0]).includes("projection rebuilt listener FAILED"),
        ),
      ).toBe(true);
    } finally {
      off();
      logSpy.mockRestore();
    }
  });
});

