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
import { mimeForFormat, upscaleIconIfSmall } from "../services/iconUpscaler";

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
          await applyCachedImage(cached, active);
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
          await applyCachedImage(cached, active);
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

  // Apply a cached icon row to the hook state, upscaling + persisting any
  // small raster icon once and reflecting the upscaled bytes/format.
  const applyCachedImage = async (
    cached: {
      imageData: string;
      format: string;
      source?: string | null;
      originalUrl?: string | null;
    },
    active: boolean,
  ): Promise<void> => {
    const { base64: upscaled, format: outFormat } = await upscaleIconIfSmall(
      cached.imageData,
      cached.format,
    );
    if (upscaled !== cached.imageData && active) {
      await setCachedIcon(
        iconKey!,
        upscaled,
        cached.source ?? "local",
        outFormat,
        cached.originalUrl ?? undefined,
      );
    }
    if (!active) return;
    const mime = mimeForFormat(outFormat);
    setIconUri(`data:${mime};base64,${upscaled}`);
    setFormat(outFormat);
    setLoading(false);
  };

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
