import { router } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

/**
 * Absorbs the Google mailbox OAuth redirect (R6 pattern): gmail/workspace
 * must return via the reverse-client-ID scheme
 * `com.googleusercontent.apps.<bare>:/oauthredirect` (providers.ts
 * googleRedirectUri — Google's secure-response-handling policy), and the
 * scheme is registered as a MainActivity intent filter. The token exchange
 * is handled by promptOAuth's AuthSession listener; this screen exists only
 * so expo-router does not show "Unmatched route" when the OAuth browser
 * returns to the app. It pops straight back to the Subscriptions tab, where
 * mailbox connection state is displayed.
 */
export default function OAuthRedirect() {
  useEffect(() => {
    router.replace("/(tabs)/subscriptions");
  }, []);
  return <View className="flex-1 bg-background" />;
}
