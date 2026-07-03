import {
  getSyncMetadata,
  SyncMetadata,
  updateSyncMetadata,
} from "@/services/database";
import { CloudSyncService } from "@/src/services/cloudsync/CloudSyncService";
import { CloudProvider, SyncResult } from "@/src/services/cloudsync/types";
import { useUser } from "@clerk/expo";
import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
  connectProvider: (
    provider: CloudProvider,
    config?: { serverUrl?: string },
  ) => Promise<boolean>;
  authenticate: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  sync: () => Promise<SyncResult>;
  toggleSync: (enabled: boolean) => Promise<void>;
}

const CloudSyncContext = createContext<CloudSyncContextType | undefined>(
  undefined,
);

export const CloudSyncProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useUser();
  const cloudSyncServiceRef = useRef<CloudSyncService | null>(null);
  const [cloudSyncService, setCloudSyncService] =
    useState<CloudSyncService | null>(null);
  const [syncMetadata, setSyncMetadata] = useState<SyncMetadata | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  const userId = user?.id;

  const loadSyncMetadata = useCallback(async () => {
    try {
      const metadata = await getSyncMetadata();
      setSyncMetadata(metadata);

      // If sync is enabled, initialize the provider
      if (metadata.syncEnabled && metadata.provider) {
        const service = new CloudSyncService(userId || "anonymous");
        // Use dedicated serverUrl field for ownCloud/Nextcloud (not remoteFileId)
        const serverUrl =
          metadata.provider === "owncloud" || metadata.provider === "nextcloud"
            ? (metadata.serverUrl ?? undefined)
            : undefined;
        await service.initializeProvider(metadata.provider as CloudProvider, {
          serverUrl,
        });
        cloudSyncServiceRef.current = service;
        setCloudSyncService(service);
        setIsInitialized(true);
      }
    } catch (error) {
      console.error("Failed to load sync metadata:", error);
    }
  }, [userId]);

  // Load sync metadata on mount and when userId changes
  useEffect(() => {
    if (userId) {
      loadSyncMetadata();
    }
  }, [userId, loadSyncMetadata]);

  const initializeProvider = useCallback(
    async (provider: CloudProvider, config?: { serverUrl?: string }) => {
      try {
        const service = new CloudSyncService(userId || "anonymous");
        await service.initializeProvider(provider, config);
        cloudSyncServiceRef.current = service;
        setCloudSyncService(service);

        // Persist serverUrl in sync metadata for ownCloud/Nextcloud
        // Clear stale remote fields when switching providers
        const metadataUpdates: any = {
          provider,
          syncEnabled: true,
          serverUrl:
            provider === "owncloud" || provider === "nextcloud"
              ? (config?.serverUrl ?? null)
              : null,
        };

        await updateSyncMetadata(metadataUpdates);

        // Update local state directly instead of reloading metadata
        setSyncMetadata(await getSyncMetadata());
        setIsInitialized(true);
      } catch (error) {
        console.error("Failed to initialize provider:", error);
        throw error;
      }
    },
    [userId, loadSyncMetadata],
  );

  const authenticate = useCallback(async () => {
    const service = cloudSyncServiceRef.current;
    if (!service) {
      throw new Error("No provider initialized");
    }
    // Check if already authenticated
    const isAuth = await service.isAuthenticated();
    if (!isAuth) {
      Alert.alert(
        "Authentication Required",
        "Please authenticate with your cloud provider in the settings.",
      );
    }
    return isAuth;
  }, []);

  const connectProvider = useCallback(
    async (provider: CloudProvider, config?: { serverUrl?: string }) => {
      try {
        // Initialize the provider first
        await initializeProvider(provider, config);
      } catch (error) {
        console.error("Failed to initialize provider:", error);
        Alert.alert(
          "Connection Failed",
          error instanceof Error
            ? error.message
            : "Failed to connect cloud provider",
        );
        return false;
      }

      const service = cloudSyncServiceRef.current;
      if (!service) {
        return true;
      }

      // Check if OAuth credentials are configured
      const hasOAuthCredentials =
        provider === "google_drive"
          ? !!process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID
          : provider === "onedrive"
            ? !!process.env.EXPO_PUBLIC_ONEDRIVE_CLIENT_ID
            : provider === "dropbox"
              ? !!process.env.EXPO_PUBLIC_DROPBOX_APP_KEY
              : provider === "owncloud" || provider === "nextcloud"
                ? true // ownCloud/Nextcloud use their own auth
                : false;

      if (!hasOAuthCredentials) {
        Alert.alert(
          "Cloud Sync Not Available",
          "This feature requires developer configuration. Please contact the app developer to enable Google Drive/OneDrive/Dropbox sync.",
        );
        return true; // Still return true to mark as "connected" but without auth
      }

      // Perform OAuth flow
      let authSuccess = false;

      try {
        if (provider === "google_drive") {
          const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
          if (!clientId) {
            throw new Error("Google client ID not configured");
          }

          const redirectUri = AuthSession.makeRedirectUri();
          const discovery = {
            authorizationEndpoint:
              "https://accounts.google.com/o/oauth2/v2/auth",
            tokenEndpoint: "https://oauth2.googleapis.com/token",
          };

          const authRequest = new AuthSession.AuthRequest({
            clientId,
            scopes: [
              "https://www.googleapis.com/auth/drive.appdata",
              "https://www.googleapis.com/auth/drive.file",
            ],
            redirectUri,
          });

          const result = await authRequest.promptAsync(discovery);

          if (result.type === "success") {
            const tokens = {
              accessToken: result.params.accessToken,
              refreshToken: result.params.refreshToken,
              expiresAt: result.params.expiresIn
                ? Date.now() + parseInt(result.params.expiresIn) * 1000
                : undefined,
            };
            await SecureStore.setItemAsync(
              `gdrive_tokens_${userId || "anonymous"}`,
              JSON.stringify(tokens),
            );
            authSuccess = true;
          }
        } else if (provider === "onedrive") {
          const clientId = process.env.EXPO_PUBLIC_ONEDRIVE_CLIENT_ID;
          if (!clientId) {
            throw new Error("OneDrive client ID not configured");
          }

          const redirectUri = AuthSession.makeRedirectUri();
          const discovery = {
            authorizationEndpoint:
              "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            tokenEndpoint:
              "https://login.microsoftonline.com/common/oauth2/v2.0/token",
          };

          const authRequest = new AuthSession.AuthRequest({
            clientId,
            scopes: ["Files.ReadWrite.AppFolder", "offline_access"],
            redirectUri,
          });

          const result = await authRequest.promptAsync(discovery);

          if (result.type === "success") {
            const tokens = {
              accessToken: result.params.accessToken,
              refreshToken: result.params.refreshToken,
              expiresAt: result.params.expiresIn
                ? Date.now() + parseInt(result.params.expiresIn) * 1000
                : undefined,
            };
            await SecureStore.setItemAsync(
              `onedrive_tokens_${userId || "anonymous"}`,
              JSON.stringify(tokens),
            );
            authSuccess = true;
          }
        } else if (provider === "dropbox") {
          const appKey = process.env.EXPO_PUBLIC_DROPBOX_APP_KEY;
          if (!appKey) {
            throw new Error("Dropbox app key not configured");
          }

          const redirectUri = AuthSession.makeRedirectUri();
          const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${appKey}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}`;

          const result = await WebBrowser.openAuthSessionAsync(
            authUrl,
            redirectUri,
          );

          if (result.type === "success") {
            const url = new URL(result.url);
            const accessToken = url.hash?.match(/access_token=([^&]+)/)?.[1];
            if (accessToken) {
              const tokens = { accessToken };
              await SecureStore.setItemAsync(
                `dropbox_tokens_${userId || "anonymous"}`,
                JSON.stringify(tokens),
              );
              authSuccess = true;
            }
          }
        } else if (provider === "owncloud" || provider === "nextcloud") {
          // ownCloud/Nextcloud use their own authentication
          authSuccess = await service.isAuthenticated();
        }

        if (
          !authSuccess &&
          provider !== "owncloud" &&
          provider !== "nextcloud"
        ) {
          // No tokens stored - auth was skipped or failed
          return true;
        }

        return true;
      } catch (error) {
        console.error("OAuth flow failed:", error);
        Alert.alert(
          "Connection Failed",
          error instanceof Error
            ? error.message
            : "Failed to connect cloud provider",
        );
        return false;
      }
    },
    [initializeProvider, userId],
  );

  const disconnect = useCallback(async () => {
    const service = cloudSyncServiceRef.current;
    if (!service) return;

    await service.disconnect();
    cloudSyncServiceRef.current = null;
    setCloudSyncService(null);
    setIsInitialized(false);

    await updateSyncMetadata({
      syncEnabled: false,
      provider: null,
      providerUserId: null,
      remoteFileId: null,
      remoteFileHash: null,
      remoteFileModified: null,
      lastSyncTimestamp: null,
      serverUrl: null,
    });

    await loadSyncMetadata();
  }, [loadSyncMetadata]);

  const sync = useCallback(async (): Promise<SyncResult> => {
    const service = cloudSyncServiceRef.current;
    if (!service || !syncMetadata?.syncEnabled) {
      return { success: false, synced: false, error: "Sync not initialized" };
    }

    setIsSyncing(true);
    setLastSyncResult(null);

    try {
      const result = await service.sync();
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
  }, [syncMetadata, loadSyncMetadata]);

  const toggleSync = useCallback(
    async (enabled: boolean) => {
      try {
        await updateSyncMetadata({
          syncEnabled: enabled,
        });
        await loadSyncMetadata();
      } catch (error) {
        console.error("Failed to toggle sync:", error);
        throw error;
      }
    },
    [loadSyncMetadata],
  );

  const value: CloudSyncContextType = {
    cloudSyncService,
    syncMetadata,
    isInitialized,
    isSyncing,
    lastSyncResult,
    initializeProvider,
    connectProvider,
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
