import { icons } from "@/constants/icons";
import { deleteCachedIcon, setCachedIcon } from "@/services/database";
import {
  getIconCollection,
  startIconCrawl
} from "@/src/services/iconBackgroundCrawler";
import {
  addCacheUpdateListener,
  addLoadingListener,
  isIconLoading,
} from "@/src/services/iconLoadingRegistry";
import { reportIcon } from "@/src/services/iconReportService";
import {
  addRateLimitListener,
  getRateLimitedDomains,
} from "@/src/services/rateLimitTracker";
import { usePostHog } from "posthog-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ImageSourcePropType,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";

interface IconPickerProps {
  visible: boolean;
  iconKey: string | null;
  subscriptionIcon?: ImageSourcePropType;
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
}

const SubscriptionIconPickerModal = ({
  visible,
  iconKey,
  subscriptionIcon,
  subscriptionName,
  onClose,
  onIconChange,
}: IconPickerProps) => {
  const posthog = usePostHog();
  const [availableIcons, setAvailableIcons] = useState<PickerIcon[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [rateLimitedDomains, setRateLimitedDomains] = useState<string[]>([]);
  const isMounted = useRef(true);
  const latestKeyRef = useRef(iconKey);

  useEffect(() => {
    latestKeyRef.current = iconKey;
  }, [iconKey]);

  // Poll rate-limited domains for the red indicator
  const refreshRateLimitedDomains = useCallback(async () => {
    try {
      const domains = await getRateLimitedDomains();
      if (isMounted.current) {
        setRateLimitedDomains(
          domains.map((d) => {
            const remainingMin = Math.ceil(d.remainingMs / 60000);
            return `${d.domain} (${remainingMin}min)`;
          }),
        );
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshRateLimitedDomains();
    const interval = setInterval(refreshRateLimitedDomains, 30000);
    return () => clearInterval(interval);
  }, [refreshRateLimitedDomains]);

  useEffect(() => {
    const unsubscribeRateLimit = addRateLimitListener(() => {
      refreshRateLimitedDomains();
    });
    return unsubscribeRateLimit;
  }, [refreshRateLimitedDomains]);

  const loadIcons = useCallback(async () => {
    if (!iconKey) return;
    const requestKey = iconKey;
    try {
      const collection = await getIconCollection(iconKey);
      if (requestKey !== latestKeyRef.current) return;

      if (isMounted.current) {
        setAvailableIcons(
          collection.icons.map((icon, idx) => ({
            id: idx,
            imageData: icon.imageData,
            source: icon.source,
            format: icon.format,
            originalUrl: icon.originalUrl,
          })),
        );
        console.log(
          `[PICKER] Loaded ${collection.icons.length} icons for ${iconKey}`,
        );
      }
    } catch (error) {
      console.error("[PICKER] Failed to load icons:", error);
    }
  }, [iconKey, subscriptionIcon]);

  useEffect(() => {
    isMounted.current = true;
    if (visible && iconKey) {
      loadIcons();
      setIsSearching(isIconLoading(iconKey));
    }
    return () => {
      isMounted.current = false;
    };
  }, [visible, iconKey, loadIcons]);

  useEffect(() => {
    const unsubscribeLoading = addLoadingListener(() => {
      if (!isMounted.current || !iconKey) return;
      setIsSearching(isIconLoading(iconKey));
    });
    return unsubscribeLoading;
  }, [iconKey]);

  useEffect(() => {
    const unsubscribeCache = addCacheUpdateListener(() => {
      if (!isMounted.current || !visible || !iconKey) return;
      loadIcons();
    });
    return unsubscribeCache;
  }, [iconKey, visible, loadIcons]);

  const handleSearchOnline = () => {
    if (!iconKey) return;
    console.log(`[MODAL] Search button pressed for ${iconKey}`);
    posthog.capture("icon_picker_search_online", {
      subscription_name: subscriptionName,
      icon_key: iconKey,
    });
    // Fire-and-forget: startIconCrawl runs as a detached background process
    // tracked in the global loading registry, so closing this modal does NOT
    // cancel the crawl. The isIconLoading listener keeps the spinner in sync.
    startIconCrawl(iconKey);
    console.log(`[MODAL] Search triggered for ${iconKey}`);
  };

  const handleSelectIcon = async (icon: PickerIcon) => {
    if (!iconKey) return;

    await setCachedIcon(
      iconKey,
      icon.imageData,
      icon.source,
      icon.format,
      icon.originalUrl,
    );

    posthog.capture("icon_picker_icon_selected", {
      subscription_name: subscriptionName,
      icon_key: iconKey,
      source: icon.source,
    });

    onIconChange();
    onClose();
  };

  const handleUseDefault = async () => {
    posthog.capture("icon_picker_use_default", {
      subscription_name: subscriptionName,
      icon_key: iconKey,
    });

    if (iconKey) {
      await deleteCachedIcon(iconKey);
    }

    Alert.alert("Default Icon", "Restored the subscription's default icon.");

    onIconChange();
    onClose();
  };

  const reportIconAndNotify = async (
    icon: PickerIcon,
    reportType: "wrong" | "broken",
    successMessage: string,
  ) => {
    if (!iconKey) return;

    const captureEvent =
      reportType === "wrong"
        ? "icon_picker_report_wrong"
        : "icon_picker_report_broken";

    posthog.capture(captureEvent, {
      subscription_name: subscriptionName,
      icon_key: iconKey,
      source: icon.source,
    });

    const saved = await reportIcon(
      iconKey,
      reportType,
      icon.source,
      icon.imageData,
    );
    if (saved) {
      Alert.alert("Icon Reported", successMessage, [
        {
          text: "OK",
          onPress: () => {
            setAvailableIcons((prev) =>
              prev.filter((i) => i.imageData !== icon.imageData),
            );
          },
        },
      ]);
    } else {
      Alert.alert("Error", "Failed to report icon. Please try again.");
    }
  };

  const handleReportWrong = async (icon: PickerIcon) => {
    await reportIconAndNotify(
      icon,
      "wrong",
      `This icon has been reported as incorrect. It will be hidden from future searches for "${subscriptionName}".`,
    );
  };

  const handleReportBroken = async (icon: PickerIcon) => {
    await reportIconAndNotify(
      icon,
      "broken",
      `This icon has been reported as broken. It will be hidden from future searches for "${subscriptionName}".`,
    );
  };

  const renderIconItem = ({
    item,
    index,
  }: {
    item: PickerIcon;
    index: number;
  }) => {
    // Handle local_asset prefix - use the subscription icon directly
    const isLocalAsset = item.imageData.startsWith("local_asset:");
    // Build a safe data URI for non-local assets
    const dataUri = `data:image/${item.format === "svg" ? "svg+xml" : item.format};base64,${item.imageData}`;
    const imageSource = isLocalAsset
      ? (subscriptionIcon ?? icons.plus)
      : { uri: dataUri };

    return (
      <View className="items-center gap-2 px-2 py-3">
        <Pressable
          className="size-16 items-center justify-center rounded-xl border-2 border-border bg-card"
          onPress={() => handleSelectIcon(item)}
        >
          <Image source={imageSource} className="size-12" />
        </Pressable>
        <View className="flex-row gap-1">
          <Pressable
            onPress={() => handleReportWrong(item)}
            className="px-1.5 py-0.5"
          >
            <Text className="text-xs text-muted-foreground">X</Text>
          </Pressable>
          <Pressable
            onPress={() => handleReportBroken(item)}
            className="px-1.5 py-0.5"
          >
            <Text className="text-xs text-muted-foreground">!</Text>
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
              <Text className="text-lg text-muted-foreground">X</Text>
            </Pressable>
          </View>

          {availableIcons.length > 0 && (
            <>
              <Text className="mb-2 text-xs text-muted-foreground">
                {availableIcons.length} icon
                {availableIcons.length !== 1 ? "s" : ""} available
              </Text>
              <FlatList
                data={availableIcons}
                keyExtractor={(item) => item.id.toString()}
                renderItem={renderIconItem}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 8 }}
              />
            </>
          )}

          {availableIcons.length === 0 && (
            <View className="items-center py-8">
              <Text className="text-sm text-muted-foreground">
                No alternative icons found
              </Text>
              <Text className="mt-1 text-xs text-muted-foreground">
                Tap the button below to find icons for {subscriptionName}
              </Text>
            </View>
          )}

          <Pressable
            className="mt-4 rounded-2xl bg-accent/10 py-3"
            onPress={handleSearchOnline}
            disabled={isSearching}
          >
            <View className="flex-row items-center justify-center gap-2">
              {isSearching ? (
                <ActivityIndicator size="small" color="#8b5cf6" />
              ) : (
                <Text className="font-sans-medium text-accent">🔍</Text>
              )}
              <View className="items-center">
                <Text className="font-sans-medium text-accent">
                  {isSearching ? "Searching..." : "Search for Icon Online"}
                </Text>
                {/* Red rate-limit indicator */}
                {rateLimitedDomains.length > 0 && (
                  <Text className="mt-0.5 text-[10px] text-red-500">
                    ⚠️ Rate limited: {rateLimitedDomains.join(", ")}
                  </Text>
                )}
              </View>
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
