import { posthog } from "@/src/config/posthog";
import { processIconQueue } from "@/src/services/iconBackgroundCrawler";
import dayjs from "dayjs";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import {
  addSubscription as dbAddSubscription,
  deleteSubscription as dbDeleteSubscription,
  renewSubscription as dbRenewSubscription,
  updateSubscription as dbUpdateSubscription,
  updateSubscriptionStatus as dbUpdateSubscriptionStatus,
  getAllSubscriptions,
  getPreference,
  setPreference,
} from "../../services/database";
import { useDatabase } from "./DatabaseProvider";

interface SubscriptionContextType {
  subscriptions: Subscription[];
  addSubscription: (subscription: Subscription) => Promise<void>;
  updateSubscription: (
    id: string,
    data: Partial<Subscription>,
  ) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  updateSubscriptionStatus: (
    id: string,
    status: "active" | "paused" | "cancelled",
  ) => Promise<void>;
  renewSubscription: (id: string) => Promise<void>;
  getUpcomingSubscriptions: (daysAhead?: number) => UpcomingSubscription[];
  notificationEnabled: boolean;
  setNotificationEnabled: (enabled: boolean) => Promise<void>;
  refreshSubscriptions: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(
  undefined,
);

export const SubscriptionProvider = ({ children }: { children: ReactNode }) => {
  const { db, isReady } = useDatabase();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [notificationEnabled, setNotificationEnabledState] = useState(true);
  const hasProcessedOnStartup = useRef(false);

  // Process queued icons when app comes to foreground.
  // This runs inside DatabaseProvider, so the DB is always ready.
  // Guarded to not double-trigger on startup when state is already "active".
  useEffect(() => {
    const handleAppStateChange = (state: string) => {
      if (state === "active" && !hasProcessedOnStartup.current) {
        hasProcessedOnStartup.current = true;
        processIconQueue().catch(console.error);
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );
    // Check initial state - if already active, mark as processed
    if (AppState.currentState === "active") {
      hasProcessedOnStartup.current = true;
    }
    return () => subscription.remove();
  }, []);

  // Load all subscriptions from DB when the database becomes ready
   
  useEffect(() => {
    if (isReady && db) {
      refreshSubscriptions();
      loadPreferences();
      // Process any queued icons on startup (first time only)
      if (!hasProcessedOnStartup.current) {
        hasProcessedOnStartup.current = true;
        processIconQueue().catch(console.error);
      }
    }
  }, [isReady, db]);

  const refreshSubscriptions = useCallback(async () => {
    try {
      const subs = await getAllSubscriptions();
      setSubscriptions(subs);
    } catch (error) {
      console.error("Failed to load subscriptions:", error);
    }
  }, []);

  const loadPreferences = useCallback(async () => {
    try {
      const val = await getPreference("notification_enabled");
      setNotificationEnabledState(val !== "false");
    } catch {
      // default to true
    }
  }, []);

  const addSubscription = useCallback(async (subscription: Subscription) => {
    try {
      await dbAddSubscription(subscription);
      setSubscriptions((prev) => [subscription, ...prev]);
      posthog.capture("subscription_added", {
        subscription_id: subscription.id,
        subscription_name: subscription.name,
        subscription_price: subscription.price,
        subscription_category: subscription.category ?? "",
        subscription_frequency: subscription.frequency ?? subscription.billing,
      });
    } catch (error) {
      console.error("Failed to add subscription:", error);
      throw error;
    }
  }, []);

  const updateSubscription = useCallback(
    async (id: string, data: Partial<Subscription>) => {
      try {
        await dbUpdateSubscription(id, data);
        setSubscriptions((prev) =>
          prev.map((sub) => (sub.id === id ? { ...sub, ...data } : sub)),
        );
        const { icon, ...analytics } = data;
        posthog.capture("subscription_updated", {
          subscription_id: id,
          ...analytics,
        });
      } catch (error) {
        console.error("Failed to update subscription:", error);
      }
    },
    [],
  );

  const deleteSubscription = useCallback(async (id: string) => {
    try {
      await dbDeleteSubscription(id);
      setSubscriptions((prev) => prev.filter((sub) => sub.id !== id));
      posthog.capture("subscription_deleted", {
        subscription_id: id,
      });
    } catch (error) {
      console.error("Failed to delete subscription:", error);
      throw error;
    }
  }, []);

  const updateSubscriptionStatus = useCallback(
    async (id: string, status: "active" | "paused" | "cancelled") => {
      try {
        await dbUpdateSubscriptionStatus(id, status);
        setSubscriptions((prev) =>
          prev.map((sub) => (sub.id === id ? { ...sub, status } : sub)),
        );
        posthog.capture("subscription_status_changed", {
          subscription_id: id,
          new_status: status,
        });
      } catch (error) {
        console.error("Failed to update subscription status:", error);
        throw error;
      }
    },
    [],
  );

  const renewSubscription = useCallback(async (id: string) => {
    try {
      await dbRenewSubscription(id);
      const subs = await getAllSubscriptions();
      setSubscriptions(subs);
      posthog.capture("subscription_renewed", {
        subscription_id: id,
      });
    } catch (error) {
      console.error("Failed to renew subscription:", error);
    }
  }, []);

  const setNotificationEnabled = useCallback(
    async (enabled: boolean) => {
      const previous = notificationEnabled;
      setNotificationEnabledState(enabled);
      try {
        await setPreference("notification_enabled", enabled ? "true" : "false");
      } catch (error) {
        setNotificationEnabledState(previous);
        console.error("Failed to update notification preference:", error);
        throw error;
      }
    },
    [notificationEnabled],
  );

  const getUpcomingSubscriptions = useCallback(
    (daysAhead = 7): UpcomingSubscription[] => {
      const now = dayjs();
      const upcoming = subscriptions
        .filter((sub) => {
          if (sub.status === "cancelled" || sub.status === "paused")
            return false;
          if (!sub.renewalDate) return false;
          const daysLeft = dayjs(sub.renewalDate).diff(now, "day");
          return daysLeft >= 0 && daysLeft <= daysAhead;
        })
        .map((sub) => {
          const daysLeft = dayjs(sub.renewalDate).diff(now, "day");
          return {
            id: sub.id,
            icon: sub.icon,
            name: sub.name,
            price: sub.price,
            currency: sub.currency || "USD",
            daysLeft,
          } satisfies UpcomingSubscription;
        })
        .sort((a, b) => a.daysLeft - b.daysLeft);

      return upcoming;
    },
    [subscriptions],
  );

  return (
    <SubscriptionContext.Provider
      value={{
        subscriptions,
        addSubscription,
        updateSubscription,
        deleteSubscription,
        updateSubscriptionStatus,
        renewSubscription,
        getUpcomingSubscriptions,
        notificationEnabled,
        setNotificationEnabled,
        refreshSubscriptions,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
};

export const useSubscriptions = (): SubscriptionContextType => {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error(
      "useSubscriptions must be used within a SubscriptionProvider",
    );
  }
  return context;
};
