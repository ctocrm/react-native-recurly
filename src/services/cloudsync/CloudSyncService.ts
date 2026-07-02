import * as Crypto from "expo-crypto";
import { CryptoDigestAlgorithm } from "expo-crypto";
import * as FileSystem from "expo-file-system";
import {
  computeDatabaseHash,
  executeNonConflictingImport,
  exportBackup,
  getDatabase,
  getSyncMetadata,
  importBackup,
  updateSyncMetadata,
} from "../../../services/database";
import { DropboxStorage } from "./storage/DropboxStorage";
import { GoogleDriveStorage } from "./storage/GoogleDriveStorage";
import { OneDriveStorage } from "./storage/OneDriveStorage";
import { OwnCloudNextcloudStorage } from "./storage/OwnCloudNextcloudStorage";
import { CloudProvider, CloudStorageProvider, SyncResult } from "./types";

export class CloudSyncService {
  private provider: CloudStorageProvider | null = null;
  private userId: string;
  private isSyncing: boolean = false;

  constructor(userId: string) {
    this.userId = userId;
  }

  async initializeProvider(
    providerType: CloudProvider,
    config?: {
      serverUrl?: string;
    },
  ): Promise<void> {
    switch (providerType) {
      case "google_drive":
        this.provider = new GoogleDriveStorage(this.userId);
        break;
      case "onedrive":
        this.provider = new OneDriveStorage(this.userId);
        break;
      case "dropbox":
        this.provider = new DropboxStorage(this.userId);
        break;
      case "owncloud":
      case "nextcloud":
        if (!config?.serverUrl) {
          throw new Error("Server URL required for ownCloud/Nextcloud");
        }
        this.provider = new OwnCloudNextcloudStorage(
          this.userId,
          config.serverUrl,
          providerType,
        );
        break;
      default:
        throw new Error(`Unsupported provider: ${providerType}`);
    }

    // Load existing tokens if available
    await this.provider.authenticate();
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.provider) return false;
    return await this.provider.isAuthenticated();
  }

  async disconnect(): Promise<void> {
    if (this.provider) {
      await this.provider.disconnect();
      this.provider = null;
    }
  }

  async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      return {
        success: false,
        synced: false,
        error: "Sync already in progress",
      };
    }

    if (!this.provider) {
      return { success: false, synced: false, error: "No provider configured" };
    }

    this.isSyncing = true;

    try {
      const metadata = await getSyncMetadata();

      // If sync is not enabled, skip
      if (!metadata.syncEnabled || !metadata.provider) {
        return { success: true, synced: false, message: "Sync not enabled" };
      }

      // Compute local database hash
      const localHash = await computeDatabaseHash();

      // If hashes match, no sync needed
      if (localHash === metadata.remoteFileHash) {
        return { success: true, synced: false, message: "Already in sync" };
      }

      // Determine sync direction
      const hasRemoteFile = metadata.remoteFileHash !== null;

      if (!hasRemoteFile) {
        // First sync - upload local database
        return await this.uploadToCloud();
      } else {
        // Check if remote has changes
        const remoteHash = await this.getRemoteHash();

        if (remoteHash === metadata.remoteFileHash) {
          // Remote unchanged, upload local changes
          return await this.uploadToCloud();
        } else if (
          localHash !== metadata.remoteFileHash &&
          remoteHash !== metadata.remoteFileHash
        ) {
          // Both changed - need merge
          return await this.mergeWithCloud();
        } else if (remoteHash !== metadata.remoteFileHash) {
          // Remote changed, download it
          return await this.downloadFromCloud();
        } else {
          // Local changed, upload it
          return await this.uploadToCloud();
        }
      }
    } catch (error) {
      return {
        success: false,
        synced: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      this.isSyncing = false;
    }
  }

  private async getRemoteHash(): Promise<string | null> {
    if (!this.provider || !this.provider.isAuthenticated) return null;

    const metadata = await getSyncMetadata();
    if (!metadata.remoteFileId) return null;

    const fileMeta = await this.provider.getFileMetadata(metadata.remoteFileId);
    if (!fileMeta || !fileMeta.exists) {
      // File was deleted remotely, clear metadata
      await updateSyncMetadata({
        remoteFileId: undefined,
        remoteFileHash: undefined,
        remoteFileModified: undefined,
      });
      return null;
    }

    // Download and compute hash
    const tempPath = `${FileSystem.Paths.cache}/sync_check_${Date.now()}.db`;
    await this.provider.downloadFile(metadata.remoteFileId, tempPath);

    // Compute hash from file content
    const content = await FileSystem.readAsStringAsync(tempPath);
    const hash = await Crypto.digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      content,
    );

    // Clean up temp file
    try {
      await FileSystem.deleteAsync(tempPath, { idempotent: true });
    } catch {
      // Ignore cleanup errors
    }

    return hash;
  }

  private async uploadToCloud(): Promise<SyncResult> {
    if (!this.provider) {
      return { success: false, synced: false, error: "No provider configured" };
    }

    try {
      // Export backup
      const backupPath = await this.exportBackup();

      // Upload to cloud
      const fileName = `backup_${this.userId}.db`;
      const uploadResult = await this.provider.uploadFile(backupPath, fileName);

      // Update metadata
      const newHash = await computeDatabaseHash();
      await updateSyncMetadata({
        remoteFileId: uploadResult.fileId,
        remoteFileHash: newHash,
        remoteFileModified: uploadResult.modified,
        lastSyncTimestamp: new Date().toISOString(),
      });

      // Clean up temp file
      try {
        await FileSystem.deleteAsync(backupPath, { idempotent: true });
      } catch {
        // Ignore
      }

      return {
        success: true,
        synced: true,
        message: "Uploaded to cloud successfully",
      };
    } catch (error) {
      return {
        success: false,
        synced: false,
        error: error instanceof Error ? error.message : "Upload failed",
      };
    }
  }

  private async downloadFromCloud(): Promise<SyncResult> {
    if (!this.provider) {
      return { success: false, synced: false, error: "No provider configured" };
    }

    try {
      const metadata = await getSyncMetadata();
      if (!metadata.remoteFileId) {
        return { success: false, synced: false, error: "No remote file" };
      }

      // Download remote backup
      const importsDir = new FileSystem.Directory(
        FileSystem.Paths.cache,
        "cloud_sync_imports",
      );
      await importsDir.create({ intermediates: true });

      const importPath = `${importsDir.uri}import_${Date.now()}.db`;
      await this.provider.downloadFile(metadata.remoteFileId, importPath);

      // Import the backup (this will use the existing conflict resolution logic)
      const scanResult = await this.importBackup(importPath);

      // Update metadata
      const newHash = await computeDatabaseHash();
      await updateSyncMetadata({
        remoteFileHash: newHash,
        lastSyncTimestamp: new Date().toISOString(),
      });

      // Clean up temp file
      try {
        await FileSystem.deleteAsync(importPath, { idempotent: true });
      } catch {
        // Ignore
      }

      if (scanResult.conflictingIds.length > 0) {
        return {
          success: true,
          synced: false,
          conflicts: scanResult.conflictingRows,
          message: `Downloaded with ${scanResult.conflictingIds.length} conflicts`,
        };
      }

      return {
        success: true,
        synced: true,
        message: `Downloaded and merged ${scanResult.totalRows} subscriptions`,
      };
    } catch (error) {
      return {
        success: false,
        synced: false,
        error: error instanceof Error ? error.message : "Download failed",
      };
    }
  }

  private async mergeWithCloud(): Promise<SyncResult> {
    // Use timestamp-based merge: newer version wins
    // Both databases have the same schema, so we can use SQL UPSERT

    if (!this.provider) {
      return { success: false, synced: false, error: "No provider configured" };
    }

    try {
      const metadata = await getSyncMetadata();
      if (!metadata.remoteFileId) {
        return { success: false, synced: false, error: "No remote file" };
      }

      // Download remote backup
      const importsDir = new FileSystem.Directory(
        FileSystem.Paths.cache,
        "cloud_sync_merge",
      );
      await importsDir.create({ intermediates: true });

      const remotePath = `${importsDir.uri}remote_${Date.now()}.db`;
      await this.provider.downloadFile(metadata.remoteFileId, remotePath);

      // Perform SQL merge
      const mergeResult = await this.performMerge(remotePath);

      // Upload merged result
      const backupPath = await this.exportBackup();
      const fileName = `backup_${this.userId}.db`;
      const uploadResult = await this.provider.uploadFile(backupPath, fileName);

      // Update metadata
      const newHash = await computeDatabaseHash();
      await updateSyncMetadata({
        remoteFileId: uploadResult.fileId,
        remoteFileHash: newHash,
        remoteFileModified: uploadResult.modified,
        lastSyncTimestamp: new Date().toISOString(),
      });

      // Clean up temp files
      try {
        await FileSystem.deleteAsync(remotePath, { idempotent: true });
        await FileSystem.deleteAsync(backupPath, { idempotent: true });
      } catch {
        // Ignore
      }

      return {
        success: true,
        synced: true,
        conflicts: mergeResult.conflicts,
        message: mergeResult.message,
      };
    } catch (error) {
      return {
        success: false,
        synced: false,
        error: error instanceof Error ? error.message : "Merge failed",
      };
    }
  }

  private async performMerge(remoteDbPath: string): Promise<{
    conflicts: any[];
    message: string;
  }> {
    const db = getDatabase();

    // Import the remote database
    const scanResult = await this.importBackup(remoteDbPath);

    if (scanResult.conflictingIds.length === 0) {
      // No conflicts, just import non-conflicting
      await this.importNonConflicting(remoteDbPath, scanResult.conflictingIds);
      return {
        conflicts: [],
        message: "Merge completed successfully",
      };
    }

    // For conflicts, use timestamp-based resolution (newer wins)
    const conflicts: any[] = [];

    for (const conflictId of scanResult.conflictingIds) {
      const localRow = await db.getFirstAsync(
        "SELECT * FROM subscriptions WHERE id = ?",
        conflictId,
      );

      const remoteRows = scanResult.conflictingRows.filter(
        (r: any) => r.id === conflictId,
      );
      const remoteRow = remoteRows[0];

      if (localRow && remoteRow) {
        // Compare timestamps, newer wins
        const localUpdated =
          (localRow as any).updated_at || (localRow as any).created_at;
        const remoteUpdated =
          (remoteRow as any).updated_at || (remoteRow as any).created_at;

        if (remoteUpdated > localUpdated) {
          // Remote is newer, overwrite local
          await this.overwriteSubscription(remoteRow);
          conflicts.push({
            id: conflictId,
            resolution: "remote_wins",
            reason: "Remote version was newer",
          });
        } else if (localUpdated > remoteUpdated) {
          // Local is newer, keep it
          conflicts.push({
            id: conflictId,
            resolution: "local_wins",
            reason: "Local version was newer",
          });
        } else {
          // Same timestamp, keep local
          conflicts.push({
            id: conflictId,
            resolution: "local_wins",
            reason: "Same timestamp, kept local",
          });
        }
      }
    }

    // Import non-conflicting
    await this.importNonConflicting(remoteDbPath, scanResult.conflictingIds);

    return {
      conflicts,
      message: `Merged with ${conflicts.length} conflict(s) resolved`,
    };
  }

  private async overwriteSubscription(row: Record<string, any>): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE subscriptions SET
        name = ?, plan = ?, category = ?, payment_method = ?,
        status = ?, start_date = ?, price = ?, currency = ?,
        billing = ?, frequency = ?, renewal_date = ?, color = ?,
        icon_key = ?, updated_at = datetime('now')
      WHERE id = ?`,
      row.name,
      row.plan,
      row.category,
      row.payment_method,
      row.status,
      row.start_date,
      row.price,
      row.currency,
      row.billing,
      row.frequency,
      row.renewal_date,
      row.color,
      row.icon_key,
      row.id,
    );
  }

  private async importBackup(sourceUri: string): Promise<any> {
    // Import from the path (similar to existing import logic)
    return await importBackup(sourceUri);
  }

  private async importNonConflicting(
    remoteDbPath: string,
    conflictingIds: string[],
  ): Promise<number> {
    return await executeNonConflictingImport(remoteDbPath, conflictingIds);
  }

  private async exportBackup(): Promise<string> {
    return await exportBackup();
  }
}
