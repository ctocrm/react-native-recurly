import ListHeading from "@/components/ListHeading";
import SubscriptionCard from "@/components/SubscriptionCard";
import "@/global.css";
import { useSubscriptions } from "@/src/context/SubscriptionContext";
import { styled } from "nativewind";
import { usePostHog } from "posthog-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";

const SafeAreaView = styled(RNSafeAreaView);

const Subscriptions = () => {
  const posthog = usePostHog();
  const { subscriptions } = useSubscriptions();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSubscriptionId, setExpandedSubscriptionId] = useState<
    string | null
  >(null);

  useEffect(() => {
    posthog.capture("subscriptions_viewed");
  }, [posthog]);

  const filteredSubscriptions = useMemo(() => {
    if (!searchQuery.trim()) return subscriptions;

    const query = searchQuery.toLowerCase().trim();
    return subscriptions.filter((sub) => {
      const searchableFields = [
        sub.name,
        sub.category,
        sub.plan,
        sub.paymentMethod,
      ];
      return searchableFields.some(
        (field) => field && field.toLowerCase().includes(query),
      );
    });
  }, [searchQuery]);

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
  };

  useEffect(() => {
    if (searchQuery.trim()) {
      posthog.capture("subscriptions_search", {
        query_length: searchQuery.trim().length,
        results_count: filteredSubscriptions.length,
      });
    }
  }, [searchQuery, filteredSubscriptions.length, posthog]);

  return (
    <SafeAreaView className="flex-1 bg-background p-5">
      <FlatList
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <>
            <View className="mb-5">
              <TextInput
                className="rounded-2xl border border-border bg-card px-4 py-4 text-base font-sans-medium text-primary"
                placeholder="Search subscriptions..."
                placeholderTextColor="rgba(0, 0, 0, 0.4)"
                value={searchQuery}
                onChangeText={handleSearchChange}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <ListHeading
              title={
                searchQuery.trim()
                  ? `Results (${filteredSubscriptions.length})`
                  : "All Subscriptions"
              }
            />
          </>
        }
        data={filteredSubscriptions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SubscriptionCard
            {...item}
            expanded={expandedSubscriptionId === item.id}
            onPress={() => {
              const isExpanding = expandedSubscriptionId !== item.id;
              setExpandedSubscriptionId((currentId) =>
                currentId === item.id ? null : item.id,
              );
              posthog.capture(
                isExpanding
                  ? "subscription_card_expanded"
                  : "subscription_card_collapsed",
                {
                  subscription_id: item.id,
                  subscription_name: item.name,
                  subscription_category: item.category ?? "",
                  billing_cycle: item.billing,
                },
              );
            }}
          />
        )}
        extraData={expandedSubscriptionId}
        ItemSeparatorComponent={() => <View className="h-4" />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text className="home-empty-state">
            {searchQuery.trim()
              ? "No subscriptions match your search."
              : "No subscription yet."}
          </Text>
        }
        contentContainerClassName="pb-25"
      />
    </SafeAreaView>
  );
};

export default Subscriptions;
