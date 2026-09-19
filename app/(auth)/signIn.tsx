import { useAuth } from "@/context/AuthContext";
import { useRouter, type Href } from "expo-router";
import { styled } from "nativewind";
import { usePostHog } from "posthog-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";

const SafeAreaView = styled(RNSafeAreaView);

const SignIn = () => {
  const { isSignedIn, signInLocal } = useAuth();
  const router = useRouter();
  const posthog = usePostHog();
  const [busy, setBusy] = useState(false);

  const handleContinue = async () => {
    if (busy) return;
    if (isSignedIn) {
      router.replace("/(tabs)" as Href);
      return;
    }
    setBusy(true);
    try {
      posthog.capture("sign_in_form_submitted");
      await signInLocal();
      posthog.identify("local", {
        $set: { auth: "local_mock" },
        $set_once: { first_seen_date: new Date().toISOString() },
      });
      posthog.capture("user_signed_in", { method: "local_mock" });
      router.replace("/(tabs)" as Href);
    } catch (error) {
      console.error("Local sign-in failed", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <View className="flex-1 justify-center px-6">
        <View className="mb-10">
          <Text className="auth-title">Cadence</Text>
          <Text className="auth-subtitle">
            Continue locally. No account service until the product backend
            ships.
          </Text>
        </View>
        <View className="auth-card">
          <Pressable
            className={`auth-button ${busy ? "auth-button-disabled" : ""}`}
            onPress={handleContinue}
            disabled={busy}
          >
            <Text className="auth-button-text">
              {busy ? "Continuing..." : "Continue"}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
};

export default SignIn;
