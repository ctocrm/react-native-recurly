export type CloudProvider =
  "google_drive" | "onedrive" | "dropbox" | "owncloud" | "nextcloud";

export interface CloudProviderConfig {
  name: string;
  provider: CloudProvider;
  icon: string;
  authUrl?: string;
  clientId?: string;
  scope?: string;
}

export interface SyncResult {
  success: boolean;
  synced: boolean;
  conflicts?: any[];
  error?: string;
  message?: string;
}

export interface CloudStorageProvider {
  authenticate(): Promise<void>;
  isAuthenticated(): Promise<boolean>;
  disconnect(): Promise<void>;

  uploadFile(
    localPath: string,
    remotePath: string,
  ): Promise<{
    fileId: string;
    modified: string;
    size: number;
  }>;

  downloadFile(
    fileId: string,
    localPath: string,
  ): Promise<{
    size: number;
    modified: string;
  }>;

  deleteFile(fileId: string): Promise<void>;

  getFileMetadata(fileId: string): Promise<{
    modified: string;
    size: number;
    exists: boolean;
  } | null>;

  findBackupFile(fileName: string): Promise<{
    fileId: string;
    modified: string;
    size: number;
  } | null>;
}

export interface ProviderOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface SyncState {
  isSyncing: boolean;
  lastSyncTimestamp: string | null;
  pendingChanges: boolean;
  error: string | null;
}
