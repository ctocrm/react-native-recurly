import { HOME_SUBSCRIPTIONS } from "@/constants/data";
import React, {
    createContext,
    useContext,
    useState,
    type ReactNode,
} from "react";

interface SubscriptionContextType {
  subscriptions: Subscription[];
  addSubscription: (subscription: Subscription) => void;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(
  undefined,
);

export const SubscriptionProvider = ({ children }: { children: ReactNode }) => {
  const [subscriptions, setSubscriptions] =
    useState<Subscription[]>(HOME_SUBSCRIPTIONS);

  const addSubscription = (subscription: Subscription) => {
    setSubscriptions((prev) => [subscription, ...prev]);
  };

  return (
    <SubscriptionContext.Provider value={{ subscriptions, addSubscription }}>
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
