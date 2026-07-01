import { formatCurrency } from "@/lib/utils";
import dayjs from "dayjs";
import React from "react";
import { Image, Modal, Pressable, Text, View } from "react-native";

interface SubscriptionStatsModalProps {
  visible: boolean;
  subscription: Subscription | null;
  onClose: () => void;
  onRenew: (id: string) => void;
}

const SubscriptionStatsModal = ({
  visible,
  subscription,
  onClose,
  onRenew,
}: SubscriptionStatsModalProps) => {
  if (!subscription) return null;

  const now = dayjs();
  const startDate = subscription.startDate
    ? dayjs(subscription.startDate)
    : null;
  const renewalDate = subscription.renewalDate
    ? dayjs(subscription.renewalDate)
    : null;

  // Calculate days remaining
  const daysRemaining = renewalDate ? renewalDate.diff(now, "day") : null;

  // Calculate total billing period length in days
  const billingPeriodDays =
    startDate && renewalDate
      ? renewalDate.diff(startDate, "day")
      : subscription.billing === "Yearly"
        ? 365
        : 30;

  // Calculate days elapsed in current period
  const periodStart = renewalDate
    ? renewalDate.subtract(billingPeriodDays, "day")
    : startDate || now;
  const daysElapsedInPeriod = now.diff(periodStart, "day");
  const progressPercent = Math.min(
    Math.max((daysElapsedInPeriod / billingPeriodDays) * 100, 0),
    100,
  );

  // Calculate months since start and total spent
  const monthsSinceStart = startDate
    ? Math.max(now.diff(startDate, "month"), 0)
    : 0;
  const monthlyCost =
    subscription.billing === "Yearly" || subscription.frequency === "Yearly"
      ? subscription.price / 12
      : subscription.price;
  const totalSpentToDate = monthlyCost * (monthsSinceStart || 1);

  // Calculate days left display
  const daysLeftDisplay =
    daysRemaining !== null
      ? daysRemaining > 0
        ? `${daysRemaining} days remaining`
        : daysRemaining === 0
          ? "Due today!"
          : `Overdue by ${Math.abs(daysRemaining)} days`
      : "Unknown";

  const isOverdue = daysRemaining !== null && daysRemaining < 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/50" onPress={onClose}>
        <Pressable
          className="mt-auto rounded-t-3xl bg-background p-5"
          onPress={(e) => e.stopPropagation()}
        >
          {/* Handle */}
          <View className="mb-4 items-center">
            <View className="h-1 w-12 rounded-full bg-muted-foreground/30" />
          </View>

          {/* Header with icon */}
          <View className="mb-6 items-center">
            <Image
              source={subscription.icon}
              className="mb-3 size-20 rounded-2xl"
            />
            <Text className="text-2xl font-sans-bold text-primary">
              {subscription.name}
            </Text>
            {subscription.plan && (
              <Text className="mt-1 text-sm font-sans-medium text-muted-foreground">
                {subscription.plan}
              </Text>
            )}
          </View>

          {/* Main stat — days remaining */}
          <View
            className="mb-5 items-center rounded-2xl p-6"
            style={{
              backgroundColor: isOverdue ? "#fee2e2" : "#f6eecf",
            }}
          >
            <Text
              className={`text-5xl font-sans-extrabold ${
                isOverdue ? "text-destructive" : "text-primary"
              }`}
            >
              {daysRemaining !== null ? daysRemaining : "—"}
            </Text>
            <Text className="mt-1 text-base font-sans-semibold text-muted-foreground">
              {daysLeftDisplay}
            </Text>
          </View>

          {/* Progress bar */}
          <View className="mb-5">
            <View className="mb-1 flex-row justify-between">
              <Text className="text-xs font-sans-medium text-muted-foreground">
                Billing cycle progress
              </Text>
              <Text className="text-xs font-sans-medium text-muted-foreground">
                {Math.round(progressPercent)}%
              </Text>
            </View>
            <View className="h-3 overflow-hidden rounded-full bg-muted">
              <View
                className="h-full rounded-full bg-accent"
                style={{ width: `${progressPercent}%` }}
              />
            </View>
          </View>

          {/* Stats details */}
          <View className="mb-5 rounded-2xl border border-border bg-card p-4">
            <View className="mb-3 flex-row justify-between">
              <Text className="text-sm font-sans-medium text-muted-foreground">
                Next Renewal
              </Text>
              <Text className="text-sm font-sans-bold text-primary">
                {renewalDate ? renewalDate.format("MMM D, YYYY") : "Not set"}
              </Text>
            </View>

            <View className="mb-3 flex-row justify-between">
              <Text className="text-sm font-sans-medium text-muted-foreground">
                Price
              </Text>
              <Text className="text-sm font-sans-bold text-primary">
                {formatCurrency(subscription.price, subscription.currency)} /{" "}
                {subscription.billing?.toLowerCase?.() || "mo"}
              </Text>
            </View>

            <View className="mb-3 flex-row justify-between">
              <Text className="text-sm font-sans-medium text-muted-foreground">
                Total Spent
              </Text>
              <Text className="text-sm font-sans-bold text-primary">
                {formatCurrency(totalSpentToDate, subscription.currency)}
              </Text>
            </View>

            <View className="mb-3 flex-row justify-between">
              <Text className="text-sm font-sans-medium text-muted-foreground">
                Started
              </Text>
              <Text className="text-sm font-sans-bold text-primary">
                {startDate ? startDate.format("MMM D, YYYY") : "Not set"}
              </Text>
            </View>

            <View className="flex-row justify-between">
              <Text className="text-sm font-sans-medium text-muted-foreground">
                Status
              </Text>
              <Text className="text-sm font-sans-bold text-primary">
                {subscription.status
                  ? subscription.status.charAt(0).toUpperCase() +
                    subscription.status.slice(1)
                  : "Active"}
              </Text>
            </View>
          </View>

          {/* Renew Now button */}
          {(isOverdue || daysRemaining === 0) &&
            subscription.status !== "cancelled" && (
              <Pressable
                className="mb-3 items-center rounded-2xl bg-accent py-4"
                onPress={() => onRenew(subscription.id)}
              >
                <Text className="text-base font-sans-bold text-primary">
                  Renew Now
                </Text>
              </Pressable>
            )}

          {/* Close */}
          <Pressable
            className="items-center rounded-2xl bg-muted py-4"
            onPress={onClose}
          >
            <Text className="text-base font-sans-bold text-primary">Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default SubscriptionStatsModal;
