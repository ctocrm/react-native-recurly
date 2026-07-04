import {
  formatCurrency,
  formatStatusLabel,
  formatSubscriptionDateTime,
} from "@/lib/utils";
import { useCachedIcon } from "@/src/hooks/useCachedIcon";
import clsx from "clsx";
import React, { useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import SubscriptionCardMenu from "./SubscriptionCardMenu";

interface SubscriptionCardProps {
  id: string;
  icon: any;
  icon_key?: string;
  name: string;
  price: number;
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
  onIconLongPress?: () => void;
}

const SubscriptionCard = ({
  id,
  name,
  price,
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
  onIconLongPress,
}: SubscriptionCardProps) => {
  const [menuVisible, setMenuVisible] = useState(false);
  const { status: iconStatus, iconUri } = useCachedIcon(icon_key);

  // Use cached icon if available, otherwise use default icon prop
  const displayIcon = iconUri ? { uri: iconUri } : icon;

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
              {/* Loading indicator - shows when icon is being fetched */}
              {iconStatus === "loading" && (
                <View className="absolute inset-0 items-center justify-center">
                  <ActivityIndicator size="small" />
                </View>
              )}
              {/* Icon image - long press will trigger picker */}
              <Image source={displayIcon} className="sub-icon" />
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
            </View>
          </View>

          <View className="sub-price-box">
            <Text className="sub-price">{formatCurrency(price, currency)}</Text>
            <Text className="sub-billing">{billing}</Text>
          </View>
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
      />
    </>
  );
};
export default SubscriptionCard;
