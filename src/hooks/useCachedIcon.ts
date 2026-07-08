import { useEffect, useState } from "react";
import {
  getCachedIcon,
  getQueuedIcons,
  setCachedIcon,
} from "../../services/database";
import {
  addCacheUpdateListener,
  addLoadingListener,
  isIconLoading,
} from "../services/iconLoadingRegistry";
import { upscaleIconIfSmall } from "../services/iconUpscaler";

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

export type IconStatus =
  "placeholder" | "loading" | "cached" | "error" | "no_icon";

interface IconState {
  status: IconStatus;
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
        // A "local_asset:" sentinel in the cache is not a real image — it
        // means "use the static brand asset". Treat it as no override so the
        // card falls back to the bundled icon instead of a blank/broken URI.
        if (cached.imageData.startsWith("local_asset:")) {
          setIconUri(null);
          setFormat(null);
        } else {
          const mime = mimeForFormat(cached.format);
          // Upscale small raster icons (e.g. previously downloaded favicons)
          // once, and persist the upscaled bytes back so existing icons
          // stored before this feature also get crisp on the card.
          const displayData = await upscaleIconIfSmall(
            cached.imageData,
            cached.format,
          );
          if (displayData !== cached.imageData && active) {
            await setCachedIcon(
              iconKey,
              displayData,
              cached.source,
              cached.format,
              cached.originalUrl,
            );
          }
          setIconUri(`data:${mime};base64,${displayData}`);
          setFormat(cached.format);
          setLoading(false);
          return;
        }
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
        // "local_asset:" sentinel → no real override; render static asset.
        if (cached.imageData.startsWith("local_asset:")) {
          setIconUri(null);
          setFormat(null);
        } else {
          const mime = mimeForFormat(cached.format);
          // Same upscale + persist step as the mount path, for force updates.
          const displayData = await upscaleIconIfSmall(
            cached.imageData,
            cached.format,
          );
          if (displayData !== cached.imageData && active) {
            await setCachedIcon(
              iconKey,
              displayData,
              cached.source,
              cached.format,
              cached.originalUrl,
            );
          }
          setIconUri(`data:${mime};base64,${displayData}`);
          setFormat(cached.format);
          setLoading(false);
        }
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
    return { status: "no_icon", iconUri: null, format: null };
  }

  if (loading) {
    return { status: "loading", iconUri: null, format: null };
  }

  if (iconUri) {
    return { status: "cached", iconUri, format };
  }

  // iconKey exists but no cached data and not loading = no_icon
  return { status: "no_icon", iconUri: null, format: null };
}
