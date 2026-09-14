import {
  defaultDisplayPeriod,
  displayedAmount,
  monthlySpendContribution,
  nextDisplayPeriod,
  sparseSecondaryLine,
  type DisplayPeriod,
} from "@/services/emailscan";
import { listClassifiedMessagesAsync } from "@/services/emailscan/persist";
import {
  isSparseSubscription,
} from "@/services/emailscan/chargeDisplay";
import {
  projectionDisplayedAmount,
  projectionMonthlySpendContribution,
  projectionSparseSecondaryLine,
} from "@/services/emailscan/projectionDisplay";
import {
  loadActualsAsync,
  onProjectionRebuilt,
  type MerchantDayActual,
} from "@/services/emailscan/projection";
import { getPreference, setPreference } from "@/services/database";
import type { ClassifiedMessage } from "@/services/emailscan/types";
import { useCallback, useEffect, useMemo, useState } from "react";

const PREF_KEY = "display_periods";

/** R26/DEC-001 kill-switch: pref "off" restores the legacy full-load path.
 * Default ON — boot reads small actuals rows instead of every message. */
const PROJECTION_PREF_KEY = "use_projection_actuals";

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
  const [actuals, setActuals] = useState<MerchantDayActual[]>([]);
  const [usingProjection, setUsingProjection] = useState(true);
  const [periods, setPeriods] = useState<Record<string, DisplayPeriod>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [projectionPref, stored] = await Promise.all([
          getPreference(PROJECTION_PREF_KEY),
          getPreference(PREF_KEY),
        ]);
        const useProjection = projectionPref !== "off";
        if (cancelled) return;
        setUsingProjection(useProjection);
        setPeriods(parsePeriods(stored));
        if (useProjection) {
          const buckets = await loadActualsAsync();
          if (cancelled) return;
          console.log(
            `[MailScan] spend-audit: projection load ok, buckets=${buckets.length}`,
          );
          setActuals(buckets);
          return;
        }
        const hits = await listClassifiedMessagesAsync();
        if (cancelled) return;
        console.log(
          `[MailScan] spend-audit: classified load ok, msgs=${hits.length}`,
        );
        setMessages(hits);
      } catch (err) {
        // R23: a silent catch here zeroed every sparse contribution and the
        // boot UI never retried — log instead of swallowing (LESSONS 26).
        console.log(
          "[MailScan] spend-audit: load FAILED",
          err instanceof Error ? err.message : String(err),
        );
        if (!cancelled) {
          setMessages([]);
          setActuals([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subscriptions.length]);

  // F-6: rebuilds land off the write path (coalesced, fire-and-forget), so
  // without subscribing this hook kept summing boot-time buckets while imports
  // changed the rows — 2026-09-14 the audit read projection=669.31 vs
  // legacy=519.31 (match=NO) with zero fold error; a fresh load read both at
  // 519.31 (delta 0.00). Reload actuals on every successful rebuild.
  useEffect(() => {
    let cancelled = false;
    const off = onProjectionRebuilt(() => {
      void loadActualsAsync()
        .then((rows) => {
          if (!cancelled) setActuals(rows);
        })
        .catch((err) => {
          console.log(
            "[MailScan] spend-audit: projection reload FAILED",
            err instanceof Error ? err.message : String(err),
          );
        });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // R26/DEC-001 verification: once per boot, after the projection UI has
  // settled, run the legacy full-scan total in the background and log it
  // beside the projection total. Removed in Phase 5 once proven.
  useEffect(() => {
    if (!usingProjection) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const msgs = await listClassifiedMessagesAsync();
          if (cancelled) return;
          const legacy = subscriptions.reduce(
            (acc, s) => acc + monthlySpendContribution(s, msgs),
            0,
          );
          const projected = subscriptions.reduce(
            (acc, s) => acc + projectionMonthlySpendContribution(s, actuals),
            0,
          );
          const delta = Math.abs(projected - legacy);
          console.log(
            `[MailScan] spend-projection-audit: projection=${projected.toFixed(2)} ` +
              `legacy=${legacy.toFixed(2)} delta=${delta.toFixed(2)} ` +
              `match=${delta < 0.005 ? "yes" : "NO"}`,
          );
        } catch (err) {
          console.log(
            "[MailScan] spend-projection-audit FAILED",
            err instanceof Error ? err.message : String(err),
          );
        }
      })();
    }, 5000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [usingProjection, subscriptions, actuals]);

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
      if (usingProjection) {
        return projectionDisplayedAmount(sub, period, actuals);
      }
      return displayedAmount(sub, period, messages);
    },
    [messages, actuals, periods, usingProjection],
  );

  // R18: stacked second card line — this month's sparse purchases for the
  // card's own merchant (null when the merchant has no sparse activity).
  const sparseLineFor = useCallback(
    (sub: Subscription) => {
      if (usingProjection) {
        return projectionSparseSecondaryLine(sub, actuals);
      }
      return sparseSecondaryLine(sub, messages);
    },
    [messages, actuals, usingProjection],
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
      const c = usingProjection
        ? projectionMonthlySpendContribution(sub, actuals)
        : monthlySpendContribution(sub, messages);
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
      `[MailScan] spend-audit: subs=${subscriptions.length} ` +
        `${usingProjection ? `buckets=${actuals.length}` : `msgs=${messages.length}`} ` +
        `recurring=${recurring.toFixed(2)} sparse=${sparse.toFixed(2)} ` +
        `sparseRows=${sparseRows} noMailbox=${sparseMissingMailbox} ` +
        `unknownPrice=${unknownPrice} total=${sum.toFixed(2)}`,
    );
    return sum;
  }, [messages, actuals, subscriptions, usingProjection]);

  return {
    messages,
    actuals,
    usingProjection,
    displayFor,
    sparseLineFor,
    cyclePeriod,
    monthlySpend,
  };
}