import CreateSubscriptionModal from "@/components/CreateSubscriptionModal";
import EditSubscriptionModal from "@/components/EditSubscriptionModal";
import EmailScanSection from "@/components/EmailScanSection";
import ListHeading from "@/components/ListHeading";
import SubscriptionCard from "@/components/SubscriptionCard";
import SubscriptionDetailsModal from "@/components/SubscriptionDetailsModal";
import SubscriptionIconPickerModal from "@/components/SubscriptionIconPickerModal";
import SubscriptionStatsModal from "@/components/SubscriptionStatsModal";
import { icons } from "@/constants/icons";
import { useSubscriptions } from "@/context/SubscriptionContext";
import { getExpiredGraceDays } from "@/services/database";
import {
  DEFAULT_EXPIRED_GRACE_DAYS as DEFAULT_GRACE,
  subscriptionBucket,
} from "@/services/subscriptionStatus";
import "@/global.css";
import { useBottomClearance } from "@/hooks/useBottomClearance";
import { useChargeDisplay } from "@/hooks/useChargeDisplay";
import clsx from "clsx";
import { useLocalSearchParams } from "expo-router";
import { styled } from "nativewind";
import { usePostHog } from "posthog-react-native";
import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";

const SafeAreaView = styled(RNSafeAreaView);

const FILTER_OPTIONS = [
  "All",
  "Active",
  "Upcoming",
  "Sparse",
  "Expired",
] as const;

const Subscriptions = () => {
  const { tabListPadding, pagePadding } = useBottomClearance();
  const posthog = usePostHog();
  // Phase N: the may-have-expired grace period (user-configurable in
  // Settings); re-read on foreground so a Settings change applies on return.
  const [graceDays, setGraceDays] = useState(DEFAULT_GRACE);
  const { filter: initialFilter, addMailbox } = useLocalSearchParams<{
    filter?: string;
    addMailbox?: string;
  }>();
  const {
    subscriptions,
    addSubscription,
    updateSubscription,
    deleteSubscription,
    updateSubscriptionStatus,
    getUpcomingSubscriptions,
    refreshSubscriptions,
  } = useSubscriptions();
  const { displayFor, sparseLineFor, cyclePeriod, lapseFor } =
    useChargeDisplay(subscriptions);
  const [detailsSubscription, setDetailsSubscription] =
    useState<Subscription | null>(null);
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
  const [createModalVisible, setCreateModalVisible] = useState(false);

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

  const expiredCount = useMemo(() => {
    return subscriptions.filter(
      (sub) => subscriptionBucket(sub, graceDays) === "expired",
    ).length;
  }, [subscriptions, graceDays]);

  useEffect(() => {
    getExpiredGraceDays()
      .then(setGraceDays)
      .catch(() => setGraceDays(DEFAULT_GRACE));
  }, []);

  const filteredSubscriptions = useMemo(() => {
    let filtered = subscriptions;

    // Apply filter (Phase N buckets)
    if (activeFilter === "Upcoming") {
      filtered = filtered.filter((sub) => upcomingIds.has(sub.id));
    } else if (activeFilter === "Active") {
      filtered = filtered.filter(
        (sub) =>
          subscriptionBucket(sub, graceDays) === "active" &&
          !lapseFor(sub, graceDays),
      );
    } else if (activeFilter === "Sparse") {
      filtered = filtered.filter(
        (sub) => subscriptionBucket(sub, graceDays) === "sparse",
      );
    } else if (activeFilter === "Expired") {
      filtered = filtered.filter(
        (sub) =>
          subscriptionBucket(sub, graceDays) === "expired" ||
          lapseFor(sub, graceDays),
      );
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
  }, [
    searchQuery,
    subscriptions,
    activeFilter,
    upcomingIds,
    graceDays,
    lapseFor,
  ]);

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

  const handleAddSubscriptionTap = () => {
    posthog.capture("subscriptions_add_subscription_tapped");
    setCreateModalVisible(true);
  };

  const handleCreateSubscription = async (subscription: Subscription) => {
    await addSubscription(subscription);
  };

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      className="flex-1 bg-background px-5 pt-5"
      style={{ paddingBottom: pagePadding }}
    >
      <FlatList
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <>
            <View className="mb-5 flex-row items-center justify-between">
              <Text className="text-3xl font-sans-bold text-primary">
                Subscriptions
              </Text>
              <Pressable
                onPress={handleAddSubscriptionTap}
                accessibilityLabel="Add subscription"
                accessibilityRole="button"
              >
                <Image source={icons.add} className="home-add-icon" />
              </Pressable>
            </View>
            <EmailScanSection openAddOnMount={addMailbox === "1"} />
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
                    {filter === "Expired" && ` (${expiredCount})`}
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
            graceDays={graceDays}
            expanded={expandedSubscriptionId === item.id}
            displayPrice={displayFor(item).amount}
            displayUnknown={displayFor(item).unknown}
            displayPeriodLabel={displayFor(item).label}
            onCyclePeriod={() => cyclePeriod(item)}
            sparseLine={sparseLineFor(item)}
            lapsed={lapseFor(item, graceDays)}
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
            onViewDetails={() => setDetailsSubscription(item)}
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
        contentContainerStyle={{ paddingBottom: tabListPadding }}
      />

      <CreateSubscriptionModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onCreate={handleCreateSubscription}
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

      {/* Details Modal (R18) */}
      <SubscriptionDetailsModal
        visible={detailsSubscription !== null}
        subscription={detailsSubscription}
        onClose={() => setDetailsSubscription(null)}
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
