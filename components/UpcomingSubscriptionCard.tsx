import { formatCurrency } from "@/lib/utils";
import React from "react";
import {
  Image,
  ImageSourcePropType,
  Pressable,
  Text,
  View,
} from "react-native";

interface UpcomingSubscriptionCardProps {
  name: string;
  price: number;
  daysLeft: number;
  icon: ImageSourcePropType;
  currency?: string;
  onPress?: () => void;
}

const UpcomingSubscriptionCard = ({
  name,
  price,
  daysLeft,
  icon,
  currency,
  onPress,
}: UpcomingSubscriptionCardProps) => {
  return (
    <Pressable onPress={onPress} className="upcoming-card">
      <View className="upcoming-row">
        <Image source={icon} className="upcoming-icon" />
        <View>
          <Text className="upcoming-price">
            {formatCurrency(price, currency)}
          </Text>
          <Text className="upcoming-meta" numberOfLines={1}>
            {daysLeft > 1 ? `${daysLeft} days left` : `Last day`}
          </Text>
        </View>
      </View>
      <Text className="upcoming-name" numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
};

export default UpcomingSubscriptionCard;
