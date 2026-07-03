# Task Progress - Fix Findings - COMPLETE

## settings.tsx

- [x] Fix handleSync to show feedback for success+!synced case
- [x] Replace prompt() with TextInput for server URL editing

## package.json

- [x] expo-auth-session kept since OAuth connect flow is now wired up

## services/database.ts

- [x] Fix updateSyncMetadata to allow clearing fields (using "key in updates" pattern + null/undefined as clear signals)
- [x] Fix computeDatabaseHash to read bytes using base64 encoding (preserves binary data)

## CloudSyncContext.tsx

- [x] Fix serverUrl persistence in sync metadata (stored in remoteFileId for owncloud/nextcloud)
- [x] Replace hardcoded "current_user" with actual Clerk user ID (via useUser())
- [x] Fix connect flow to perform actual OAuth (added handleConnectProvider with expo-auth-session/WebBrowser)
- [x] Memoize loadSyncMetadata with useCallback, add to deps arrays, remove redundant call in initializeProvider

## CloudSyncService.ts

- [x] Fix sync decision logic branching (independent checks for localUnchanged, remoteUnchanged)
- [x] Fix getRemoteHash auth guard to await this.provider.isAuthenticated() (not the function reference)
- [x] Make performMerge atomic with transaction (wrapped in db.withTransactionAsync)

## DropboxStorage.ts

- [x] Fix downloadFile race condition (wrap FileReader in Promise and await it)
- [x] Fix API host to use DROPBOX_CONTENT_BASE for upload/download content endpoints

## GoogleDriveStorage.ts

- [x] Fix downloadFile race condition (wrap FileReader in Promise and await it)
- [x] Fix upload to request fields=id,modifiedTime,size from API

## OneDriveStorage.ts

- [x] Fix downloadFile race condition (wrap FileReader in Promise and await it)

## OwnCloudNextcloudStorage.ts

- [x] Fix downloadFile race condition (wrap FileReader in Promise and await it)
- [x] Fix getRemotePath to fail fast when user_id missing (throws Error instead of defaulting to "user")

## types.ts

- [x] Add findBackupFile to CloudStorageProvider interface
- [x] Add implements CloudStorageProvider to all 4 storage provider classes (compile-time check)
