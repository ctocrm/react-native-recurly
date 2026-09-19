import { router } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

/**
 * Absorbs the `cadence://auth` OAuth redirect (R6). The token exchange is
 * handled by promptOAuth's AuthSession listener — this screen exists only so
 * expo-router does not show "Unmatched route" when the OAuth browser returns
 * to the app. It pops straight back to the Subscriptions tab, where mailbox
 * connection state is displayed.
 */
export default function AuthRedirect() {
  useEffect(() => {
    router.replace("/(tabs)/subscriptions");
  }, []);
  return <View className="flex-1 bg-background" />;
}
