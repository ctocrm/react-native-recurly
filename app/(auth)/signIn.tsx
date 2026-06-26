import { useAuth, useSignIn } from "@clerk/expo";
import { Link, useRouter, type Href } from "expo-router";
import { styled } from "nativewind";
import { usePostHog } from "posthog-react-native";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";

const SafeAreaView = styled(RNSafeAreaView);

const SignIn = () => {
  const { signIn, errors, fetchStatus } = useSignIn();
  const { isSignedIn, signOut } = useAuth();
  const router = useRouter();
  const posthog = usePostHog();

  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  // Validation states
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  // Client-side validation
  const emailValid =
    emailAddress.length === 0 ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress);
  const passwordValid = password.length > 0;
  const formValid =
    emailAddress.length > 0 && password.length > 0 && emailValid;

  const handleSubmit = async () => {
    if (!formValid) return;

    // If already signed in, redirect to the main app
    if (isSignedIn) {
      router.replace("/(tabs)" as Href);
      return;
    }

    posthog.capture("sign_in_form_submitted");

    const { error } = await signIn.password({
      emailAddress,
      password,
    });

    if (error) {
      // Handle "already signed in" error — Clerk's local state is out of sync
      // with the backend. Sign out first, then retry the sign-in.
      if (
        error.code === "api_response_error" &&
        error.message === "You're already signed in."
      ) {
        await signOut();
        // Retry sign-in after clearing the stale session
        const retryResult = await signIn.password({
          emailAddress,
          password,
        });
        if (retryResult.error) {
          console.error("Sign-in failed after session reset", {
            code: retryResult.error.code,
            message: retryResult.error.message,
          });
          return;
        }
        // Fall through to handle the successful sign-in below
      } else {
        console.error("Sign-in failed", {
          code: error.code,
          message: error.message,
        });
        posthog.capture("user_sign_in_failed", {
          error_code: error.code,
          error_message: error.message,
        });
        return;
      }
    }

    if (signIn.status === "complete") {
      await signIn.finalize({
        navigate: ({ session, decorateUrl }) => {
          if (session?.currentTask) {
            console.log(session?.currentTask);
            return;
          }

          posthog.identify(emailAddress, {
            $set: { email: emailAddress },
            $set_once: { first_sign_in_date: new Date().toISOString() },
          });
          posthog.capture("user_signed_in");

          const url = decorateUrl("/(tabs)");
          if (url.startsWith("http")) {
            // Only use window.location on web platform
            if (typeof window !== "undefined" && window.location) {
              window.location.href = url;
            } else {
              // On native, just use router navigation
              router.replace("/(tabs)" as Href);
            }
          } else {
            router.replace(url as Href);
          }
        },
      });
    } else if (signIn.status === "needs_second_factor") {
      console.log("Sign-in needs second factor", {
        status: signIn.status,
      });
    } else if (signIn.status === "needs_client_trust") {
      // Send email code for client trust verification
      const emailCodeFactor = signIn.supportedSecondFactors.find(
        (factor) => factor.strategy === "email_code",
      );

      if (emailCodeFactor) {
        await signIn.mfa.sendEmailCode();
        posthog.capture("sign_in_mfa_code_sent");
      }
    } else {
      console.error("Sign-in attempt not complete", {
        status: signIn.status,
      });
    }
  };

  const handleVerify = async () => {
    await signIn.mfa.verifyEmailCode({ code });

    if (signIn.status === "complete") {
      await signIn.finalize({
        navigate: ({ session, decorateUrl }) => {
          if (session?.currentTask) {
            console.log(session?.currentTask);
            return;
          }

          posthog.identify(emailAddress, {
            $set: { email: emailAddress },
            $set_once: { first_sign_in_date: new Date().toISOString() },
          });
          posthog.capture("user_signed_in");

          const url = decorateUrl("/(tabs)");
          if (url.startsWith("http")) {
            // Only use window.location on web platform
            if (typeof window !== "undefined" && window.location) {
              window.location.href = url;
            } else {
              // On native, just use router navigation
              router.replace("/(tabs)" as Href);
            }
          } else {
            router.replace(url as Href);
          }
        },
      });
    } else {
      console.error("Sign-in verification not complete", {
        status: signIn.status,
      });
    }
  };

  // Show verification screen if client trust is needed
  if (signIn.status === "needs_client_trust") {
    return (
      <SafeAreaView className="auth-safe-area">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="auth-screen"
        >
          <ScrollView
            className="auth-scroll"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="auth-content">
              {/* Branding */}
              <View className="auth-brand-block">
                <View className="auth-logo-wrap">
                  <View className="auth-logo-mark">
                    <Text className="auth-logo-mark-text">R</Text>
                  </View>
                  <View>
                    <Text className="auth-wordmark">Recurrly</Text>
                    <Text className="auth-wordmark-sub">SUBSCRIPTIONS</Text>
                  </View>
                </View>
                <Text className="auth-title">Verify your identity</Text>
                <Text className="auth-subtitle">
                  We sent a verification code to your email
                </Text>
              </View>

              {/* Verification Form */}
              <View className="auth-card">
                <View className="auth-form">
                  <View className="auth-field">
                    <Text className="auth-label">Verification Code</Text>
                    <TextInput
                      className="auth-input"
                      value={code}
                      placeholder="Enter 6-digit code"
                      placeholderTextColor="rgba(0, 0, 0, 0.4)"
                      onChangeText={setCode}
                      keyboardType="number-pad"
                      autoComplete="one-time-code"
                      maxLength={6}
                    />
                    {errors.fields.code && (
                      <Text className="auth-error">
                        {errors.fields.code.message}
                      </Text>
                    )}
                  </View>

                  <Pressable
                    className={`auth-button ${(!code || fetchStatus === "fetching") && "auth-button-disabled"}`}
                    onPress={handleVerify}
                    disabled={!code || fetchStatus === "fetching"}
                  >
                    <Text className="auth-button-text">
                      {fetchStatus === "fetching" ? "Verifying..." : "Verify"}
                    </Text>
                  </Pressable>

                  <Pressable
                    className="auth-secondary-button"
                    onPress={() => {
                      posthog.capture("sign_in_mfa_resend_code");
                      signIn.mfa.sendEmailCode();
                    }}
                    disabled={fetchStatus === "fetching"}
                  >
                    <Text className="auth-secondary-button-text">
                      Resend Code
                    </Text>
                  </Pressable>

                  <Pressable
                    className="auth-secondary-button"
                    onPress={() => {
                      posthog.capture("sign_in_mfa_start_over");
                      signIn.reset();
                    }}
                    disabled={fetchStatus === "fetching"}
                  >
                    <Text className="auth-secondary-button-text">
                      Start Over
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // Main sign-in form
  return (
    <SafeAreaView className="auth-safe-area">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="auth-screen"
      >
        <ScrollView
          className="auth-scroll"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="auth-content">
            {/* Branding */}
            <View className="auth-brand-block">
              <View className="auth-logo-wrap">
                <View className="auth-logo-mark">
                  <Text className="auth-logo-mark-text">R</Text>
                </View>
                <View>
                  <Text className="auth-wordmark">Recurrly</Text>
                  <Text className="auth-wordmark-sub">SUBSCRIPTIONS</Text>
                </View>
              </View>
              <Text className="auth-title">Welcome back</Text>
              <Text className="auth-subtitle">
                Sign in to continue managing your subscriptions
              </Text>
            </View>

            {/* Sign-In Form */}
            <View className="auth-card">
              <View className="auth-form">
                <View className="auth-field">
                  <Text className="auth-label">Email Address</Text>
                  <TextInput
                    className={`auth-input ${emailTouched && !emailValid && "auth-input-error"}`}
                    autoCapitalize="none"
                    value={emailAddress}
                    placeholder="name@example.com"
                    placeholderTextColor="rgba(0, 0, 0, 0.4)"
                    onChangeText={setEmailAddress}
                    onBlur={() => setEmailTouched(true)}
                    keyboardType="email-address"
                    autoComplete="email"
                  />
                  {emailTouched && !emailValid && (
                    <Text className="auth-error">
                      Please enter a valid email address
                    </Text>
                  )}
                  {errors.fields.identifier && (
                    <Text className="auth-error">
                      {errors.fields.identifier.message}
                    </Text>
                  )}
                </View>

                <View className="auth-field">
                  <Text className="auth-label">Password</Text>
                  <TextInput
                    className={`auth-input ${passwordTouched && !passwordValid && "auth-input-error"}`}
                    value={password}
                    placeholder="Enter your password"
                    placeholderTextColor="rgba(0, 0, 0, 0.4)"
                    secureTextEntry
                    onChangeText={setPassword}
                    onBlur={() => setPasswordTouched(true)}
                    autoComplete="password"
                  />
                  {passwordTouched && !passwordValid && (
                    <Text className="auth-error">Password is required</Text>
                  )}
                  {errors.fields.password && (
                    <Text className="auth-error">
                      {errors.fields.password.message}
                    </Text>
                  )}
                </View>

                <Pressable
                  className={`auth-button ${(!formValid || fetchStatus === "fetching") && "auth-button-disabled"}`}
                  onPress={handleSubmit}
                  disabled={!formValid || fetchStatus === "fetching"}
                >
                  <Text className="auth-button-text">
                    {fetchStatus === "fetching" ? "Signing In..." : "Sign In"}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Sign-Up Link */}
            <View className="auth-link-row">
              <Text className="auth-link-copy">{`Don't have an account?`}</Text>
              <Link href="/(auth)/signUp" asChild>
                <Pressable
                  onPress={() => posthog.capture("sign_in_navigate_to_sign_up")}
                >
                  <Text className="auth-link">Create Account</Text>
                </Pressable>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default SignIn;
