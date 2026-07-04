import { icons } from "@/constants/icons";
import { getCrawlResults, setCachedIcon } from "@/services/database";
import { queueIconForScraping } from "@/src/services/iconBackgroundCrawler";
import { usePostHog } from "posthog-react-native";
import React, { useEffect, useState } from "react";
import { FlatList, Image, Modal, Pressable, Text, View } from "react-native";

// MIME type mapping from format string to data URI prefix
function mimeForFormat(format: string): string {
  switch (format) {
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "ico":
      return "image/x-icon";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

interface IconPickerProps {
  visible: boolean;
  iconKey: string | null;
  subscriptionName: string;
  onClose: () => void;
  onIconChange: () => void;
}

interface PickerIcon {
  id: number;
  imageData: string;
  source: string;
  format: string;
  originalUrl: string | null;
  fallbackTier: number;
}

const SubscriptionIconPickerModal = ({
  visible,
  iconKey,
  subscriptionName,
  onClose,
  onIconChange,
}: IconPickerProps) => {
  const posthog = usePostHog();
  const [availableIcons, setAvailableIcons] = useState<PickerIcon[]>([]);

  // Load available icons when modal opens
  useEffect(() => {
    if (!visible || !iconKey) return;

    const loadIcons = async () => {
      const results = await getCrawlResults(iconKey);
      setAvailableIcons(results);
    };

    loadIcons();
  }, [visible, iconKey]);

  const handleSearchOnline = async () => {
    if (!iconKey) return;

    posthog.capture("icon_picker_search_online", {
      subscription_name: subscriptionName,
      icon_key: iconKey,
    });

    // Queue icon for background crawling
    await queueIconForScraping(iconKey);
    onClose();
  };

  const handleSelectIcon = async (icon: PickerIcon) => {
    if (!iconKey) return;

    // Update the cached icon
    await setCachedIcon(
      iconKey,
      icon.imageData,
      icon.source,
      icon.format,
      icon.originalUrl,
      icon.fallbackTier,
    );

    posthog.capture("icon_picker_icon_selected", {
      subscription_name: subscriptionName,
      icon_key: iconKey,
      source: icon.source,
      fallback_tier: icon.fallbackTier,
    });

    onIconChange();
    onClose();
  };

  const handleUseDefault = () => {
    posthog.capture("icon_picker_use_default", {
      subscription_name: subscriptionName,
      icon_key: iconKey,
    });
    onClose();
  };

  const handleReportWrong = (icon: PickerIcon) => {
    posthog.capture("icon_picker_report_wrong", {
      subscription_name: subscriptionName,
      icon_key: iconKey,
      source: icon.source,
      fallback_tier: icon.fallbackTier,
    });
  };

  const handleReportBroken = (icon: PickerIcon) => {
    posthog.capture("icon_picker_report_broken", {
      subscription_name: subscriptionName,
      icon_key: iconKey,
      source: icon.source,
      fallback_tier: icon.fallbackTier,
    });
  };

  const renderIconItem = ({
    item,
    index,
  }: {
    item: PickerIcon;
    index: number;
  }) => {
    const iconUri = `data:${mimeForFormat(item.format)};base64,${item.imageData}`;

    return (
      <View className="items-center gap-2 px-2 py-3">
        <Pressable
          className="size-16 items-center justify-center rounded-xl border-2 border-border bg-card"
          onPress={() => handleSelectIcon(item)}
        >
          <Image source={{ uri: iconUri }} className="size-12" />
        </Pressable>
        <View className="flex-row gap-1">
          <Pressable
            onPress={() => handleReportWrong(item)}
            className="px-1.5 py-0.5"
          >
            <Text className="text-xs text-muted-foreground">✕</Text>
          </Pressable>
          <Pressable
            onPress={() => handleReportBroken(item)}
            className="px-1.5 py-0.5"
          >
            <Text className="text-xs text-muted-foreground">⚠</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end">
        <Pressable className="flex-1 bg-black/50" onPress={onClose} />
        <View className="rounded-t-3xl bg-background p-5">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-lg font-sans-bold text-primary">
              Choose Icon
            </Text>
            <Pressable onPress={onClose}>
              <Text className="text-lg text-muted-foreground">✕</Text>
            </Pressable>
          </View>

          {availableIcons.length > 0 ? (
            <FlatList
              data={availableIcons}
              keyExtractor={(item) => item.id.toString()}
              renderItem={renderIconItem}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 8 }}
            />
          ) : (
            <View className="items-center py-8">
              <Text className="text-sm text-muted-foreground">
                No alternative icons found
              </Text>
            </View>
          )}

          <Pressable
            className="mt-4 rounded-2xl bg-accent/10 py-3"
            onPress={handleSearchOnline}
          >
            <View className="flex-row items-center justify-center gap-2">
              <Text className="font-sans-medium text-accent">🔍</Text>
              <Text className="font-sans-medium text-accent">
                Search for Icon Online
              </Text>
            </View>
          </Pressable>

          <Pressable
            className="mt-2 rounded-2xl bg-accent/10 py-3"
            onPress={handleUseDefault}
          >
            <View className="flex-row items-center justify-center gap-2">
              <Image source={icons.plus} className="size-6" />
              <Text className="font-sans-medium text-accent">
                Use Default Icon
              </Text>
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

export default SubscriptionIconPickerModal;
