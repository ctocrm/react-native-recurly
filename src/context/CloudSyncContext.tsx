import {
  getSyncMetadata,
  SyncMetadata,
  updateSyncMetadata,
} from "@/services/database";
import { CloudSyncService } from "@/src/services/cloudsync/CloudSyncService";
import { CloudProvider, SyncResult } from "@/src/services/cloudsync/types";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Alert } from "react-native";

interface CloudSyncContextType {
  cloudSyncService: CloudSyncService | null;
  syncMetadata: SyncMetadata | null;
  isInitialized: boolean;
  isSyncing: boolean;
  lastSyncResult: SyncResult | null;

  initializeProvider: (
    provider: CloudProvider,
    config?: { serverUrl?: string },
  ) => Promise<void>;
  authenticate: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  sync: () => Promise<SyncResult>;
  toggleSync: (enabled: boolean) => Promise<void>;
}

const CloudSyncContext = createContext<CloudSyncContextType | undefined>(
  undefined,
);

export const CloudSyncProvider = ({ children }: { children: ReactNode }) => {
  const [cloudSyncService, setCloudSyncService] =
    useState<CloudSyncService | null>(null);
  const [syncMetadata, setSyncMetadata] = useState<SyncMetadata | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  // Load sync metadata on mount
  useEffect(() => {
    loadSyncMetadata();
  }, []);

  const loadSyncMetadata = async () => {
    try {
      const metadata = await getSyncMetadata();
      setSyncMetadata(metadata);

      // If sync is enabled, initialize the provider
      if (metadata.syncEnabled && metadata.provider) {
        const service = new CloudSyncService("current_user"); // Will be replaced with actual user ID
        await service.initializeProvider(metadata.provider as CloudProvider, {
          serverUrl:
            metadata.provider === "owncloud" ||
            metadata.provider === "nextcloud"
              ? "" // Will need to be stored separately
              : undefined,
        });
        setCloudSyncService(service);
        setIsInitialized(true);
      }
    } catch (error) {
      console.error("Failed to load sync metadata:", error);
    }
  };

  const initializeProvider = useCallback(
    async (provider: CloudProvider, config?: { serverUrl?: string }) => {
      try {
        const service = new CloudSyncService("current_user");
        await service.initializeProvider(provider, config);
        setCloudSyncService(service);

        // Save to metadata
        await updateSyncMetadata({
          provider,
          syncEnabled: true,
        });

        await loadSyncMetadata();
        setIsInitialized(true);
      } catch (error) {
        console.error("Failed to initialize provider:", error);
        throw error;
      }
    },
    [],
  );

  const authenticate = useCallback(async () => {
    if (!cloudSyncService) {
      throw new Error("No provider initialized");
    }
    // Authentication is handled by the UI layer with expo-auth-session
    // This just checks if tokens exist
    const isAuth = await cloudSyncService.isAuthenticated();
    if (!isAuth) {
      Alert.alert(
        "Authentication Required",
        "Please authenticate with your cloud provider in the settings.",
      );
    }
    return isAuth;
  }, [cloudSyncService]);

  const disconnect = useCallback(async () => {
    if (!cloudSyncService) return;

    await cloudSyncService.disconnect();
    setCloudSyncService(null);
    setIsInitialized(false);

    await updateSyncMetadata({
      syncEnabled: false,
      provider: undefined,
      providerUserId: undefined,
      remoteFileId: undefined,
      remoteFileHash: undefined,
      remoteFileModified: undefined,
    });

    await loadSyncMetadata();
  }, [cloudSyncService]);

  const sync = useCallback(async (): Promise<SyncResult> => {
    if (!cloudSyncService || !syncMetadata?.syncEnabled) {
      return { success: false, synced: false, error: "Sync not initialized" };
    }

    setIsSyncing(true);
    setLastSyncResult(null);

    try {
      const result = await cloudSyncService.sync();
      setLastSyncResult(result);

      // Update metadata with any changes
      if (result.success && result.synced) {
        await loadSyncMetadata();
      }

      return result;
    } catch (error) {
      const errorResult: SyncResult = {
        success: false,
        synced: false,
        error: error instanceof Error ? error.message : "Sync failed",
      };
      setLastSyncResult(errorResult);
      return errorResult;
    } finally {
      setIsSyncing(false);
    }
  }, [cloudSyncService, syncMetadata]);

  const toggleSync = useCallback(async (enabled: boolean) => {
    try {
      await updateSyncMetadata({
        syncEnabled: enabled,
      });
      await loadSyncMetadata();
    } catch (error) {
      console.error("Failed to toggle sync:", error);
      throw error;
    }
  }, []);

  const value: CloudSyncContextType = {
    cloudSyncService,
    syncMetadata,
    isInitialized,
    isSyncing,
    lastSyncResult,
    initializeProvider,
    authenticate,
    disconnect,
    sync,
    toggleSync,
  };

  return (
    <CloudSyncContext.Provider value={value}>
      {children}
    </CloudSyncContext.Provider>
  );
};

export const useCloudSync = (): CloudSyncContextType => {
  const context = useContext(CloudSyncContext);
  if (!context) {
    throw new Error("useCloudSync must be used within a CloudSyncProvider");
  }
  return context;
};
