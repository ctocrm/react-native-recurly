import React, { useEffect } from "react";
import { Text, View } from "react-native";
import { usePostHog } from "posthog-react-native";

const Onboarding = () => {
  const posthog = usePostHog();

  useEffect(() => {
    posthog.capture("onboarding_viewed");
  }, [posthog]);

  return (
    <View>
      <Text>Onboarding</Text>
    </View>
  );
};

export default Onboarding;
