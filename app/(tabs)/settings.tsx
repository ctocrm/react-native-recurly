import images from "@/constants/images";
import ConflictResolutionModal from "@/src/components/ConflictResolutionModal";
import UserSettingsModal from "@/src/components/UserSettingsModal";
import { useCloudSync } from "@/src/context/CloudSyncContext";
import { useDatabase } from "@/src/context/DatabaseProvider";
import { useSubscriptions } from "@/src/context/SubscriptionContext";
import { useClerk, useUser } from "@clerk/expo";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { styled } from "nativewind";
import { usePostHog } from "posthog-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";
import {
  executeImportActions,
  executeNonConflictingImport,
  exportBackup,
  importBackup,
  type ImportScanResult,
} from "../../services/database";

const SafeAreaView = styled(RNSafeAreaView);

const Settings = () => {
  const { signOut } = useClerk();
  const { user } = useUser();

  // State for user settings modal
  const [userSettingsVisible, setUserSettingsVisible] = useState(false);
  const posthog = usePostHog();
  const { isReady } = useDatabase();
  const { refreshSubscriptions } = useSubscriptions();
  const {
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
  } = useCloudSync();

  const [exporting, setExporting] = useState(false);
  const [importStep, setImportStep] = useState<
    "idle" | "selecting" | "scanning" | "resolving" | "importing" | "done"
  >("idle");
  const [importResult, setImportResult] = useState<{
    totalRows: number;
    conflictingIds: string[];
    conflictingRows: Record<string, any>[];
    merged?: number;
    duplicated?: number;
  } | null>(null);
  const [importUri, setImportUri] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<
    | "google_drive"
    | "onedrive"
    | "dropbox"
    | "owncloud"
    | "nextcloud"
    | "icloud"
  >("google_drive");
  const [owncloudServerUrl, setOwncloudServerUrl] = useState("");

  // State for the conflict resolution modal
  const [conflictModalVisible, setConflictModalVisible] = useState(false);
  const [conflictRows, setConflictRows] = useState<
    {
      id: string;
      name: string;
      price: number;
      plan?: string;
      category?: string;
      billing?: string;
      status?: string;
    }[]
  >([]);

  // ---------------------------------------------------------------------------
  // Sign Out
  // ---------------------------------------------------------------------------

  const handleSignOut = async () => {
    posthog.capture("user_signed_out");
    try {
      await signOut();
      posthog.reset();
    } catch (error) {
      console.error("Sign-out failed:", error);
    }
  };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  const handleExport = async () => {
    if (!isReady) return;
    setExporting(true);
    posthog.capture("settings_export_started");

    try {
      const tempPath = await exportBackup();
      await Sharing.shareAsync(tempPath, {
        mimeType: "application/octet-stream",
        dialogTitle: "Save Encrypted Database Backup",
      });
      posthog.capture("settings_export_completed");
    } catch (error) {
      console.error("Export failed:", error);
      posthog.capture("settings_export_failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setExporting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  const handleImport = async () => {
    if (!isReady) return;
    setImportStep("selecting");
    setImportResult(null);
    setImportUri(null);
    setConflictRows([]);
    posthog.capture("settings_import_started");

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        setImportStep("idle");
        return;
      }

      const file = result.assets?.[0];
      if (!file) {
        setImportStep("idle");
        return;
      }

      const fileUri = file.uri;
      setImportUri(fileUri);
      setImportStep("scanning");

      const scanResult: ImportScanResult = await importBackup(fileUri);

      if (scanResult.conflictingIds.length > 0) {
        setImportResult({
          totalRows: scanResult.totalRows,
          conflictingIds: scanResult.conflictingIds,
          conflictingRows: scanResult.conflictingRows,
        });

        // Map real imported rows for the conflict resolution modal
        const rows = scanResult.conflictingRows.map((row) => ({
          id: row.id,
          name: row.name,
          price: row.price,
          plan: row.plan,
          category: row.category,
          billing: row.billing,
          status: row.status,
        }));
        setConflictRows(rows);

        // Open the conflict resolution modal
        setImportStep("resolving");
        setConflictModalVisible(true);
      } else {
        // No conflicts — import all rows
        setImportStep("importing");
        const imported = await executeNonConflictingImport(fileUri, []);
        await refreshSubscriptions();
        setImportResult((prev) =>
          prev
            ? {
                ...prev,
                totalRows: imported,
                duplicated: imported,
              }
            : {
                totalRows: imported,
                conflictingIds: [],
                conflictingRows: [],
                duplicated: imported,
              },
        );
        setImportStep("done");
        posthog.capture("settings_import_completed", {
          rows_imported: imported,
        });
      }
    } catch (error) {
      console.error("Import failed:", error);
      setImportStep("idle");
      posthog.capture("settings_import_failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Conflict Resolution Callback
  // ---------------------------------------------------------------------------

  const handleConflictResolve = async (
    actions: {
      id: string;
      action: "merge_skip" | "merge_overwrite" | "duplicate";
      newId?: string;
    }[],
  ) => {
    if (!importUri) return;

    setConflictModalVisible(false);
    setImportStep("importing");

    try {
      // Execute conflict actions
      const { merged, duplicated } = await executeImportActions(
        importUri,
        actions,
      );

      // Import non-conflicting rows unconditionally from the backup
      const imported = await executeNonConflictingImport(
        importUri,
        importResult?.conflictingIds ?? [],
      );

      await refreshSubscriptions();
      setImportResult((prev) =>
        prev
          ? {
              ...prev,
              totalRows: (prev.totalRows ?? 0) + imported,
              merged,
              duplicated: duplicated + imported,
            }
          : null,
      );
      setImportStep("done");
      posthog.capture("settings_import_resolved", { merged, duplicated });
    } catch (error) {
      console.error("Conflict resolution failed:", error);
      setImportStep("idle");
    }
  };

  const handleConflictCancel = () => {
    setConflictModalVisible(false);
    setImportStep("idle");
    posthog.capture("settings_import_cancelled");
  };

  // ---------------------------------------------------------------------------
  // Reset import state
  // ---------------------------------------------------------------------------

  const resetImport = () => {
    setImportStep("idle");
    setImportResult(null);
    setImportUri(null);
  };

  // ---------------------------------------------------------------------------
  // Cloud Sync
  // ---------------------------------------------------------------------------

  const handleConnectProvider = async () => {
    try {
      const config: { serverUrl?: string } = {};
      if (
        (selectedProvider === "owncloud" || selectedProvider === "nextcloud") &&
        owncloudServerUrl
      ) {
        config.serverUrl = owncloudServerUrl;
      }
      // connectProvider performs both initialization and OAuth in one call
      const authResult = await connectProvider(
        selectedProvider,
        config.serverUrl ? config : undefined,
      );
      if (authResult) {
        Alert.alert("Success", "Cloud provider connected successfully");
        posthog.capture("cloud_provider_connected", {
          provider: selectedProvider,
        });
      }
    } catch (error) {
      console.error("Failed to connect provider:", error);
      Alert.alert(
        "Error",
        error instanceof Error
          ? error.message
          : "Failed to connect cloud provider",
      );
    }
  };

  const handleDisconnectProvider = async () => {
    Alert.alert(
      "Disconnect Cloud Sync",
      "Are you sure you want to disconnect from your cloud provider?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await disconnect();
              Alert.alert("Success", "Cloud sync disconnected");
              posthog.capture("cloud_provider_disconnected");
            } catch (error) {
              console.error("Failed to disconnect:", error);
              Alert.alert("Error", "Failed to disconnect cloud provider");
            }
          },
        },
      ],
    );
  };

  const handleSync = async () => {
    try {
      const result = await sync();
      if (result.success && result.synced) {
        Alert.alert(
          "Synced",
          result.message || "Your data has been synchronized successfully",
        );
        posthog.capture("cloud_sync_completed");
      } else if (result.success && !result.synced) {
        // Sync succeeded but no changes were needed
        Alert.alert(
          "No Changes",
          result.message || "Your data is already up to date",
        );
      } else if (!result.success) {
        Alert.alert("Sync Failed", result.error || "Unknown error occurred");
        if (result.error) {
          posthog.capture("cloud_sync_failed", { error: result.error });
        }
      }
    } catch (error) {
      console.error("Sync failed:", error);
      Alert.alert("Error", "Sync operation failed");
    }
  };

  const handleToggleSync = async (enabled: boolean) => {
    try {
      await toggleSync(enabled);
      posthog.capture("cloud_sync_toggled", { enabled });
    } catch (error) {
      console.error("Failed to toggle sync:", error);
      Alert.alert("Error", "Failed to update sync setting");
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const displayName =
    user?.firstName ||
    user?.fullName ||
    user?.emailAddresses[0]?.emailAddress ||
    "User";
  const email = user?.emailAddresses[0]?.emailAddress;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        className="flex-1 p-5"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-25"
      >
        <Text className="text-3xl font-sans-bold text-primary mb-6">
          Settings
        </Text>

        {/* User Profile Section */}
        <View className="auth-card mb-5">
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center gap-4">
              <Image
                source={user?.imageUrl ? { uri: user.imageUrl } : images.avatar}
                className="size-16 rounded-full"
              />
              <View className="flex-1">
                <Text className="text-lg font-sans-bold text-primary">
                  {displayName}
                </Text>
                {email && (
                  <Text className="text-sm font-sans-medium text-muted-foreground">
                    {email}
                  </Text>
                )}
              </View>
            </View>
            <Pressable
              className="rounded-xl bg-accent/10 px-4 py-2"
              onPress={() => setUserSettingsVisible(true)}
            >
              <Text className="text-sm font-sans-semibold text-accent">
                Edit Profile
              </Text>
            </Pressable>
          </View>
        </View>

        {/* User Settings Modal */}
        <UserSettingsModal
          visible={userSettingsVisible}
          onClose={() => setUserSettingsVisible(false)}
        />

        {/* Account Section */}
        <View className="auth-card mb-5">
          <Text className="text-base font-sans-semibold text-primary mb-3">
            Account
          </Text>
          <View className="gap-2">
            <View className="flex-row justify-between items-center py-2">
              <Text className="text-sm font-sans-medium text-muted-foreground">
                Account ID
              </Text>
              <Text
                className="text-sm font-sans-medium text-primary"
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {user?.id
                  ? `${user.id.substring(0, 20)}${user.id.length > 20 ? "..." : ""}`
                  : "N/A"}
              </Text>
            </View>
            <View className="flex-row justify-between items-center py-2">
              <Text className="text-sm font-sans-medium text-muted-foreground">
                Joined
              </Text>
              <Text className="text-sm font-sans-medium text-primary">
                {user?.createdAt
                  ? new Date(user.createdAt).toLocaleDateString()
                  : "N/A"}
              </Text>
            </View>
          </View>
        </View>

        {/* Cloud Sync Section */}
        <View className="auth-card mb-5">
          <Text className="text-base font-sans-semibold text-primary mb-3">
            Cloud Sync
          </Text>

          {syncMetadata?.syncEnabled && syncMetadata.provider ? (
            // Connected state
            <>
              <View className="flex-row justify-between items-center py-2 mb-3">
                <View className="flex-1">
                  <Text className="text-sm font-sans-medium text-primary mb-1">
                    {syncMetadata.provider!.replace(/_/g, " ").toUpperCase()}
                  </Text>
                  <Text className="text-xs font-sans-medium text-muted-foreground">
                    {syncMetadata.providerUserId || "Connected"}
                  </Text>
                </View>
                <View className="items-end">
                  {isSyncing && (
                    <ActivityIndicator size="small" color="#007AFF" />
                  )}
                </View>
              </View>

              {lastSyncResult && (
                <View className="rounded-xl border border-border bg-card p-3 mb-3">
                  <Text className="text-xs font-sans-medium text-muted-foreground">
                    Last sync:{" "}
                    {lastSyncResult.success ? (
                      "Success"
                    ) : (
                      <>{`Failed${lastSyncResult.error ? ` - ${lastSyncResult.error}` : ""}`}</>
                    )}
                  </Text>
                </View>
              )}

              <View className="gap-2">
                <Pressable
                  className={`auth-button bg-accent ${!isInitialized || isSyncing ? "opacity-50" : ""}`}
                  onPress={handleSync}
                  disabled={!isInitialized || isSyncing}
                >
                  {isSyncing ? (
                    <View className="flex-row items-center justify-center gap-2">
                      <ActivityIndicator size="small" color="white" />
                      <Text className="auth-button-text text-white">
                        Syncing...
                      </Text>
                    </View>
                  ) : (
                    <Text className="auth-button-text text-white">
                      Sync Now
                    </Text>
                  )}
                </Pressable>

                <Pressable
                  className="auth-button bg-destructive"
                  onPress={handleDisconnectProvider}
                >
                  <Text className="auth-button-text text-white">
                    Disconnect
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            // Not connected state
            <>
              <Text className="text-sm font-sans-medium text-muted-foreground mb-3">
                Connect your preferred cloud storage provider to enable
                automatic sync
              </Text>

              <View className="gap-2 mb-3">
                {(() => {
                  const providers = [
                    {
                      id: "google_drive",
                      label: "Google Drive",
                      icon: "google" as const,
                    },
                    {
                      id: "onedrive",
                      label: "OneDrive",
                      icon: "microsoft" as const,
                    },
                    {
                      id: "dropbox",
                      label: "Dropbox",
                      icon: "dropbox" as const,
                    },
                    { id: "icloud", label: "iCloud", icon: "apple" as const },
                    {
                      id: "owncloud",
                      label: "ownCloud",
                      icon: "cloud" as const,
                    },
                    {
                      id: "nextcloud",
                      label: "Nextcloud",
                      icon: "cloud" as const,
                    },
                  ];

                  if (Platform.OS === "ios") {
                    return [
                      providers.find((p) => p.id === "icloud")!,
                      providers.find((p) => p.id === "google_drive")!,
                      providers.find((p) => p.id === "onedrive")!,
                      providers.find((p) => p.id === "dropbox")!,
                      providers.find((p) => p.id === "owncloud")!,
                      providers.find((p) => p.id === "nextcloud")!,
                    ];
                  } else if (Platform.OS === "android") {
                    return [
                      providers.find((p) => p.id === "google_drive")!,
                      providers.find((p) => p.id === "icloud")!,
                      providers.find((p) => p.id === "onedrive")!,
                      providers.find((p) => p.id === "dropbox")!,
                      providers.find((p) => p.id === "owncloud")!,
                      providers.find((p) => p.id === "nextcloud")!,
                    ];
                  }

                  return providers;
                })().map((provider) => (
                  <Pressable
                    key={provider.id}
                    className={`flex-row items-center gap-3 p-3 rounded-xl border ${
                      selectedProvider === provider.id
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card"
                    }`}
                    onPress={() => setSelectedProvider(provider.id as any)}
                  >
                    <View
                      className={`size-5 rounded-full border-2 items-center justify-center ${
                        selectedProvider === provider.id
                          ? "border-primary bg-primary"
                          : "border-muted-foreground"
                      }`}
                    >
                      {selectedProvider === provider.id && (
                        <Text className="text-white text-xs">✓</Text>
                      )}
                    </View>
                    <FontAwesome6
                      name={provider.icon}
                      size={20}
                      color="#6B7280"
                      style={{ width: 24 }}
                    />
                    <Text className="text-sm font-sans-medium text-primary">
                      {provider.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {(selectedProvider === "owncloud" ||
                selectedProvider === "nextcloud") && (
                <View className="mb-3">
                  <Text className="text-sm font-sans-medium text-muted-foreground mb-2">
                    Server URL
                  </Text>
                  <TextInput
                    className="rounded-xl border border-border bg-card p-3 text-sm font-sans-medium text-primary"
                    placeholder="Enter your ownCloud/Nextcloud server URL"
                    placeholderTextColor="#9CA3AF"
                    value={owncloudServerUrl}
                    onChangeText={setOwncloudServerUrl}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                </View>
              )}

              <Pressable
                className="auth-button bg-accent"
                onPress={handleConnectProvider}
              >
                <Text className="auth-button-text text-white">Connect</Text>
              </Pressable>
            </>
          )}
        </View>

        {/* Backup Section */}
        <View className="auth-card mb-5">
          <Text className="text-base font-sans-semibold text-primary mb-3">
            Backup & Restore
          </Text>

          {/* Export Backup */}
          <Pressable
            className={`auth-button bg-accent mb-3 ${exporting || !isReady ? "opacity-50" : ""}`}
            onPress={handleExport}
            disabled={exporting || !isReady}
          >
            {exporting ? (
              <View className="flex-row items-center justify-center gap-2">
                <ActivityIndicator size="small" color="white" />
                <Text className="auth-button-text text-white">
                  Exporting...
                </Text>
              </View>
            ) : (
              <Text className="auth-button-text text-white">Export Backup</Text>
            )}
          </Pressable>
          <Text className="text-xs font-sans-medium text-muted-foreground mb-3">
            Export your encrypted database to share/save via the native share
            sheet. The backup is fully encrypted with your personal key.
          </Text>

          {/* Import Backup */}
          {importStep === "idle" && (
            <Pressable
              className={`auth-button bg-primary ${!isReady ? "opacity-50" : ""}`}
              onPress={handleImport}
              disabled={!isReady}
            >
              <Text className="auth-button-text text-white">Import Backup</Text>
            </Pressable>
          )}

          {/* Import progress states */}
          {importStep === "scanning" && (
            <View className="flex-row items-center justify-center gap-2 py-4">
              <ActivityIndicator size="small" />
              <Text className="text-sm font-sans-medium text-muted-foreground">
                Scanning backup file...
              </Text>
            </View>
          )}

          {importStep === "importing" && (
            <View className="flex-row items-center justify-center gap-2 py-4">
              <ActivityIndicator size="small" />
              <Text className="text-sm font-sans-medium text-muted-foreground">
                Importing data...
              </Text>
            </View>
          )}

          {importStep === "done" && importResult && (
            <View className="rounded-2xl border border-border bg-card p-4">
              <View className="items-center gap-2">
                <View className="size-10 items-center justify-center rounded-full bg-green-100">
                  <Text className="text-green-600 text-lg">✓</Text>
                </View>
                <Text className="text-base font-sans-bold text-primary">
                  Import Complete
                </Text>
                <Text className="text-sm font-sans-medium text-muted-foreground text-center">
                  {importResult.duplicated && importResult.duplicated > 0
                    ? `${importResult.duplicated} subscriptions imported`
                    : "No new subscriptions imported"}
                  {importResult.merged && importResult.merged > 0
                    ? `, ${importResult.merged} merged`
                    : ""}
                </Text>
                <Pressable
                  className="mt-2 rounded-xl bg-accent px-6 py-2"
                  onPress={resetImport}
                >
                  <Text className="text-sm font-sans-bold text-white">
                    Done
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* Sign Out Button */}
        <Pressable
          className="auth-button bg-destructive mt-2"
          onPress={handleSignOut}
        >
          <Text className="auth-button-text text-white">Sign Out</Text>
        </Pressable>
      </ScrollView>

      {/* Conflict Resolution Modal */}
      <ConflictResolutionModal
        visible={conflictModalVisible}
        conflicts={conflictRows}
        onResolve={handleConflictResolve}
        onCancel={handleConflictCancel}
      />
    </SafeAreaView>
  );
};

export default Settings;
