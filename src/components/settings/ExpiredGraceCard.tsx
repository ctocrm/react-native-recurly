/**
 * Phase N: the may-have-expired grace period control. A renewal that lapsed
 * past this many days puts the card in the "may have expired" state (chip +
 * Expired filter). 3/7/14 days; default 7.
 */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  getExpiredGraceDays,
  setExpiredGraceDays,
} from "@/services/database";

const OPTIONS = [3, 7, 14] as const;

export function ExpiredGraceCard() {
  const [days, setDays] = useState<number>(7);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getExpiredGraceDays()
      .then(setDays)
      .catch(() => {});
  }, []);

  const choose = async (value: number) => {
    if (busy || value === days) return;
    setBusy(true);
    try {
      await setExpiredGraceDays(value);
      setDays(value);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="auth-card mb-5">
      <Text className="text-base font-sans-semibold text-primary mb-1">
        Expired grace period
      </Text>
      <Text className="text-xs font-sans-medium text-muted-foreground mb-3">
        A subscription is marked “may have expired” this many days after its
        renewal date passes.
      </Text>
      <View className="flex-row gap-2">
        {OPTIONS.map((option) => (
          <Pressable
            key={option}
            className={`flex-1 items-center rounded-xl border px-2 py-3 ${
              days === option
                ? "border-accent bg-accent/10"
                : "border-border bg-card"
            }`}
            onPress={() => void choose(option)}
            disabled={busy}
          >
            <Text
              className={`text-sm font-sans-semibold ${
                days === option ? "text-accent" : "text-primary"
              }`}
            >
              {option} days
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
