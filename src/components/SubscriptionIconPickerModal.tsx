import { icons } from "@/constants/icons";
import { deleteCachedIcon, setCachedIcon } from "@/services/database";
import {
  getIconCollection,
  startIconCrawl,
} from "@/src/services/iconBackgroundCrawler";
import {
  addCacheUpdateListener,
  addLoadingListener,
  isIconLoading,
} from "@/src/services/iconLoadingRegistry";
import {
  getReportsForIcon,
  rejectReportedIcon,
  reportIcon,
} from "@/src/services/iconReportService";
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
  Switch,
  Text,
  TextInput,
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
  id: string;
  imageData: string;
  source: string;
  format: string;
  originalUrl: string | null;
  reportedType?: "wrong" | "broken" | null;
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
  // Toggle to reveal reported ("incorrect") icons.
  const [showIncorrect, setShowIncorrect] = useState(false);
  // Toggle to reveal reported ("broken") icons.
  const [showBroken, setShowBroken] = useState(false);
  // Inline comment state for the mandatory report flow.
  const [reportState, setReportState] = useState<{
    icon: PickerIcon | null;
    type: "wrong" | "broken" | null;
    comment: string;
  }>({ icon: null, type: null, comment: "" });
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

      // Map reported icons so we can (a) hide them by default and
      // (b) surface them with a "Mark as good" action when toggles are on.
      const reports = await getReportsForIcon(iconKey);
      const reportedByHash = new Map<string, "wrong" | "broken">();
      for (const r of reports) {
        if (r.rejected) continue; // user later marked good
        reportedByHash.set(r.imageData, r.reportType);
      }

      if (isMounted.current) {
        const mapped: PickerIcon[] = collection.icons.map((icon) => {
          const reportedType = reportedByHash.get(icon.imageData) ?? null;
          // `id` comes straight from getIconCollection (hashed from the
          // ORIGINAL bytes), so it stays unique even when two source sizes
          // upscale to identical pixels — prevents duplicate FlatList keys.
          return {
            id: icon.id,
            imageData: icon.imageData,
            source: icon.source,
            format: icon.format,
            originalUrl: icon.originalUrl,
            reportedType,
          };
        });

        // Default: hide reported icons. Toggles reveal them.
        const visible = mapped.filter((i) => {
          if (!i.reportedType) return true;
          if (i.reportedType === "wrong") return showIncorrect;
          if (i.reportedType === "broken") return showBroken;
          return true;
        });

        setAvailableIcons(visible);
        console.log(
          `[PICKER] Loaded ${visible.length} icons for ${iconKey} (${mapped.length} total, reports hidden by default)`,
        );
      }
    } catch (error) {
      console.error("[PICKER] Failed to load icons:", error);
    }
  }, [iconKey, subscriptionIcon, showIncorrect, showBroken]);

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

    // Selecting the subscription's own bundled asset shouldn't write the
    // "local_asset:" sentinel into icon_cache — that produces an invalid
    // data URI and a blank icon on the card. Instead, clear any cache
    // override so the card falls back to the static brand asset.
    if (icon.imageData.startsWith("local_asset:")) {
      await deleteCachedIcon(iconKey);
      posthog.capture("icon_picker_icon_selected_default", {
        subscription_name: subscriptionName,
        icon_key: iconKey,
      });
    } else {
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
    }

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

  // Open the mandatory-comment report sheet for a given icon + type.
  const openReport = (icon: PickerIcon, type: "wrong" | "broken") => {
    setReportState({ icon, type, comment: "" });
  };

  const submitReport = async () => {
    const { icon, type, comment } = reportState;
    if (!iconKey || !icon || !type) return;

    if (!comment.trim()) {
      Alert.alert(
        "Comment required",
        "Please explain why you are reporting this icon.",
      );
      return;
    }

    const captureEvent =
      type === "wrong"
        ? "icon_picker_report_wrong"
        : "icon_picker_report_broken";

    posthog.capture(captureEvent, {
      subscription_name: subscriptionName,
      icon_key: iconKey,
      source: icon.source,
    });

    const saved = await reportIcon(
      iconKey,
      type,
      icon.source,
      icon.imageData,
      comment.trim(),
    );

    setReportState({ icon: null, type: null, comment: "" });

    if (saved) {
      // Drop it from the visible list immediately (it will stay hidden on reopen).
      setAvailableIcons((prev) =>
        prev.filter((i) => i.imageData !== icon.imageData),
      );
      Alert.alert(
        "Icon Reported",
        type === "wrong"
          ? `This icon has been reported as incorrect for "${subscriptionName}".`
          : `This icon has been reported as broken for "${subscriptionName}".`,
      );
    } else {
      Alert.alert("Error", "Failed to report icon. Please try again.");
    }
  };

  // "Mark as good" — undo a mistaken report (persisted as rejected).
  const handleMarkAsGood = async (icon: PickerIcon) => {
    if (!iconKey) return;
    await rejectReportedIcon(iconKey, icon.imageData);
    setAvailableIcons((prev) =>
      prev.filter((i) => i.imageData !== icon.imageData),
    );
    Alert.alert("Restored", "This icon will no longer be hidden.");
  };

  const renderIconItem = ({ item }: { item: PickerIcon }) => {
    // Handle local_asset prefix - use the subscription icon directly
    const isLocalAsset = item.imageData.startsWith("local_asset:");
    // Build a safe data URI for non-local assets
    const dataUri = `data:image/${item.format === "svg" ? "svg+xml" : item.format};base64,${item.imageData}`;
    const imageSource = isLocalAsset
      ? (subscriptionIcon ?? icons.plus)
      : { uri: dataUri };

    const isReported = !!item.reportedType;

    return (
      <View className="items-center gap-2 px-2 py-3">
        <Pressable
          className="size-16 items-center justify-center rounded-xl border-2 border-border bg-card"
          onPress={() => handleSelectIcon(item)}
        >
          <Image
            source={imageSource}
            className="size-12"
            resizeMode="contain"
          />
        </Pressable>
        <View className="flex-row gap-1">
          {isReported ? (
            <Pressable
              onPress={() => handleMarkAsGood(item)}
              className="px-1.5 py-0.5"
            >
              <Text className="text-xs text-green-500">✓ good</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={() => openReport(item, "wrong")}
                className="px-1.5 py-0.5"
              >
                <Text className="text-xs text-muted-foreground">X</Text>
              </Pressable>
              <Pressable
                onPress={() => openReport(item, "broken")}
                className="px-1.5 py-0.5"
              >
                <Text className="text-xs text-muted-foreground">!</Text>
              </Pressable>
            </>
          )}
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

          {/* Report toggles */}
          <View className="mb-3 flex-row justify-between">
            <View className="flex-row items-center gap-2">
              <Switch
                value={showIncorrect}
                onValueChange={(v) => {
                  setShowIncorrect(v);
                  loadIcons();
                }}
              />
              <Text className="text-xs text-muted-foreground">
                Show incorrect
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Switch
                value={showBroken}
                onValueChange={(v) => {
                  setShowBroken(v);
                  loadIcons();
                }}
              />
              <Text className="text-xs text-muted-foreground">Show broken</Text>
            </View>
          </View>

          {availableIcons.length > 0 && (
            <>
              <Text className="mb-2 text-xs text-muted-foreground">
                {availableIcons.length} icon
                {availableIcons.length !== 1 ? "s" : ""} available
              </Text>
              <FlatList
                data={availableIcons}
                keyExtractor={(item) => item.id}
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

          {/* Mandatory-comment report sheet */}
          {reportState.icon && (
            <View className="mt-4 rounded-2xl border border-border bg-card p-4">
              <Text className="mb-2 font-sans-medium text-primary">
                {reportState.type === "wrong"
                  ? "Report incorrect icon"
                  : "Report broken icon"}
              </Text>
              <TextInput
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-primary"
                placeholder="Explain why (required)…"
                placeholderTextColor="rgba(0, 0, 0, 0.6)"
                value={reportState.comment}
                onChangeText={(t) =>
                  setReportState((s) => ({ ...s, comment: t }))
                }
                multiline
                numberOfLines={3}
                autoFocus
              />
              <View className="mt-3 flex-row justify-end gap-3">
                <Pressable
                  className="rounded-xl px-4 py-2"
                  onPress={() =>
                    setReportState({ icon: null, type: null, comment: "" })
                  }
                >
                  <Text className="text-sm text-muted-foreground">Cancel</Text>
                </Pressable>
                <Pressable
                  className="rounded-xl bg-accent px-4 py-2"
                  onPress={submitReport}
                >
                  <Text className="text-sm font-sans-medium text-white">
                    Submit
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

export default SubscriptionIconPickerModal;
