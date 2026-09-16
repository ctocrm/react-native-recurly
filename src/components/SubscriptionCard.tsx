import { useCachedIcon } from "@/hooks/useCachedIcon";
import {
  formatCurrency,
  formatStatusLabel,
  formatSubscriptionDateTime,
} from "@/lib/utils";
import clsx from "clsx";
import React, { useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { icons } from "@/constants/icons";
import { NoThumbnail } from "@/components/NoThumbnail";
import { isMayHaveExpired } from "@/services/subscriptionStatus";
import SubscriptionCardMenu from "./SubscriptionCardMenu";

interface SubscriptionCardProps {
  id: string;
  icon: any;
  icon_key?: string;
  name: string;
  price: number;
  priceUnknown?: boolean;
  currency?: string;
  billing: string;
  category?: string;
  plan?: string;
  renewalDate?: string;
  status?: string;
  paymentMethod?: string;
  startDate?: string;
  expanded: boolean;
  color?: string;
  onPress: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onMarkActive?: () => void;
  onMarkPaused?: () => void;
  onMarkCancelled?: () => void;
  onViewStats?: () => void;
  onViewDetails?: () => void;
  onIconLongPress?: () => void;
  displayPrice?: number;
  displayUnknown?: boolean;
  displayPeriodLabel?: string;
  sparseLine?: { amount: number; label: string } | null;
  onCyclePeriod?: () => void;
  /** Phase N: grace period (days) for the may-have-expired chip. */
  graceDays?: number;
}

const SubscriptionCard = ({
  id,
  name,
  price,
  priceUnknown,
  currency,
  icon,
  icon_key,
  billing,
  color,
  category,
  plan,
  renewalDate,
  expanded,
  paymentMethod,
  startDate,
  status,
  onPress,
  onEdit,
  onDelete,
  onMarkActive,
  onMarkPaused,
  onMarkCancelled,
  onViewStats,
  onViewDetails,
  onIconLongPress,
  displayPrice,
  displayUnknown,
  displayPeriodLabel,
  sparseLine,
  onCyclePeriod,
  graceDays,
}: SubscriptionCardProps) => {
  const [menuVisible, setMenuVisible] = useState(false);
  const { status: iconStatus, iconUri } = useCachedIcon(icon_key);

  // Determine which icon to display
  // Priority: cached web icon > static icon asset from subscription
  const renderIcon = () => {
    // Loading state (crawl in progress)
    if (iconStatus === "loading") {
      return (
        <View className="size-16 items-center justify-center rounded-xl border-2 border-border bg-card">
          <ActivityIndicator size="small" />
        </View>
      );
    }

    // Cached icon from web crawl (take priority)
    if (iconStatus === "cached" && iconUri) {
      return (
        <Image
          source={{ uri: iconUri }}
          className="size-16 rounded-xl"
          resizeMode="contain"
        />
      );
    }

    // No cached icon available - use the static icon asset, UNLESS it is
    // the plus.png default (no icon chosen/acquired): Phase O renders a
    // muted no-thumbnail glyph instead of a plus image.
    if (icon === icons.plus) {
      return <NoThumbnail size={64} />;
    }
    return <Image source={icon} className="size-16 rounded-xl" />;
  };

  // Phase N: may-have-expired — the renewal lapsed past the grace period
  // while the row is still active. Deliberately non-destructive.
  const mayHaveExpired =
    status !== "paused" &&
    status !== "cancelled" &&
    isMayHaveExpired(renewalDate, graceDays ?? 7);

  return (
    <>
      <Pressable
        onPress={onPress}
        className={clsx("sub-card", expanded ? "sub-card-expanded" : "bg-card")}
        style={!expanded && color ? { backgroundColor: color } : undefined}
      >
        <View className="sub-head">
          <View className="sub-main">
            <View className="relative">
              {/* Icon */}
              {renderIcon()}
              {/* Transparent overlay for icon long press detection */}
              <Pressable
                onLongPress={onIconLongPress}
                delayLongPress={300}
                className="absolute left-0 top-0 size-16"
                style={{ backgroundColor: "transparent" }}
              />
            </View>
            <View className="sub-copy">
              <Text numberOfLines={1} className="sub-title">
                {name}
              </Text>
              <Text numberOfLines={1} ellipsizeMode="tail" className="sub-meta">
                {category?.trim() ||
                  plan?.trim() ||
                  (renewalDate ? formatSubscriptionDateTime(renewalDate) : "")}
              </Text>
              {mayHaveExpired ? (
                <View className="self-start rounded-full bg-destructive/10 px-2 py-0.5 mt-1">
                  <Text className="text-destructive text-xs font-sans-medium">
                    May have expired
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <Pressable
            className="sub-price-box"
            onPress={(e) => {
              e.stopPropagation();
              onCyclePeriod?.();
            }}
            disabled={!onCyclePeriod}
          >
            <Text className="sub-price">
              {formatCurrency(
                displayPrice ?? price,
                currency,
                displayUnknown ?? priceUnknown,
              )}
            </Text>
            <Text className="sub-billing">
              {displayPeriodLabel ?? billing}
            </Text>
            {/* R18: stacked second line — this month's sparse purchases for
                this merchant; hidden entirely when there is none. */}
            {sparseLine ? (
              <Text className="sub-billing">
                +{formatCurrency(sparseLine.amount, currency, false)}{" "}
                {sparseLine.label}
              </Text>
            ) : null}
          </Pressable>
        </View>

        {/* "..." menu button */}
        <Pressable
          className="absolute right-4 top-4 z-10 size-8 items-center justify-center rounded-full bg-black/5"
          onPress={(e) => {
            e.stopPropagation();
            setMenuVisible(true);
          }}
        >
          <Text className="text-lg font-sans-bold text-primary">•••</Text>
        </Pressable>

        {expanded && (
          <View className="sub-body">
            <View className="sub-details">
              <View className="sub-row">
                <View className="sub-row-copy">
                  <Text className="sub-label">Payment:</Text>
                  <Text
                    className="sub-value"
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {paymentMethod?.trim() ?? "Not provided"}
                  </Text>
                </View>
              </View>
              <View className="sub-row">
                <View className="sub-row-copy">
                  <Text className="sub-label">Category:</Text>
                  <Text
                    className="sub-value"
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {(category?.trim() || plan?.trim()) ?? "Not provided"}
                  </Text>
                </View>
              </View>
              <View className="sub-row">
                <View className="sub-row-copy">
                  <Text className="sub-label">Started:</Text>
                  <Text
                    className="sub-value"
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {startDate
                      ? formatSubscriptionDateTime(startDate)
                      : "Not provided"}
                  </Text>
                </View>
              </View>
              <View className="sub-row">
                <View className="sub-row-copy">
                  <Text className="sub-label">Renewal date:</Text>
                  <Text
                    className="sub-value"
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {renewalDate
                      ? formatSubscriptionDateTime(renewalDate)
                      : "Not provided"}
                  </Text>
                </View>
              </View>
              <View className="sub-row">
                <View className="sub-row-copy">
                  <Text className="sub-label">Status:</Text>
                  <Text
                    className="sub-value"
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {status ? formatStatusLabel(status) : "Not provided"}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}
      </Pressable>

      <SubscriptionCardMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        status={status}
        onEdit={() => onEdit?.()}
        onMarkActive={() => onMarkActive?.()}
        onMarkPaused={() => onMarkPaused?.()}
        onMarkCancelled={() => onMarkCancelled?.()}
        onDelete={() => onDelete?.()}
        onViewStats={() => onViewStats?.()}
        onDetails={() => onViewDetails?.()}
      />
    </>
  );
};
export default SubscriptionCard;
