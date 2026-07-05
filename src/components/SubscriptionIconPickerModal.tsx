import { icons } from "@/constants/icons";
import {
  deleteCachedIcon,
  getCachedIcon,
  getCrawlResults,
  setCachedIcon,
} from "@/services/database";
import { queueIconForScraping } from "@/src/services/iconBackgroundCrawler";
import {
  addCacheUpdateListener,
  addLoadingListener,
  isIconLoading,
} from "@/src/services/iconLoadingRegistry";
import { isImageReported, reportIcon } from "@/src/services/iconReportService";
import {
  downloadIconAsBase64,
  findAllIconSources,
} from "@/src/services/iconScraper";
import { usePostHog } from "posthog-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";

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
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const isMounted = useRef(true);
  const latestKeyRef = useRef(iconKey);

  // Keep latestKeyRef in sync with the current iconKey
  useEffect(() => {
    latestKeyRef.current = iconKey;
  }, [iconKey]);

  /**
   * Load ALL available icons from multiple sources:
   * 1. Currently cached icon (icon_cache table)
   * 2. Previously crawled results (icon_crawl_results table)
   * 3. Library CDNs checked on-the-fly (simple-icons, tabler, devicons, boxicons, icons8)
   */
  const loadIcons = useCallback(async () => {
    if (!iconKey) return;
    const requestKey = iconKey;
    setIsLoading(true);
    try {
      const resultMap = new Map<string, PickerIcon>();
      let nextId = 0;

      // --- Source 1: Currently cached icon ---
      const cached = await getCachedIcon(iconKey);
      if (requestKey !== latestKeyRef.current) return;
      if (cached?.imageData && !resultMap.has(cached.imageData)) {
        resultMap.set(cached.imageData, {
          id: nextId++,
          imageData: cached.imageData,
          source: cached.source || "cached",
          format: cached.format || "png",
          originalUrl: cached.originalUrl ?? null,
          fallbackTier:
            typeof cached.fallbackTier === "number" ? cached.fallbackTier : 0,
        });
      }

      // --- Source 2: Crawl results (previously found icons) ---
      const results = await getCrawlResults(iconKey);
      if (requestKey !== latestKeyRef.current) return;
      for (const r of results) {
        const reported = await isImageReported(iconKey, r.imageData);
        if (requestKey !== latestKeyRef.current) return;
        if (!reported && !resultMap.has(r.imageData)) {
          resultMap.set(r.imageData, {
            id: nextId++,
            imageData: r.imageData,
            source: r.source || "crawl",
            format: r.format || "png",
            originalUrl: r.originalUrl ?? null,
            fallbackTier:
              typeof r.fallbackTier === "number" ? r.fallbackTier : 0,
          } as PickerIcon);
        }
      }

      // --- Source 3: Check library CDNs on-the-fly (only if we don't have many icons) ---
      if (resultMap.size < 3) {
        try {
          const libIcons = await findAllIconSources(iconKey);
          if (requestKey !== latestKeyRef.current) return;
          for (const lib of libIcons) {
            const base64Data = await downloadIconAsBase64(lib.url, lib.format);
            if (requestKey !== latestKeyRef.current) return;
            if (base64Data && !resultMap.has(base64Data)) {
              resultMap.set(base64Data, {
                id: nextId++,
                imageData: base64Data,
                source: lib.source,
                format: lib.format,
                originalUrl: lib.url,
                fallbackTier: resultMap.size,
              });
            }
          }
        } catch (err) {
          // Library checks are best-effort
        }
      }

      if (isMounted.current) {
        // Sort: currently cached icon first (explicit priority), then by fallbackTier
        const sorted = Array.from(resultMap.values()).sort((a, b) => {
          // Cached icon always comes first
          if (a.source === "cached" && b.source !== "cached") return -1;
          if (b.source === "cached" && a.source !== "cached") return 1;
          return a.fallbackTier - b.fallbackTier;
        });
        setAvailableIcons(sorted);
        setIsSearching(false);
      }
    } catch (error) {
      console.error("Failed to load icons:", error);
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [iconKey]);

  useEffect(() => {
    isMounted.current = true;
    if (visible && iconKey) {
      loadIcons();
      // Also check if this icon is currently loading
      setIsSearching(isIconLoading(iconKey));
    }
    return () => {
      isMounted.current = false;
    };
  }, [visible, iconKey, loadIcons]);

  // Listen for loading state changes (crawl in progress)
  useEffect(() => {
    const unsubscribeLoading = addLoadingListener(() => {
      if (!isMounted.current || !iconKey) return;
      setIsSearching(isIconLoading(iconKey));
    });
    return unsubscribeLoading;
  }, [iconKey]);

  // Listen for cache updates (crawl completed)
  useEffect(() => {
    const unsubscribeCache = addCacheUpdateListener(() => {
      if (!isMounted.current || !visible || !iconKey) return;
      // Reload icons when cache is updated
      loadIcons();
    });
    return unsubscribeCache;
  }, [iconKey, visible, loadIcons]);

  const handleSearchOnline = async () => {
    if (!iconKey) return;

    posthog.capture("icon_picker_search_online", {
      subscription_name: subscriptionName,
      icon_key: iconKey,
    });

    setIsSearching(true);
    try {
      // Queue icon for background crawling - the loading listener will update state
      await queueIconForScraping(iconKey);
    } catch (error) {
      console.error("Failed to queue icon for scraping:", error);
      Alert.alert(
        "Search Failed",
        "Could not search for icons. Please try again.",
      );
    } finally {
      setIsSearching(false);
    }
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

  const handleUseDefault = async () => {
    posthog.capture("icon_picker_use_default", {
      subscription_name: subscriptionName,
      icon_key: iconKey,
    });

    // Delete cached icon so the subscription's static icon asset will be used
    if (iconKey) {
      await deleteCachedIcon(iconKey);
    }

    // Show visual feedback
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
      fallback_tier: icon.fallbackTier,
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

          {/* Loading state while crawling */}
          {isSearching && (
            <View className="items-center py-6">
              <ActivityIndicator size="large" color="#8b5cf6" />
              <Text className="mt-3 text-sm text-muted-foreground">
                Searching for icons online...
              </Text>
              <Text className="mt-1 text-xs text-muted-foreground">
                Checking icon libraries and search engine results
              </Text>
            </View>
          )}

          {/* Icons grid */}
          {!isSearching && isLoading && (
            <View className="items-center py-6">
              <ActivityIndicator size="small" color="#8b5cf6" />
              <Text className="mt-2 text-sm text-muted-foreground">
                Loading icons...
              </Text>
            </View>
          )}

          {!isSearching && !isLoading && availableIcons.length > 0 && (
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

          {!isSearching && !isLoading && availableIcons.length === 0 && (
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
              <Text className="font-sans-medium text-accent">
                {isSearching ? "Searching..." : "Search for Icon Online"}
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
