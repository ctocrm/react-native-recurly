import ListHeading from "@/components/ListHeading";
import SubscriptionCard from "@/components/SubscriptionCard";
import UpcomingSubscriptionCard from "@/components/UpcomingSubscriptionCard";
import { icons } from "@/constants/icons";
import images from "@/constants/images";
import "@/global.css";
import { formatCurrency } from "@/lib/utils";
import CreateSubscriptionModal from "@/src/components/CreateSubscriptionModal";
import EditSubscriptionModal from "@/src/components/EditSubscriptionModal";
import SubscriptionIconPickerModal from "@/src/components/SubscriptionIconPickerModal";
import SubscriptionStatsModal from "@/src/components/SubscriptionStatsModal";
import UserSettingsModal from "@/src/components/UserSettingsModal";
import { useSubscriptions } from "@/src/context/SubscriptionContext";
import { useUser } from "@clerk/expo";
import dayjs from "dayjs";
import { useRouter } from "expo-router";
import { styled } from "nativewind";
import { usePostHog } from "posthog-react-native";
import { useMemo, useState } from "react";
import { FlatList, Image, Pressable, Text, View } from "react-native";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";

const SafeAreaView = styled(RNSafeAreaView);

const App = () => {
  const router = useRouter();
  const { user } = useUser();
  const posthog = usePostHog();
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
  } = useSubscriptions();
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
    router.push("/(tabs)/subscriptions");
  };

  const handleCreateSubscription = (subscription: Subscription) => {
    addSubscription(subscription);
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

  // Calculate total monthly spend from active subscriptions
  const totalMonthlySpend = useMemo(() => {
    const activeSubs = subscriptions.filter(
      (s) => s.status !== "cancelled" && s.status !== "paused",
    );

    let total = 0;
    activeSubs.forEach((sub) => {
      let monthlyAmount = sub.price;
      if (sub.billing === "Yearly" || sub.frequency === "Yearly") {
        monthlyAmount = sub.price / 12;
      } else if (sub.billing === "Weekly" || sub.frequency === "Weekly") {
        monthlyAmount = sub.price * 4.33;
      }
      total += monthlyAmount;
    });

    return total;
  }, [subscriptions]);

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
    <SafeAreaView className="flex-1 bg-background p-5">
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
          </>
        }
        data={subscriptions}
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
          <Text className="home-empty-state">No subscription yet.</Text>
        }
        contentContainerClassName="pb-25"
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
