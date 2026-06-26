import { Link, useLocalSearchParams } from "expo-router";
import React, { useEffect } from "react";
import { Text, View } from "react-native";
import { usePostHog } from "posthog-react-native";

const SubscriptionsDetails = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const posthog = usePostHog();

  useEffect(() => {
    if (id) {
      posthog.capture("subscription_detail_viewed", { subscription_id: id });
    }
  }, [id, posthog]);

  return (
    <View>
      <Text>SubscriptionsDetails: {id}</Text>
      <Link href="/">Go back</Link>
    </View>
  );
};

export default SubscriptionsDetails;
