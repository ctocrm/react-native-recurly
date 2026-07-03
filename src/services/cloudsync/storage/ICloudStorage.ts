import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { CloudStorageProvider } from "../types";

// iCloud WebDAV endpoint (note: Apple restricts access to iCloud - this works through iCloud Drive)
// Users must enable iCloud Drive and the app must be configured for iCloud entitlements
const ICLOUD_WEBDAV_BASE = "https://www.icloud.com/iclouddav.com";

export class ICloudStorage implements CloudStorageProvider {
  private tokens: any = null;
  private userId: string = "";

  constructor(userId: string) {
    this.userId = userId;
  }

  async authenticate(): Promise<void> {
    // iCloud authentication is handled through Apple ID sign-in on iOS
    // For now, we use stored session tokens
    const tokensJson = await SecureStore.getItemAsync(
      `icloud_tokens_${this.userId}`,
    );
    if (tokensJson) {
      this.tokens = JSON.parse(tokensJson);
    }
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.tokens) {
      const tokensJson = await SecureStore.getItemAsync(
        `icloud_tokens_${this.userId}`,
      );
      if (tokensJson) {
        this.tokens = JSON.parse(tokensJson);
      }
    }
    return !!this.tokens?.accessToken;
  }

  async disconnect(): Promise<void> {
    await SecureStore.deleteItemAsync(`icloud_tokens_${this.userId}`);
    this.tokens = null;
  }

  async uploadFile(
    localPath: string,
    remotePath: string,
  ): Promise<{
    fileId: string;
    modified: string;
    size: number;
  }> {
    if (!this.tokens?.accessToken) {
      throw new Error(
        "Not authenticated with iCloud. Please sign in with Apple ID on iOS.",
      );
    }

    // Read the local file
    const fileContent = await FileSystem.readAsStringAsync(localPath, {
      encoding: FileSystem.EncodingType.Base64,
    } as any);

    // iCloud WebDAV upload
    const response = await fetch(`${ICLOUD_WEBDAV_BASE}/upload${remotePath}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: fileContent,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`iCloud upload failed: ${error}`);
    }

    const result = await response.json();

    return {
      fileId: result.id || remotePath,
      modified: result.modified || new Date().toISOString(),
      size: result.size || 0,
    };
  }

  async downloadFile(
    fileId: string,
    localPath: string,
  ): Promise<{
    size: number;
    modified: string;
  }> {
    if (!this.tokens?.accessToken) {
      throw new Error(
        "Not authenticated with iCloud. Please sign in with Apple ID on iOS.",
      );
    }

    const response = await fetch(`${ICLOUD_WEBDAV_BASE}/download${fileId}`, {
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`iCloud download failed: ${error}`);
    }

    const blob = await response.blob();

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve((reader.result as string).split(",")[1]);
      };
      reader.onerror = () => reject(new Error("Failed to read blob"));
      reader.readAsDataURL(blob);
    });

    await FileSystem.writeAsStringAsync(localPath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    } as any);

    return {
      size: blob.size,
      modified: new Date().toISOString(),
    };
  }

  async deleteFile(fileId: string): Promise<void> {
    if (!this.tokens?.accessToken) {
      throw new Error(
        "Not authenticated with iCloud. Please sign in with Apple ID on iOS.",
      );
    }

    const response = await fetch(`${ICLOUD_WEBDAV_BASE}/delete${fileId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      const error = await response.text();
      throw new Error(`iCloud delete failed: ${error}`);
    }
  }

  async getFileMetadata(fileId: string): Promise<{
    modified: string;
    size: number;
    exists: boolean;
  } | null> {
    if (!this.tokens?.accessToken) {
      throw new Error(
        "Not authenticated with iCloud. Please sign in with Apple ID on iOS.",
      );
    }

    try {
      const response = await fetch(`${ICLOUD_WEBDAV_BASE}/metadata${fileId}`, {
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { modified: "", size: 0, exists: false };
        }
        const error = await response.text();
        throw new Error(`iCloud metadata failed: ${error}`);
      }

      const data = await response.json();

      return {
        modified: data.modified || new Date().toISOString(),
        size: data.size || 0,
        exists: true,
      };
    } catch (error) {
      return { modified: "", size: 0, exists: false };
    }
  }

  async findBackupFile(fileName: string): Promise<{
    fileId: string;
    modified: string;
    size: number;
  } | null> {
    if (!this.tokens?.accessToken) {
      throw new Error(
        "Not authenticated with iCloud. Please sign in with Apple ID on iOS.",
      );
    }

    try {
      // Look for backup file in the SubTracker folder in iCloud Drive
      const response = await fetch(`${ICLOUD_WEBDAV_BASE}/list/SubTracker`, {
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      if (data.items) {
        const file = data.items.find((f: any) => f.name === fileName);
        if (file) {
          return {
            fileId: file.id,
            modified: file.modified,
            size: file.size || 0,
          };
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }
}
