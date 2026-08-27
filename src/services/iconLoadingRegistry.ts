// Plain module-level loading-state registry - keeps iconBackgroundCrawler React-agnostic

const loadingIcons = new Set<string>();

export interface IconCrawlProgress {
  status:
    | "idle"
    | "discovering"
    | "fetching"
    | "deep_search"
    | "waiting_for_rate_limit"
    | "complete"
    | "partial"
    | "failed";
  detail: string;
  discoveredCount?: number;
  downloadedCount?: number;
  rejectedCount?: number;
  deferredCount?: number;
  spideredPages?: number;
}

const crawlProgressByIcon = new Map<string, IconCrawlProgress>();

// Force update listeners
const listenerCallbacks: (() => void)[] = [];

export function setIconLoading(iconKey: string, loading: boolean): void {
  if (loading) {
    loadingIcons.add(iconKey);
  } else {
    loadingIcons.delete(iconKey);
  }
  // Notify all listeners to force re-render
  listenerCallbacks.forEach((callback) => callback());
}

export function isIconLoading(iconKey: string): boolean {
  return loadingIcons.has(iconKey);
}

export function setIconCrawlProgress(
  iconKey: string,
  progress: IconCrawlProgress,
): void {
  crawlProgressByIcon.set(iconKey, progress);
  listenerCallbacks.forEach((callback) => callback());
}

export function getIconCrawlProgress(
  iconKey: string,
): IconCrawlProgress | null {
  return crawlProgressByIcon.get(iconKey) ?? null;
}

export function addLoadingListener(callback: () => void): () => void {
  listenerCallbacks.push(callback);
  return () => {
    const idx = listenerCallbacks.indexOf(callback);
    if (idx !== -1) listenerCallbacks.splice(idx, 1);
  };
}

// Cache update notification
const cacheUpdateCallbacks: (() => void)[] = [];

export function notifyCacheUpdate(): void {
  cacheUpdateCallbacks.forEach((callback) => callback());
}

export function addCacheUpdateListener(callback: () => void): () => void {
  cacheUpdateCallbacks.push(callback);
  return () => {
    const idx = cacheUpdateCallbacks.indexOf(callback);
    if (idx !== -1) cacheUpdateCallbacks.splice(idx, 1);
  };
}
