import { tabs } from "@/constants/data";
import { colors, components } from "@/constants/theme";
import HiddenSearchWebView from "@/src/components/HiddenSearchWebView";
import { posthog } from "@/src/config/posthog";
import { CloudSyncProvider } from "@/src/context/CloudSyncContext";
import { DatabaseProvider } from "@/src/context/DatabaseProvider";
import { SubscriptionProvider } from "@/src/context/SubscriptionContext";

import { useAuth, useUser } from "@clerk/expo";
import clsx from "clsx";
import { Redirect, Tabs } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const tabBar = components.tabBar;

interface TabIconProps {
  focused: boolean;
  icon: any; // Static imports return number (require) or ImageSourcePropType
}

const TabIcon = ({ focused, icon }: TabIconProps) => {
  return (
    <View className={clsx("tabs-pill", focused && "tabs-active")}>
      <Image source={icon} resizeMode="contain" className="tabs-glyph" />
    </View>
  );
};

const TabLayout = () => {
  const { isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();
  const insets = useSafeAreaInsets();
  const hasIdentified = useRef(false);

  // Identify returning users whose session is restored from Clerk's token cache
  useEffect(() => {
    if (isLoaded && isSignedIn && user && !hasIdentified.current) {
      const email = user.primaryEmailAddress?.emailAddress;
      if (email) {
        posthog.identify(email, {
          $set: { email, name: user.fullName },
          $set_once: { first_seen_date: new Date().toISOString() },
        });
        hasIdentified.current = true;
      }
    }
  }, [isLoaded, isSignedIn, user]);

  if (!isLoaded) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (!isSignedIn) {
    return <Redirect href={"/(auth)/signIn"} />;
  }

  return (
    <DatabaseProvider>
      <SubscriptionProvider>
        <CloudSyncProvider>
          {/* Hidden WebView for background scraping - bypasses anti-bot measures */}
          <HiddenSearchWebView />
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarShowLabel: false,
              tabBarStyle: {
                position: "absolute",
                bottom: Math.max(insets.bottom, tabBar.horizontalInset),
                height: tabBar.height,
                marginHorizontal: tabBar.horizontalInset,
                borderRadius: tabBar.radius,
                backgroundColor: colors.primary,
                borderTopWidth: 0,
                elevation: 0,
              },
              tabBarItemStyle: {
                paddingVertical: tabBar.height / 2 - tabBar.iconFrame / 1.6,
              },
              tabBarIconStyle: {
                width: tabBar.iconFrame,
                height: tabBar.iconFrame,
                alignItems: "center",
              },
            }}
          >
            {tabs.map((tab) => (
              <Tabs.Screen
                key={tab.name}
                name={tab.name}
                options={{
                  title: tab.title,
                  tabBarIcon: ({ focused }) => (
                    <TabIcon focused={focused} icon={tab.icon} />
                  ),
                }}
              />
            ))}
          </Tabs>
        </CloudSyncProvider>
      </SubscriptionProvider>
    </DatabaseProvider>
  );
};

export default TabLayout;
