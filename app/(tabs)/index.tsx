import CreateSubscriptionModal from "@/components/CreateSubscriptionModal";
import EditSubscriptionModal from "@/components/EditSubscriptionModal";
import ListHeading from "@/components/ListHeading";
import SubscriptionCard from "@/components/SubscriptionCard";
import SubscriptionIconPickerModal from "@/components/SubscriptionIconPickerModal";
import SubscriptionStatsModal from "@/components/SubscriptionStatsModal";
import UpcomingSubscriptionCard from "@/components/UpcomingSubscriptionCard";
import UserSettingsModal from "@/components/UserSettingsModal";
import { icons } from "@/constants/icons";
import images from "@/constants/images";
import { useSubscriptions } from "@/context/SubscriptionContext";
import "@/global.css";
import { useBottomClearance } from "@/hooks/useBottomClearance";
import { useChargeDisplay } from "@/hooks/useChargeDisplay";
import { formatCurrency } from "@/lib/utils";
import { importFromConnectedMailboxes } from "@/services/emailscan";
import { listMailboxesAsync } from "@/services/emailscan/persist";
import { useUser } from "@/context/AuthContext";
import dayjs from "dayjs";
import { useRouter } from "expo-router";
import { styled } from "nativewind";
import { usePostHog } from "posthog-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";

const SafeAreaView = styled(RNSafeAreaView);

