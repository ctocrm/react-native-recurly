import { useEffect, useState } from "react";
import {
  getCachedIcon,
  getCachedIconBatched,
  getQueuedIcons,
  setCachedIcon,
} from "@/services/database";
import {
  addCacheUpdateListener,
  addLoadingListener,
  isIconLoading,
} from "@/services/iconLoadingRegistry";
import { mimeForFormat, upscaleIconIfSmall } from "@/services/iconUpscaler";
import { isPaintableCardIcon } from "@/services/iconValidation";

// R25: every card used to re-read the WHOLE icon_crawl_queue table (then
// .some() over it) and re-read its own base64 blob — with 100+ cards that
// saturated mqt_v_js for ~10s at boot. Share one queued-set for 5s.
let queuedSetCache: { at: number; keys: Set<string> } | null = null;
async function queuedIconKeys(): Promise<Set<string>> {
  if (queuedSetCache && Date.now() - queuedSetCache.at < 5000) {
    return queuedSetCache.keys;
  }
  const queued = await getQueuedIcons();
  const keys = new Set(queued.map((item) => item.icon_key));
  queuedSetCache = { at: Date.now(), keys };
  return keys;
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
      const t0 = Date.now();
      const cached = await getCachedIconBatched(iconKey);
      const t1 = Date.now();
      if (!active) return;

      // A "local_asset:" sentinel in the cache is not a real image — it
      // means "use the static brand asset". Treat it as no override so the
      // card falls back to the bundled icon instead of a blank/broken URI.
      if (cached?.imageData) {
        if (cached.imageData.startsWith("local_asset:")) {
          setIconUri(null);
          setFormat(null);
        } else if (!isPaintableCardIcon(cached.imageData, cached.format)) {
          // Invalid/blank/SVG cache stays healable by hop 2; do not paint it.
          setIconUri(null);
          setFormat(null);
        } else {
          await applyCachedImage(cached, active);
          console.log(
            `[ICON] ${iconKey} applied readMs=${t1 - t0} ` +
              `totalMs=${Date.now() - t0} bytes=${cached.imageData.length}`,
          );
          return;
        }
      }

      // Check if icon is in the queue (needs loading state)
      const keys = await queuedIconKeys();
      if (!active) return;

      const isQueued = keys.has(iconKey);

      console.log(
        `[ICON] ${iconKey} checked readMs=${t1 - t0} ` +
          `queueMs=${Date.now() - t1} bytes=${cached?.imageData?.length ?? 0}`,
      );

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
      const cached = await getCachedIconBatched(iconKey);
      if (!active) return;

      if (cached?.imageData) {
        // "local_asset:" sentinel → no real override; render static asset.
        if (cached.imageData.startsWith("local_asset:")) {
          setIconUri(null);
          setFormat(null);
        } else if (!isPaintableCardIcon(cached.imageData, cached.format)) {
          setIconUri(null);
          setFormat(null);
        } else {
          await applyCachedImage(cached, active);
        }
      } else {
        // No cached data - clear loading if icon is no longer queued
        const keys = await queuedIconKeys();
        if (!active) return;
        const isQueued = keys.has(iconKey);
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
      const existing = await getCachedIcon(iconKey!);
      await setCachedIcon(
        iconKey!,
        upscaled,
        cached.source ?? "local",
        outFormat,
        cached.originalUrl ?? undefined,
        0,
        undefined,
        undefined,
        false,
        existing?.chosen === true,
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
