import {
  formatCurrency,
  formatStatusLabel,
  formatSubscriptionDateTime,
} from "@/lib/utils";
import clsx from "clsx";
import React, { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import SubscriptionCardMenu from "./SubscriptionCardMenu";

const SubscriptionCard = ({
  name,
  price,
  currency,
  icon,
  billing,
  color,
  category,
  plan,
  renewalDate,
  expanded,
  onPress,
  paymentMethod,
  startDate,
  status,
  onEdit,
  onDelete,
  onMarkActive,
  onMarkPaused,
  onMarkCancelled,
  onViewStats,
  id,
}: SubscriptionCardProps) => {
  const [menuVisible, setMenuVisible] = useState(false);

  return (
    <>
      <Pressable
        onPress={onPress}
        className={clsx("sub-card", expanded ? "sub-card-expanded" : "bg-card")}
        style={!expanded && color ? { backgroundColor: color } : undefined}
      >
        <View className="sub-head">
          <View className="sub-main">
            <Image source={icon} className="sub-icon" />
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
          <View className="sub-bdy">
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