const App = () => {
  const router = useRouter();
  const { user } = useUser();
  const posthog = usePostHog();
  const { tabListPadding, pagePadding } = useBottomClearance();
  const [expandedSubscriptionId, setExpandedSubscriptionId] = useState<
    string | null
  >(null);
  const {
    subscriptions,
    addSubscription,
    updateSubscription,
    deleteSubscription,
    updateSubscriptionStatus,
    getUpcomingSubscriptions,
    refreshSubscriptions,
  } = useSubscriptions();
  const { displayFor, cyclePeriod, monthlySpend } =
    useChargeDisplay(subscriptions);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSubscription, setEditingSubscription] =
    useState<Subscription | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [statsModalSubscription, setStatsModalSubscription] =
    useState<Subscription | null>(null);
  const [statsModalVisible, setStatsModalVisible] = useState(false);
  const [userSettingsVisible, setUserSettingsVisible] = useState(false);

  // Icon picker state
  const [iconPickerSubscription, setIconPickerSubscription] =
    useState<Subscription | null>(null);
  const [iconPickerVisible, setIconPickerVisible] = useState(false);
  const [mailboxCount, setMailboxCount] = useState(0);
  const [scanning, setScanning] = useState(false);

  const refreshMailboxCount = useCallback(async () => {
    try {
      const boxes = await listMailboxesAsync();
      setMailboxCount(boxes.length);
    } catch {
      setMailboxCount(0);
    }
  }, []);

  useEffect(() => {
    refreshMailboxCount().catch(() => undefined);
  }, [refreshMailboxCount, subscriptions.length]);

  const displayName =
    user?.firstName ||
    user?.fullName ||
    user?.emailAddresses[0]?.emailAddress ||
    "User";

  const upcomingSubscriptions = useMemo(
    () => getUpcomingSubscriptions(7),
    [getUpcomingSubscriptions],
  );

  const handleAddSubscriptionTap = () => {
    posthog.capture("home_add_subscription_tapped");
    setModalVisible(true);
  };

  const handleUpcomingSubscriptionTap = (item: UpcomingSubscription) => {
    posthog.capture("home_upcoming_subscription_tapped", {
      subscription_id: item.id,
      subscription_name: item.name,
      price: item.price,
      days_left: item.daysLeft,
    });
  };

  const handleViewAllUpcoming = () => {
    posthog.capture("home_view_all_upcoming_tapped");
    router.push("/(tabs)/subscriptions?filter=upcoming");
  };

  const handleViewAllSubscriptionsTap = () => {
    posthog.capture("home_view_all_tapped");
    router.push("/(tabs)/subscriptions");
  };

  const handleHomeScanTap = async () => {
    if (mailboxCount === 0) {
      router.push("/(tabs)/subscriptions?addMailbox=1");
      return;
    }
    setScanning(true);
    try {
      const { imported, errors } = await importFromConnectedMailboxes({
        userId: user?.id || "anonymous",
        existing: subscriptions,
        addSubscription,
        updateSubscription,
      });
      await refreshSubscriptions();
      await refreshMailboxCount();
      if (errors.length) {
        // Parity with EmailScanSection: surface per-mailbox errors even when
        // some rows imported (R2 — errors were hidden whenever imported > 0).
        Alert.alert("Scan", errors.join("\n"));
      } else if (imported === 0) {
        Alert.alert("Scan", "No new subscriptions.");
      }
    } catch (error) {
      Alert.alert(
        "Scan",
        error instanceof Error ? error.message : "Scan failed",
      );
    } finally {
      setScanning(false);
    }
  };

  const handleCreateSubscription = async (subscription: Subscription) => {
    await addSubscription(subscription);
  };

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
    // Icons will auto-refresh via cache update listener
  };

  // Recurring amortized monthly + sparse this-month actuals.
  const totalMonthlySpend = monthlySpend;

  // Find the nearest upcoming renewal date
  const nearestRenewal = useMemo<dayjs.Dayjs | null>(() => {
    const now = dayjs();
    let nearest: dayjs.Dayjs | null = null;

    subscriptions.forEach((sub) => {
      if (!sub.renewalDate) return;
      if (sub.status === "cancelled" || sub.status === "paused") return;
      const d = dayjs(sub.renewalDate);
      if (d.isAfter(now) && (!nearest || d.isBefore(nearest))) {
        nearest = d;
      }
    });

    return nearest;
  }, [subscriptions]);

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      className="flex-1 bg-background px-5 pt-5"
      style={{ paddingBottom: pagePadding }}
    >
      <FlatList
        ListHeaderComponent={
          <>
            <View className="home-header">
              <View className="home-user">
                <Pressable onPress={() => setUserSettingsVisible(true)}>
                  <Image
                    source={
                      user?.imageUrl ? { uri: user.imageUrl } : images.avatar
                    }
                    className="home-avatar"
                  />
                </Pressable>
                <Text
                  className="home-user-name"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {displayName}
                </Text>
              </View>
              <Pressable onPress={handleAddSubscriptionTap}>
                <Image source={icons.add} className="home-add-icon" />
              </Pressable>
            </View>
            <View className="home-balance-card">
              <Text className="home-balance-label">Monthly Spend</Text>
              <View className="home-balance-row">
                <Text className="home-balance-amount">
                  {formatCurrency(totalMonthlySpend)}
                </Text>
                {nearestRenewal && (
                  <Text className="home-balance-date">
                    {nearestRenewal.format("MM/DD")}
                  </Text>
                )}
              </View>
            </View>
            <View className="mb-5">
              <ListHeading title="Upcoming" onViewAll={handleViewAllUpcoming} />
              <FlatList
                data={upcomingSubscriptions}
                renderItem={({ item }) => (
                  <UpcomingSubscriptionCard
                    {...item}
                    onPress={() => handleUpcomingSubscriptionTap(item)}
                  />
                )}
                keyExtractor={(item) => item.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                ListEmptyComponent={
                  <Text className="home-empty-state">
                    No upcoming renewals yet.
                  </Text>
                }
              />
            </View>
            <ListHeading
              title="All Subscriptions"
              onViewAll={handleViewAllSubscriptionsTap}
            />
            <Pressable
              className={`mb-4 mt-3 items-center rounded-2xl py-4 ${
                mailboxCount > 0 ? "bg-accent" : "bg-muted"
              }`}
              onPress={handleHomeScanTap}
              disabled={scanning}
            >
              {scanning ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text
                  className={`text-sm font-sans-bold ${
                    mailboxCount > 0 ? "text-white" : "text-primary"
                  }`}
                >
                  {mailboxCount > 0
                    ? "Scan mailbox for subscriptions"
                    : "Add at least one mailbox to scan"}
                </Text>
              )}
            </Pressable>
          </>
        }
        data={subscriptions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SubscriptionCard
            {...item}
            expanded={expandedSubscriptionId === item.id}
            displayPrice={displayFor(item).amount}
            displayUnknown={displayFor(item).unknown}
            displayPeriodLabel={displayFor(item).label}
            onCyclePeriod={() => cyclePeriod(item)}
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
          <Text className="home-empty-state">No subscription yet.</Text>
        }
        contentContainerStyle={{ paddingBottom: tabListPadding }}
      />

      <CreateSubscriptionModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onCreate={handleCreateSubscription}
      />

      <EditSubscriptionModal
        visible={editModalVisible}
        subscription={editingSubscription}
        onClose={() => {
          setEditModalVisible(false);
          setEditingSubscription(null);
        }}
        onSave={handleSaveEdit}
      />

      <SubscriptionStatsModal
        visible={statsModalVisible}
        subscription={statsModalSubscription}
        onClose={() => {
          setStatsModalVisible(false);
          setStatsModalSubscription(null);
        }}
        onRenew={(id: string) => {
          updateSubscription(id, {});
        }}
      />

      <UserSettingsModal
        visible={userSettingsVisible}
        onClose={() => setUserSettingsVisible(false)}
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

export default App;
