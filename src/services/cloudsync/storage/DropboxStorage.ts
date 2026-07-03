import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { CloudStorageProvider } from "../types";

const DROPBOX_API_BASE = "https://api.dropboxapi.com/2";
const DROPBOX_CONTENT_BASE = "https://content.dropboxapi.com/2";

export class DropboxStorage implements CloudStorageProvider {
  private tokens: any = null;
  private userId: string = "";

  constructor(userId: string) {
    this.userId = userId;
  }

  async authenticate(): Promise<void> {
    const tokensJson = await SecureStore.getItemAsync(
      `dropbox_tokens_${this.userId}`,
    );
    if (tokensJson) {
      this.tokens = JSON.parse(tokensJson);
    }
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.tokens) {
      const tokensJson = await SecureStore.getItemAsync(
        `dropbox_tokens_${this.userId}`,
      );
      if (tokensJson) {
        this.tokens = JSON.parse(tokensJson);
      }
    }
    return !!this.tokens?.accessToken;
  }

  async disconnect(): Promise<void> {
    await SecureStore.deleteItemAsync(`dropbox_tokens_${this.userId}`);
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
      throw new Error("Not authenticated");
    }

    const fileName = remotePath.split("/").pop() || "backup.db";
    const dropboxPath = `/SubTracker/${fileName}`;

    const fileContent = await FileSystem.readAsStringAsync(localPath, {
      encoding: FileSystem.EncodingType.Base64,
    } as any);

    const response = await fetch(`${DROPBOX_CONTENT_BASE}/files/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path: dropboxPath,
          mode: "overwrite",
          autorename: false,
        }),
      },
      body: fileContent,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Dropbox upload failed: ${error}`);
    }

    const result = await response.json();

    return {
      fileId: result.path_lower || result.id,
      modified: result.server_modified,
      size: result.size,
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
      throw new Error("Not authenticated");
    }

    const response = await fetch(`${DROPBOX_CONTENT_BASE}/files/download`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        "Dropbox-API-Arg": JSON.stringify({ path: fileId }),
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Dropbox download failed: ${error}`);
    }

    // Dropbox returns metadata in header and file in body
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
      throw new Error("Not authenticated");
    }

    const response = await fetch(`${DROPBOX_API_BASE}/files/delete_v2`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: fileId }),
    });

    if (!response.ok && response.status !== 409) {
      // 409 = file not found, which is okay
      const error = await response.text();
      throw new Error(`Dropbox delete failed: ${error}`);
    }
  }

  async getFileMetadata(fileId: string): Promise<{
    modified: string;
    size: number;
    exists: boolean;
  } | null> {
    if (!this.tokens?.accessToken) {
      throw new Error("Not authenticated");
    }

    try {
      const response = await fetch(`${DROPBOX_API_BASE}/files/get_metadata`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: fileId }),
      });

      if (!response.ok) {
        if (response.status === 409) {
          return { modified: "", size: 0, exists: false };
        }
        const error = await response.text();
        throw new Error(`Dropbox metadata failed: ${error}`);
      }

      const data = await response.json();

      return {
        modified: data.server_modified,
        size: data.size || 0,
        exists: true,
      };
    } catch (error) {
      return null;
    }
  }

  async findBackupFile(fileName: string): Promise<{
    fileId: string;
    modified: string;
    size: number;
  } | null> {
    if (!this.tokens?.accessToken) {
      throw new Error("Not authenticated");
    }

    const dropboxPath = `/SubTracker/${fileName}`;

    try {
      const response = await fetch(`${DROPBOX_API_BASE}/files/search_v2`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: fileName,
          path: "/SubTracker",
          max_results: 1,
          filename_only: true,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Dropbox search failed: ${error}`);
      }

      const data = await response.json();

      if (data.matches && data.matches.length > 0) {
        const file = data.matches[0].metadata;
        if (file && file.path_lower) {
          return {
            fileId: file.path_lower,
            modified: file.server_modified,
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
