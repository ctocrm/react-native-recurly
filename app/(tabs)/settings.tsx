import images from "@/constants/images";
import ConflictResolutionModal from "@/src/components/ConflictResolutionModal";
import { useDatabase } from "@/src/context/DatabaseProvider";
import { useSubscriptions } from "@/src/context/SubscriptionContext";
import { useClerk, useUser } from "@clerk/expo";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { styled } from "nativewind";
import { usePostHog } from "posthog-react-native";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";
import {
  executeImportActions,
  executeNonConflictingImport,
  exportBackup,
  importBackup,
} from "../../services/database";

const SafeAreaView = styled(RNSafeAreaView);

const Settings = () => {
  const { signOut } = useClerk();
  const { user } = useUser();
  const posthog = usePostHog();
  const { isReady } = useDatabase();
  const { refreshSubscriptions } = useSubscriptions();

  const [exporting, setExporting] = useState(false);
  const [importStep, setImportStep] = useState<
    "idle" | "selecting" | "scanning" | "resolving" | "importing" | "done"
  >("idle");
  const [importResult, setImportResult] = useState<{
    totalRows: number;
    conflictingIds: string[];
    merged?: number;
    duplicated?: number;
  } | null>(null);
  const [importUri, setImportUri] = useState<string | null>(null);

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

      const scanResult = await importBackup(fileUri);

      if (scanResult.conflictingIds.length > 0) {
        setImportResult({
          totalRows: scanResult.totalRows,
          conflictingIds: scanResult.conflictingIds,
        });

        // Build conflict rows from IDs
        const rows = scanResult.conflictingIds.map((id) => ({
          id,
          name: `Subscription ${id.substring(0, 8)}...`,
          price: 0,
        }));
        setConflictRows(rows);

        // Open the conflict resolution modal
        setImportStep("resolving");
        setConflictModalVisible(true);
      } else {
        // No conflicts — direct import of all rows
        setImportStep("importing");
        const imported = await executeNonConflictingImport(fileUri, []);
        setImportResult({
          totalRows: imported,
          conflictingIds: [],
          merged: 0,
          duplicated: imported,
        });
        await refreshSubscriptions();
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

      // Import non-conflicting rows (rows that were not in the conflict list at all)
      const resolvedConflictIds = new Set(actions.map((a) => a.id));
      const nonConflictIds =
        importResult?.conflictingIds.filter(
          (id) => !resolvedConflictIds.has(id),
        ) ?? [];

      if (nonConflictIds.length > 0) {
        const imported = await executeNonConflictingImport(
          importUri,
          importResult?.conflictingIds ?? [],
        );
        setImportResult({
          totalRows: (importResult?.totalRows ?? 0) + imported,
          conflictingIds: importResult?.conflictingIds ?? [],
          merged,
          duplicated: duplicated + imported,
        });
      } else {
        setImportResult((prev) =>
          prev ? { ...prev, merged, duplicated } : null,
        );
      }

      await refreshSubscriptions();
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
  // Render
  // ---------------------------------------------------------------------------

  const displayName =
    user?.firstName ||
    user?.fullName ||
    user?.emailAddresses[0]?.emailAddress ||
    "User";
  const email = user?.emailAddresses[0]?.emailAddress;

  return (
    <SafeAreaView className="flex-1 bg-background p-5">
      <Text className="text-3xl font-sans-bold text-primary mb-6">
        Settings
      </Text>

      {/* User Profile Section */}
      <View className="auth-card mb-5">
        <View className="flex-row items-center gap-4 mb-4">
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
      </View>

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
              <Text className="auth-button-text text-white">Exporting...</Text>
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
                <Text className="text-sm font-sans-bold text-white">Done</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* Sign Out Button */}
      <Pressable className="auth-button bg-destructive" onPress={handleSignOut}>
        <Text className="auth-button-text text-white">Sign Out</Text>
      </Pressable>

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
