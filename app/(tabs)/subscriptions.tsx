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
import {
  getExpiredGraceDays,
  getPreference,
  setPreference,
} from "@/services/database";
import {
  DEFAULT_EXPIRED_GRACE_DAYS as DEFAULT_GRACE,
  subscriptionBucket,
} from "@/services/subscriptionStatus";
import {
  SUBS_SORT_LABELS,
  SUBS_SORT_OPTIONS,
  sortSubscriptions,
  type SubsSort,
} from "@/services/subscriptionOrder";
import "@/global.css";
import { useBottomClearance } from "@/hooks/useBottomClearance";
import { useChargeDisplay } from "@/hooks/useChargeDisplay";
import {
  familyDisplayName,
  familyForName,
  groupByFamily,
} from "@/services/merchantFamily";
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
  // R40-A: persisted sort + persisted default view (Active). The DB read
  // order is already received-evidence DESC, so "recent" is honest from the
  // first frame; the prefs load refines it right after mount.
  const [activeSort, setActiveSort] = useState<SubsSort>("recent");
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

  // R40-A: restore the persisted sort + default view once. An explicit nav
  // filter (Home's "Upcoming" deep-link) wins over the stored view; the
  // stored view defaults to Active on first ever run (R39 spec).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [storedFilter, storedSort] = await Promise.all([
          getPreference("subs_default_filter"),
          getPreference("subs_sort"),
        ]);
        if (cancelled) return;
        if (!initialFilter) {
          const view =
            storedFilter &&
            (FILTER_OPTIONS as readonly string[]).includes(storedFilter)
              ? storedFilter
              : "Active";
          setActiveFilter(view);
        }
        if (
          storedSort &&
          (SUBS_SORT_OPTIONS as readonly string[]).includes(storedSort)
        ) {
          setActiveSort(storedSort as SubsSort);
        }
      } catch {
        // defaults stand: recent sort, Active view (nav-dependent)
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterChange = (filter: string) => {
    setActiveFilter(filter);
    // Persisted default view: the app reopens where the user left it.
    setPreference("subs_default_filter", filter).catch(() => {});
    posthog.capture("subscriptions_filter_changed", { filter });
  };

  const handleSortChange = (sort: SubsSort) => {
    setActiveSort(sort);
    setPreference("subs_sort", sort).catch(() => {});
    posthog.capture("subscriptions_sort_changed", { sort });
  };

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

    // R40-A: the five-sort spec. Applied before family grouping so a
    // merchant family card takes its front member's position.
    filtered = sortSubscriptions(filtered, activeSort);

    // R36: one card per merchant family (Amazon shape) — the recurring
    // member fronts the card, the family's sparse actuals stack under it.
    return groupByFamily(filtered);
  }, [
    searchQuery,
    subscriptions,
    activeFilter,
    activeSort,
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
                  onPress={() => handleFilterChange(filter)}
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

            {/* Sort chips (R40-A): most-recent received / oldest / sparse /
                recurring / next charge. Visible options, persisted choice. */}
            <View className="mb-4 flex-row flex-wrap gap-2">
              {SUBS_SORT_OPTIONS.map((sort) => (
                <Pressable
                  key={sort}
                  className={clsx(
                    "rounded-full border px-3 py-1.5",
                    activeSort === sort
                      ? "border-accent bg-accent/10"
                      : "border-border bg-background",
                  )}
                  onPress={() => handleSortChange(sort)}
                  accessibilityLabel={`Sort by ${SUBS_SORT_LABELS[sort]}`}
                  accessibilityRole="button"
                >
                  <Text
                    className={clsx(
                      "text-xs font-sans-semibold",
                      activeSort === sort
                        ? "text-accent"
                        : "text-muted-foreground",
                    )}
                  >
                    {SUBS_SORT_LABELS[sort]}
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
        keyExtractor={(item) => item.primary.id}
        renderItem={({ item }) => (
          <SubscriptionCard
            {...item.primary}
            graceDays={graceDays}
            expanded={expandedSubscriptionId === item.primary.id}
            displayPrice={displayFor(item.primary).amount}
            displayUnknown={displayFor(item.primary).unknown}
            displayPeriodLabel={displayFor(item.primary).label}
            onCyclePeriod={() => cyclePeriod(item.primary)}
            sparseLine={sparseLineFor(item.primary)}
            lapsed={lapseFor(item.primary, graceDays)}
            familyTitle={
              item.members.length > 1
                ? familyDisplayName(familyForName(item.primary.name) ?? "")
                : undefined
            }
            familyMembers={
              item.members.length > 1
                ? item.members
                    .filter((m) => m.id !== item.primary.id)
                    .map((m) => m.name)
                : undefined
            }
            onPress={() => {
              const isExpanding = expandedSubscriptionId !== item.primary.id;
              setExpandedSubscriptionId((currentId) =>
                currentId === item.primary.id ? null : item.primary.id,
              );
              posthog.capture(
                isExpanding
                  ? "subscription_card_expanded"
                  : "subscription_card_collapsed",
                {
                  subscription_id: item.primary.id,
                  subscription_name: item.primary.name,
                  subscription_category: item.primary.category ?? "",
                  billing_cycle: item.primary.billing,
                },
              );
            }}
            onEdit={() => handleEdit(item.primary)}
            onDelete={() => handleDelete(item.primary)}
            onMarkActive={() => handleStatusChange(item.primary, "active")}
            onMarkPaused={() => handleStatusChange(item.primary, "paused")}
            onMarkCancelled={() =>
              handleStatusChange(item.primary, "cancelled")
            }
            onViewStats={() => handleViewStats(item.primary)}
            onViewDetails={() => setDetailsSubscription(item.primary)}
            onIconLongPress={() => handleIconLongPress(item.primary)}
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
