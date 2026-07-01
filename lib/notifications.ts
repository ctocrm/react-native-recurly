import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * Configure the notification handler to show a foreground alert.
 */
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * Request notification permissions from the user.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn("Notification permission not granted");
    return false;
  }

  // Android requires a notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("upcoming-renewals", {
      name: "Upcoming Renewals",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#ea7a53",
    });
  }

  return true;
}

/**
 * Schedule a daily notification for a subscription that's upcoming.
 * The notification repeats daily at 9:00 AM until the renewal date.
 */
export async function scheduleUpcomingNotification(
  subscriptionId: string,
  name: string,
  daysLeft: number,
  price: string,
  renewalDate: string,
): Promise<string | undefined> {
  try {
    // Cancel any existing notification for this subscription first
    await cancelSubscriptionNotifications(subscriptionId);

    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: "🔔 Upcoming Renewal",
        body: `${name} renews in ${daysLeft} day${daysLeft === 1 ? "" : "s"} — ${price}`,
        data: { subscriptionId },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 9,
        minute: 0,
      } as Notifications.DailyTriggerInput,
    });

    return identifier;
  } catch (error) {
    console.error("Failed to schedule notification:", error);
    return undefined;
  }
}

/**
 * Cancel all notifications for a specific subscription.
 */
export async function cancelSubscriptionNotifications(subscriptionId: string) {
  const allScheduled = await Notifications.getAllScheduledNotificationsAsync();
  const toCancel = allScheduled.filter(
    (n: Notifications.NotificationRequest) =>
      n.content.data?.subscriptionId === subscriptionId,
  );
  for (const n of toCancel) {
    await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }
}

/**
 * Cancel all scheduled notifications.
 */
export async function cancelAllNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Reschedule notifications for all upcoming subscriptions.
 * Call this whenever the subscriptions list changes.
 */
export async function rescheduleAllUpcoming(
  upcomingSubscriptions: UpcomingSubscription[],
): Promise<void> {
  // Cancel all existing notifications first
  await cancelAllNotifications();

  // Schedule new ones for each upcoming subscription
  for (const sub of upcomingSubscriptions) {
    const priceFormatted = `$${sub.price.toFixed(2)}`;
    await scheduleUpcomingNotification(
      sub.id,
      sub.name,
      sub.daysLeft,
      priceFormatted,
      "",
    );
  }
}
