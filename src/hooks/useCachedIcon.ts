import { useEffect, useState } from "react";
import { getCachedIcon, getQueuedIcons } from "../../services/database";
import {
  addCacheUpdateListener,
  addLoadingListener,
  isIconLoading,
} from "../services/iconLoadingRegistry";

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

interface IconState {
  status: "placeholder" | "loading" | "cached" | "error";
  iconUri: string | null;
  format: string | null;
}

export function useCachedIcon(iconKey: string | undefined): IconState {
  const [iconUri, setIconUri] = useState<string | null>(null);
  const [format, setFormat] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [_, setForceUpdate] = useState(0);

  useEffect(() => {
    if (!iconKey) {
      setIconUri(null);
      setFormat(null);
      setLoading(false);
      return;
    }

    let active = true;

    // Check cache on mount - but also check if icon is queued
    const checkCache = async () => {
      const cached = await getCachedIcon(iconKey);
      if (!active) return;

      if (cached?.imageData) {
        const mime = mimeForFormat(cached.format);
        setIconUri(`data:${mime};base64,${cached.imageData}`);
        setFormat(cached.format);
        setLoading(false);
        return;
      }

      // Check if icon is in the queue (needs loading state)
      const queued = await getQueuedIcons();
      if (!active) return;

      const isQueued = queued.some((item) => item.icon_key === iconKey);

      if (isQueued || isIconLoading(iconKey)) {
        setLoading(true);
      } else {
        setLoading(false);
      }
      setIconUri(null);
      setFormat(null);
    };

    checkCache();

    // Listen for loading state changes
    const unsubscribeLoading = addLoadingListener(() => {
      if (!active) return;
      setForceUpdate((c) => c + 1);
    });

    // Listen for cache updates (icon picker changes)
    const unsubscribeCache = addCacheUpdateListener(() => {
      if (!active) return;
      setForceUpdate((c) => c + 1);
    });

    return () => {
      active = false;
      unsubscribeLoading();
      unsubscribeCache();
    };
  }, [iconKey]);

  // Check cache again on force update
  useEffect(() => {
    if (!iconKey) return;

    let active = true;

    const checkCache = async () => {
      const cached = await getCachedIcon(iconKey);
      if (!active) return;

      if (cached?.imageData) {
        const mime = mimeForFormat(cached.format);
        setIconUri(`data:${mime};base64,${cached.imageData}`);
        setFormat(cached.format);
        setLoading(false);
      } else {
        // No cached data - clear loading if icon is no longer queued
        const queued = await getQueuedIcons();
        if (!active) return;
        const isQueued = queued.some((item) => item.icon_key === iconKey);
        if (!isQueued && !isIconLoading(iconKey)) {
          setLoading(false);
        }
      }
    };

    checkCache();

    return () => {
      active = false;
    };
  }, [iconKey, _]); // _ is the force update counter

  // Determine status
  if (!iconKey) {
    return { status: "placeholder", iconUri: null, format: null };
  }

  if (loading) {
    return { status: "loading", iconUri: null, format: null };
  }

  if (iconUri) {
    return { status: "cached", iconUri, format };
  }

  return { status: "placeholder", iconUri: null, format: null };
}
