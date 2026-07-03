import { processIconQueue } from "@/src/services/iconBackgroundCrawler";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { getCachedIcon } from "../../services/database";

interface IconCacheContextType {
  getCachedIconData: (iconKey: string) => Promise<string | null>;
  cachedIcons: Map<string, string>;
  isIconCached: (iconKey: string) => boolean;
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
        return cached.imageData;
      }

      return null;
    },
    [],
  );

  const isIconCached = useCallback(
    (iconKey: string) => {
      return iconCacheMap.has(iconKey) || cachedIcons.has(iconKey);
    },
    [cachedIcons],
  );

  // Process crawled icons when app comes to foreground
  useEffect(() => {
    const handleAppStateChange = (state: string) => {
      if (state === "active") {
        processIconQueue().catch(console.error);
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );
    return () => subscription.remove();
  }, []);

  return (
    <IconCacheContext.Provider
      value={{
        getCachedIconData,
        cachedIcons,
        isIconCached,
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
