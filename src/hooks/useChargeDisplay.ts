import {
  defaultDisplayPeriod,
  displayedAmount,
  monthlySpendContribution,
  nextDisplayPeriod,
  type DisplayPeriod,
} from "@/services/emailscan";
import { listClassifiedMessagesAsync } from "@/services/emailscan/persist";
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
        setMessages(hits);
        setPeriods(parsePeriods(stored));
      } catch {
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

  const monthlySpend = useMemo(
    () =>
      subscriptions.reduce(
        (sum, sub) => sum + monthlySpendContribution(sub, messages),
        0,
      ),
    [messages, subscriptions],
  );

  return { messages, displayFor, cyclePeriod, monthlySpend };
}