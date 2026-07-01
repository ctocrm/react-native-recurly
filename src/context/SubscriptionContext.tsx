import { HOME_SUBSCRIPTIONS } from "@/constants/data";
import { posthog } from "@/src/config/posthog";
import dayjs from "dayjs";
import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

interface SubscriptionContextType {
  subscriptions: Subscription[];
  addSubscription: (subscription: Subscription) => void;
  updateSubscription: (id: string, data: Partial<Subscription>) => void;
  deleteSubscription: (id: string) => void;
  updateSubscriptionStatus: (
    id: string,
    status: "active" | "paused" | "cancelled",
  ) => void;
  renewSubscription: (id: string) => void;
  getUpcomingSubscriptions: (daysAhead?: number) => UpcomingSubscription[];
  notificationEnabled: boolean;
  setNotificationEnabled: (enabled: boolean) => void;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(
  undefined,
);

export const SubscriptionProvider = ({ children }: { children: ReactNode }) => {
  const [subscriptions, setSubscriptions] =
    useState<Subscription[]>(HOME_SUBSCRIPTIONS);
  const [notificationEnabled, setNotificationEnabled] = useState(true);

  const addSubscription = (subscription: Subscription) => {
    setSubscriptions((prev) => [subscription, ...prev]);
    posthog.capture("subscription_added", {
      subscription_id: subscription.id,
      subscription_name: subscription.name,
      subscription_price: subscription.price,
      subscription_category: subscription.category ?? "",
      subscription_frequency: subscription.frequency ?? subscription.billing,
    });
  };

  const updateSubscription = useCallback(
    (id: string, data: Partial<Subscription>) => {
      setSubscriptions((prev) =>
        prev.map((sub) => (sub.id === id ? { ...sub, ...data } : sub)),
      );
      const { icon, ...analytics } = data;
      posthog.capture("subscription_updated", {
        subscription_id: id,
        ...analytics,
      });
    },
    [],
  );

  const deleteSubscription = useCallback((id: string) => {
    setSubscriptions((prev) => prev.filter((sub) => sub.id !== id));
    posthog.capture("subscription_deleted", {
      subscription_id: id,
    });
  }, []);

  const updateSubscriptionStatus = useCallback(
    (id: string, status: "active" | "paused" | "cancelled") => {
      setSubscriptions((prev) =>
        prev.map((sub) => (sub.id === id ? { ...sub, status } : sub)),
      );
      posthog.capture("subscription_status_changed", {
        subscription_id: id,
        new_status: status,
      });
    },
    [],
  );

  const renewSubscription = useCallback((id: string) => {
    setSubscriptions((prev) =>
      prev.map((sub) => {
        if (sub.id !== id) return sub;
        const frequency = sub.frequency || sub.billing;
        const now = dayjs();
        const newRenewalDate =
          frequency === "Yearly" ? now.add(1, "year") : now.add(1, "month");
        return {
          ...sub,
          status: "active" as const,
          renewalDate: newRenewalDate.toISOString(),
          startDate: now.toISOString(),
        };
      }),
    );
    posthog.capture("subscription_renewed", {
      subscription_id: id,
    });
  }, []);

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
