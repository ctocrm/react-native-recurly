import { useEffect, useState } from "react";
import { getCachedIcon, getQueuedIcons } from "../../services/database";

// Loading state - exported for iconBackgroundCrawler to update
const loadingIcons = new Set<string>();

// Force update listeners - use callback ref to avoid stale closures
let forceUpdateCallbacks: (() => void)[] = [];

export function setIconLoading(iconKey: string, loading: boolean): void {
  if (loading) {
    loadingIcons.add(iconKey);
  } else {
    loadingIcons.delete(iconKey);
  }
  // Notify all listeners to force re-render
  forceUpdateCallbacks.forEach((callback) => callback());
}

export function isIconLoading(iconKey: string): boolean {
  return loadingIcons.has(iconKey);
}

interface IconState {
  status: "placeholder" | "loading" | "cached" | "error";
  iconUri: string | null;
}

// Global counter to force re-renders across all hook instances
let updateCounter = 0;

export function useCachedIcon(iconKey: string | undefined): IconState {
  const [iconUri, setIconUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [_, setForceUpdate] = useState(0);

  useEffect(() => {
    if (!iconKey) {
      setIconUri(null);
      setLoading(false);
      return;
    }

    // Check cache on mount - but also check if icon is queued
    const checkCache = async () => {
      const cached = await getCachedIcon(iconKey);
      if (cached?.imageData) {
        setIconUri(`data:image/svg+xml;base64,${cached.imageData}`);
        setLoading(false);
        return;
      }

      // Check if icon is in the queue (needs loading state)
      const queued = await getQueuedIcons();
      const isQueued = queued.some((item) => item.icon_key === iconKey);

      if (isQueued || loadingIcons.has(iconKey)) {
        setLoading(true);
      }
      setIconUri(null);
    };

    checkCache();

    // Register for force updates
    const updateCallback = () => {
      setForceUpdate((c) => c + 1);
    };

    forceUpdateCallbacks.push(updateCallback);

    return () => {
      forceUpdateCallbacks = forceUpdateCallbacks.filter(
        (cb) => cb !== updateCallback,
      );
    };
  }, [iconKey]);

  // Check cache again on force update
  useEffect(() => {
    if (!iconKey) return;

    const checkCache = async () => {
      const cached = await getCachedIcon(iconKey);
      if (cached?.imageData) {
        setIconUri(`data:image/svg+xml;base64,${cached.imageData}`);
        setLoading(false);
      }
    };

    checkCache();
  }, [iconKey, _]); // _ is the force update counter

  // Determine status
  if (!iconKey) {
    return { status: "placeholder", iconUri: null };
  }

  if (loading) {
    return { status: "loading", iconUri: null };
  }

  if (iconUri) {
    return { status: "cached", iconUri };
  }

  return { status: "placeholder", iconUri: null };
}
