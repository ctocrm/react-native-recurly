// R18: read-only paper-trail for a subscription — where it came from and how
// it is billed. Editing lives in EditSubscriptionModal.
import {
  formatCurrency,
  formatSubscriptionDateTime,
} from "@/lib/utils";
import { getCachedMessageByIdAsync } from "@/services/emailscan/persist";
import type { ClassifiedMessage } from "@/services/emailscan/types";
import clsx from "clsx";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

interface SubscriptionDetailsModalProps {
  visible: boolean;
  subscription: Subscription | null;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between border-b border-muted-foreground/10 py-3">
      <Text className="mr-4 flex-1 font-sans text-muted-foreground">
        {label}
      </Text>
      <Text className="flex-[2] text-right font-sans-bold text-primary">
        {value}
      </Text>
    </View>
  );
}

const SubscriptionDetailsModal = ({
  visible,
  subscription,
  onClose,
}: SubscriptionDetailsModalProps) => {
  // R26: the source email is fetched by id straight from the DB — the boot
  // path no longer carries the whole in-memory message list for this .find.
  const [source, setSource] = useState<ClassifiedMessage | null>(null);

  useEffect(() => {
    if (!visible || !subscription?.sourceMessageId) {
      setSource(null);
      return;
    }
    let active = true;
    void getCachedMessageByIdAsync(subscription.sourceMessageId).then((m) => {
      if (active) setSource(m);
    });
    return () => {
      active = false;
    };
  }, [visible, subscription?.sourceMessageId]);

  if (!subscription) return null;

  const cadenceLabel = subscription.billing || subscription.frequency || "—";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/50 px-6" onPress={onClose}>
        <Pressable
          className={clsx("mt-24 rounded-3xl bg-background p-5")}
          onPress={(e) => e.stopPropagation()}
        >
          <Text className="mb-1 font-sans-bold text-lg text-primary">
            {subscription.name}
          </Text>
          <Text className="mb-4 font-sans text-muted-foreground">
            Subscription details
          </Text>

          <Row label="Account" value={subscription.paymentMethod || "—"} />
          <Row
            label="Amount as billed"
            value={
              subscription.priceUnknown
                ? `? ${cadenceLabel}`
                : `${formatCurrency(
                    subscription.price,
                    subscription.currency ?? "USD",
                    false,
                  )} ${cadenceLabel}`
            }
          />
          <Row
            label="Started"
            value={
              subscription.startDate
                ? formatSubscriptionDateTime(subscription.startDate)
                : "—"
            }
          />
          <Row
            label="Next renewal"
            value={
              subscription.renewalDate
                ? formatSubscriptionDateTime(subscription.renewalDate)
                : "—"
            }
          />
          <Row label="Bill number" value={subscription.billNumber || "—"} />
          <Row
            label="Source email"
            value={
              source
                ? `${source.message.from} · ${formatSubscriptionDateTime(
                    source.message.date,
                  )}`
                : "—"
            }
          />
          {source ? (
            <Text className="mt-2 font-sans text-xs text-muted-foreground">
              “{source.message.subject}”
            </Text>
          ) : null}

          <Pressable
            className="mt-5 items-center rounded-2xl bg-muted py-4"
            onPress={onClose}
          >
            <Text className="font-sans-bold text-primary">Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default SubscriptionDetailsModal;
