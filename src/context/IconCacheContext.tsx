import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { getCachedIcon } from "../../services/database";

interface IconCacheContextType {
  getCachedIconData: (iconKey: string) => Promise<string | null>;
  cachedIcons: Map<string, string>;
  isIconCached: (iconKey: string) => boolean;
  clearCache: () => void;
}

const IconCacheContext = createContext<IconCacheContextType | undefined>(
  undefined,
);

// In-memory cache for fast access
const iconCacheMap = new Map<string, string>();

export const IconCacheProvider = ({ children }: { children: ReactNode }) => {
  const [cachedIcons, setCachedIcons] = useState<Map<string, string>>(
    new Map(),
  );

  // Sync the exposed cache state with the in-memory map
  const syncCachedIcons = useCallback(() => {
    setCachedIcons(new Map(iconCacheMap));
  }, []);

  // Load cached icon into memory
  const getCachedIconData = useCallback(
    async (iconKey: string): Promise<string | null> => {
      // Check in-memory cache first
      if (iconCacheMap.has(iconKey)) {
        return iconCacheMap.get(iconKey) ?? null;
      }

      // Check database
      const cached = await getCachedIcon(iconKey);
      if (cached?.imageData) {
        iconCacheMap.set(iconKey, cached.imageData);
        // Keep exposed state in sync
        syncCachedIcons();
        return cached.imageData;
      }

      return null;
    },
    [syncCachedIcons],
  );

  const isIconCached = useCallback(
    (iconKey: string) => {
      return iconCacheMap.has(iconKey) || cachedIcons.has(iconKey);
    },
    [cachedIcons],
  );

  // Empty both the module-level in-memory map and the exposed state. The
  // database table is cleared separately by clearIconCache().
  const clearCache = useCallback(() => {
    iconCacheMap.clear();
    setCachedIcons(new Map());
  }, []);

  // No AppState listener here: DatabaseProvider is a child of this provider,
  // so the database may not be ready yet. Foreground queue processing is
  // handled by SubscriptionProvider which is inside DatabaseProvider.

  return (
    <IconCacheContext.Provider
      value={{
        getCachedIconData,
        cachedIcons,
        isIconCached,
        clearCache,
      }}
    >
      {children}
    </IconCacheContext.Provider>
  );
};

export const useIconCache = (): IconCacheContextType => {
  const context = useContext(IconCacheContext);
  if (!context) {
    throw new Error("useIconCache must be used within IconCacheProvider");
  }
  return context;
};
