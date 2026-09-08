import {
  defaultDisplayPeriod,
  displayedAmount,
  monthlySpendContribution,
  nextDisplayPeriod,
  sparseSecondaryLine,
  type DisplayPeriod,
} from "@/services/emailscan";
import { listClassifiedMessagesAsync } from "@/services/emailscan/persist";
import { isSparseSubscription } from "@/services/emailscan/chargeDisplay";
import { getPreference, setPreference } from "@/services/database";
import type { ClassifiedMessage } from "@/services/emailscan/types";
import { useCallback, useEffect, useMemo, useState } from "react";

const PREF_KEY = "display_periods";

function parsePeriods(raw: string | null): Record<string, DisplayPeriod> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, DisplayPeriod>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function useChargeDisplay(subscriptions: Subscription[]) {
  const [messages, setMessages] = useState<ClassifiedMessage[]>([]);
  const [periods, setPeriods] = useState<Record<string, DisplayPeriod>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [hits, stored] = await Promise.all([
          listClassifiedMessagesAsync(),
          getPreference(PREF_KEY),
        ]);
        if (cancelled) return;
        console.log(
          `[MailScan] spend-audit: classified load ok, msgs=${hits.length}`,
        );
        setMessages(hits);
        setPeriods(parsePeriods(stored));
      } catch (err) {
        // R23: a silent catch here zeroed every sparse contribution and the
        // boot UI never retried — log instead of swallowing (LESSONS 26).
        console.log(
          "[MailScan] spend-audit: classified load FAILED",
          err instanceof Error ? err.message : String(err),
        );
        if (!cancelled) setMessages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subscriptions.length]);

  const persist = useCallback(async (next: Record<string, DisplayPeriod>) => {
    setPeriods(next);
    await setPreference(PREF_KEY, JSON.stringify(next));
  }, []);

  const cyclePeriod = useCallback(
    (sub: Subscription) => {
      const current = periods[sub.id] ?? defaultDisplayPeriod(sub);
      const next = nextDisplayPeriod(sub, current);
      void persist({ ...periods, [sub.id]: next });
    },
    [periods, persist],
  );

  const displayFor = useCallback(
    (sub: Subscription) => {
      const period = periods[sub.id] ?? defaultDisplayPeriod(sub);
      return displayedAmount(sub, period, messages);
    },
    [messages, periods],
  );

  // R18: stacked second card line — this month's sparse purchases for the
  // card's own merchant (null when the merchant has no sparse activity).
  const sparseLineFor = useCallback(
    (sub: Subscription) => sparseSecondaryLine(sub, messages),
    [messages],
  );

  const monthlySpend = useMemo(() => {
    // R23 audit: split the total so cold-boot vs post-scan deltas name their
    // owner (recurring amortized vs sparse actuals) in logcat.
    let recurring = 0;
    let sparse = 0;
    let sparseRows = 0;
    let sparseMissingMailbox = 0;
    let unknownPrice = 0;
    const sum = subscriptions.reduce((acc, sub) => {
      const c = monthlySpendContribution(sub, messages);
      if (isSparseSubscription(sub)) {
        sparseRows += 1;
        if (!sub.paymentMethod) sparseMissingMailbox += 1;
        sparse += c;
      } else {
        recurring += c;
      }
      if (sub.priceUnknown) unknownPrice += 1;
      return acc + c;
    }, 0);
    console.log(
      `[MailScan] spend-audit: subs=${subscriptions.length} msgs=${messages.length} ` +
        `recurring=${recurring.toFixed(2)} sparse=${sparse.toFixed(2)} ` +
        `sparseRows=${sparseRows} noMailbox=${sparseMissingMailbox} ` +
        `unknownPrice=${unknownPrice} total=${sum.toFixed(2)}`,
    );
    return sum;
  }, [messages, subscriptions]);

  return { messages, displayFor, sparseLineFor, cyclePeriod, monthlySpend };
}