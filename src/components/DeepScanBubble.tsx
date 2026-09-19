/**
 * Phase K: the deep re-list progress bubble.
 *
 * Mounted once at the root (app/_layout.tsx, above <Stack>) so it floats over
 * every screen while a deep re-list runs — deep scans legitimately run for
 * many minutes and the user must be able to leave Settings (or Home) and keep
 * an eye on progress. Collapsed state: a small circular gauge (react-native
 * -svg ring, percentage in the middle). Tapping expands a status panel with
 * the exact counts ("X / Y emails scanned"), the leg k/N, the current
 * mailbox, staged/imported counters, and any per-mailbox errors (I3: scan
 * errors ride the store, so they surface here without an Alert).
 *
 * pointerEvents="box-none" on the wrapper — the overlay never blocks touches
 * to the app underneath; only the bubble/panel themselves are interactive.
 * Deep-only by design: normal scans keep the J3 Home pill (they are short).
 */

import { useBottomClearance } from "@/hooks/useBottomClearance";
import { useScanProgress } from "@/hooks/useScanProgress";
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

const BUBBLE_SIZE = 64;
const RING_STROKE = 6;
const RING_RADIUS = (BUBBLE_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function formatCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function DeepScanBubble() {
  const progress = useScanProgress();
  const [expanded, setExpanded] = useState(false);
  const { tabListPadding } = useBottomClearance();

  if (!progress.active || !progress.deep) return null;

  const listed = progress.listed;
  const total = progress.listedTotal;
  const ratio = total != null && total > 0 ? Math.min(1, listed / total) : null;
  const mailbox = progress.mailboxId
    ? progress.mailboxId.includes(":")
      ? progress.mailboxId.slice(progress.mailboxId.indexOf(":") + 1)
      : progress.mailboxId
    : null;

  return (
    <View pointerEvents="box-none" className="absolute inset-0">
      {expanded && (
        <View
          className="absolute rounded-2xl border border-border bg-background p-4 shadow-lg"
          style={{
            right: 16,
            bottom: tabListPadding + 96 + BUBBLE_SIZE + 8,
            width: 280,
          }}
        >
          <Text className="text-base font-sans-bold text-primary">
            Deep re-list
          </Text>
          <Text className="mt-1 text-sm font-sans-medium text-primary">
            {total != null
              ? `${listed.toLocaleString()} / ${total.toLocaleString()} emails scanned`
              : `${listed.toLocaleString()} emails scanned`}
          </Text>
          <Text className="mt-1 text-xs font-sans-medium text-muted-foreground">
            {`Leg ${progress.legIndex + 1}/${progress.legTotal}`}
            {mailbox ? ` · ${mailbox}` : ""}
            {` · staged ${progress.staged}`}
            {progress.imported > 0 ? ` · imported ${progress.imported}` : ""}
          </Text>
          {progress.errors.length > 0 && (
            <View className="mt-2">
              {progress.errors.map((line, i) => (
                <Text
                  key={i}
                  className="text-xs font-sans-medium text-red-500"
                >
                  {line}
                </Text>
              ))}
            </View>
          )}
          <Pressable
            accessibilityLabel="Hide deep scan progress"
            accessibilityRole="button"
            className="mt-3 items-center rounded-xl bg-muted py-2"
            onPress={() => setExpanded(false)}
          >
            <Text className="text-sm font-sans-bold text-primary">Hide</Text>
          </Pressable>
        </View>
      )}

      <Pressable
        accessibilityLabel="Deep re-list progress"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        className="absolute items-center justify-center rounded-full bg-background"
        style={{
          width: BUBBLE_SIZE,
          height: BUBBLE_SIZE,
          right: 16,
          bottom: tabListPadding + 96,
          borderWidth: 1,
          borderColor: "rgba(0,0,0,0.08)",
        }}
        onPress={() => setExpanded((v) => !v)}
      >
        <Svg
          width={BUBBLE_SIZE}
          height={BUBBLE_SIZE}
          style={{ position: "absolute" }}
        >
          <Circle
            cx={BUBBLE_SIZE / 2}
            cy={BUBBLE_SIZE / 2}
            r={RING_RADIUS}
            stroke="#E5E7EB"
            strokeWidth={RING_STROKE}
            fill="none"
          />
          {ratio != null && (
            <Circle
              cx={BUBBLE_SIZE / 2}
              cy={BUBBLE_SIZE / 2}
              r={RING_RADIUS}
              stroke="#10B981"
              strokeWidth={RING_STROKE}
              fill="none"
              strokeDasharray={`${RING_CIRCUMFERENCE * ratio} ${RING_CIRCUMFERENCE}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${BUBBLE_SIZE / 2} ${BUBBLE_SIZE / 2})`}
            />
          )}
        </Svg>
        <Text className="text-xs font-sans-bold text-primary">
          {ratio != null
            ? `${Math.round(ratio * 100)}%`
            : formatCompact(listed)}
        </Text>
        {!expanded && (
          <Ionicons
            name="ellipsis-horizontal"
            size={10}
            color="#6B7280"
            style={{ position: "absolute", bottom: 7 }}
          />
        )}
      </Pressable>
    </View>
  );
}