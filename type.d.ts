import type { ImageSourcePropType } from "react-native";

declare global {
  interface AppTab {
    name: string;
    title: string;
    icon: ImageSourcePropType;
  }

  interface TabIconProps {
    focused: boolean;
    icon: ImageSourcePropType;
  }

  interface Subscription {
    id: string;
    icon: ImageSourcePropType;
    icon_key?: string;
    name: string;
    plan?: string;
    category?: string;
    paymentMethod?: string;
    status?: string;
    startDate?: string;
    price: number;
    priceUnknown?: boolean;
    currency?: string;
    billing: string;
    frequency?: string;
    renewalDate?: string;
    color?: string;
    /** R18: paper-trail — mailbox message id of the first scan candidate. */
    sourceMessageId?: string | null;
    /** R18: best-effort invoice/order/receipt number; often null; editable. */
    billNumber?: string | null;
    /**
     * R40-A: latest received-evidence email date (ISO) for this row — the
     * max corpus message date across matched candidates. The list orders by
     * received evidence (last → start → created), never the scan wall-clock.
     */
    lastReceivedAt?: string | null;
  }

  interface SubscriptionCardProps extends Subscription {
    expanded: boolean;
    onPress: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
    onMarkActive?: () => void;
    onMarkPaused?: () => void;
    onMarkCancelled?: () => void;
    onViewStats?: () => void;
  }

  interface UpcomingSubscription {
    id: string;
    icon: ImageSourcePropType;
    name: string;
    price: number;
    priceUnknown?: boolean;
    currency?: string;
    daysLeft: number;
  }

  interface UpcomingSubscriptionCardProps extends Omit<
    UpcomingSubscription,
    "id"
  > {}

  interface ListHeadingProps {
    title: string;
    onViewAll?: () => void;
  }
}

export { };

