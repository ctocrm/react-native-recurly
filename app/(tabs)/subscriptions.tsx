import ListHeading from "@/components/ListHeading";
import SubscriptionCard from "@/components/SubscriptionCard";
import "@/global.css";
import EditSubscriptionModal from "@/src/components/EditSubscriptionModal";
import SubscriptionIconPickerModal from "@/src/components/SubscriptionIconPickerModal";
import SubscriptionStatsModal from "@/src/components/SubscriptionStatsModal";
import { useSubscriptions } from "@/src/context/SubscriptionContext";
import clsx from "clsx";
import { useLocalSearchParams } from "expo-router";
import { styled } from "nativewind";
import { usePostHog } from "posthog-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";

const SafeAreaView = styled(RNSafeAreaView);

const FILTER_OPTIONS = ["All", "Upcoming"] as const;

const Subscriptions = () => {
  const posthog = usePostHog();
  const { filter: initialFilter } = useLocalSearchParams<{ filter?: string }>();
  const {
    subscriptions,
    updateSubscription,
    deleteSubscription,
    updateSubscriptionStatus,
    getUpcomingSubscriptions,
    refreshSubscriptions,
  } = useSubscriptions();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSubscriptionId, setExpandedSubscriptionId] = useState<
    string | null
  >(null);
  const [activeFilter, setActiveFilter] = useState<string>(
    initialFilter === "upcoming" ? "Upcoming" : "All",
  );
  const [editingSubscription, setEditingSubscription] =
    useState<Subscription | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [statsModalSubscription, setStatsModalSubscription] =
    useState<Subscription | null>(null);
  const [statsModalVisible, setStatsModalVisible] = useState(false);

  // Icon picker state
  const [iconPickerSubscription, setIconPickerSubscription] =
    useState<Subscription | null>(null);
  const [iconPickerVisible, setIconPickerVisible] = useState(false);

  useEffect(() => {
    posthog.capture("subscriptions_viewed");
  }, [posthog]);

  // If navigated with filter=upcoming, switch to Upcoming filter
  useEffect(() => {
    if (initialFilter === "upcoming") {
      setActiveFilter("Upcoming");
    }
  }, [initialFilter]);

  const upcomingIds = useMemo(() => {
    const upcoming = getUpcomingSubscriptions(7);
    return new Set(upcoming.map((u) => u.id));
  }, [getUpcomingSubscriptions]);

  const filteredSubscriptions = useMemo(() => {
    let filtered = subscriptions;

    // Apply filter
    if (activeFilter === "Upcoming") {
      filtered = filtered.filter((sub) => upcomingIds.has(sub.id));
    }

    // Apply search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((sub) => {
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
    }

    return filtered;
  }, [searchQuery, subscriptions, activeFilter, upcomingIds]);

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

  const handleEdit = (sub: Subscription) => {
    setEditingSubscription(sub);
    setEditModalVisible(true);
  };

  const handleSaveEdit = (id: string, data: Partial<Subscription>) => {
    updateSubscription(id, data);
  };

  const handleDelete = (sub: Subscription) => {
    deleteSubscription(sub.id);
  };

  const handleStatusChange = (
    sub: Subscription,
    status: "active" | "paused" | "cancelled",
  ) => {
    updateSubscriptionStatus(sub.id, status);
  };

  const handleViewStats = (sub: Subscription) => {
    setStatsModalSubscription(sub);
    setStatsModalVisible(true);
  };

  // Icon picker handlers
  const handleIconLongPress = (sub: Subscription) => {
    setIconPickerSubscription(sub);
    setIconPickerVisible(true);
  };

  const handleIconChange = () => {
    // Refresh subscriptions to pick up the new icon
    refreshSubscriptions();
  };

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

            {/* Filter chips */}
            <View className="mb-4 flex-row gap-2">
              {FILTER_OPTIONS.map((filter) => (
                <Pressable
                  key={filter}
                  className={clsx(
                    "rounded-full border px-4 py-2",
                    activeFilter === filter
                      ? "border-accent bg-accent/10"
                      : "border-border bg-background",
                  )}
                  onPress={() => {
                    setActiveFilter(filter);
                    posthog.capture("subscriptions_filter_changed", {
                      filter,
                    });
                  }}
                >
                  <Text
                    className={clsx(
                      "text-sm font-sans-semibold",
                      activeFilter === filter
                        ? "text-accent"
                        : "text-muted-foreground",
                    )}
                  >
                    {filter}
                    {filter === "Upcoming" && ` (${upcomingIds.size})`}
                  </Text>
                </Pressable>
              ))}
            </View>

            <ListHeading
              title={
                searchQuery.trim()
                  ? `Results (${filteredSubscriptions.length})`
                  : activeFilter === "Upcoming"
                    ? `Upcoming (${filteredSubscriptions.length})`
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
            onEdit={() => handleEdit(item)}
            onDelete={() => handleDelete(item)}
            onMarkActive={() => handleStatusChange(item, "active")}
            onMarkPaused={() => handleStatusChange(item, "paused")}
            onMarkCancelled={() => handleStatusChange(item, "cancelled")}
            onViewStats={() => handleViewStats(item)}
            onIconLongPress={() => handleIconLongPress(item)}
          />
        )}
        extraData={expandedSubscriptionId}
        ItemSeparatorComponent={() => <View className="h-4" />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text className="home-empty-state">
            {searchQuery.trim()
              ? "No subscriptions match your search."
              : activeFilter === "Upcoming"
                ? "No upcoming subscriptions."
                : "No subscription yet."}
          </Text>
        }
        contentContainerClassName="pb-25"
      />

      {/* Edit Modal */}
      <EditSubscriptionModal
        visible={editModalVisible}
        subscription={editingSubscription}
        onClose={() => {
          setEditModalVisible(false);
          setEditingSubscription(null);
        }}
        onSave={handleSaveEdit}
      />

      {/* Stats Modal */}
      <SubscriptionStatsModal
        visible={statsModalVisible}
        subscription={statsModalSubscription}
        onClose={() => {
          setStatsModalVisible(false);
          setStatsModalSubscription(null);
        }}
        onRenew={(id) => {
          updateSubscription(id, {});
        }}
      />

      {/* Icon Picker Modal */}
      <SubscriptionIconPickerModal
        visible={iconPickerVisible}
        iconKey={iconPickerSubscription?.icon_key ?? null}
        subscriptionIcon={iconPickerSubscription?.icon}
        subscriptionName={iconPickerSubscription?.name ?? ""}
        onClose={() => {
          setIconPickerVisible(false);
          setIconPickerSubscription(null);
        }}
        onIconChange={handleIconChange}
      />
    </SafeAreaView>
  );
};

export default Subscriptions;
