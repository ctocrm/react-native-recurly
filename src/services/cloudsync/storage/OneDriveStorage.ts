import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { CloudStorageProvider } from "../types";

const ONEDRIVE_API_BASE = "https://graph.microsoft.com/v1.0";

export class OneDriveStorage implements CloudStorageProvider {
  private tokens: any = null;
  private userId: string = "";

  constructor(userId: string) {
    this.userId = userId;
  }

  async authenticate(): Promise<void> {
    const tokensJson = await SecureStore.getItemAsync(
      `onedrive_tokens_${this.userId}`,
    );
    if (tokensJson) {
      this.tokens = JSON.parse(tokensJson);
    }
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.tokens) {
      const tokensJson = await SecureStore.getItemAsync(
        `onedrive_tokens_${this.userId}`,
      );
      if (tokensJson) {
        this.tokens = JSON.parse(tokensJson);
      }
    }
    return !!this.tokens?.accessToken;
  }

  async disconnect(): Promise<void> {
    await SecureStore.deleteItemAsync(`onedrive_tokens_${this.userId}`);
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

    // OneDrive path: /Documents/SubTracker/
    const onedrivePath = `/Documents/SubTracker/${fileName}`;

    const fileContent = await FileSystem.readAsStringAsync(localPath, {
      encoding: FileSystem.EncodingType.Base64,
    } as any);

    const response = await fetch(
      `${ONEDRIVE_API_BASE}/me/drive/root:${onedrivePath}:/content`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: fileContent,
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OneDrive upload failed: ${error}`);
    }

    const result = await response.json();

    return {
      fileId: result.id,
      modified: result.lastModifiedDateTime,
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

    const response = await fetch(
      `${ONEDRIVE_API_BASE}/me/drive/items/${fileId}/content`,
      {
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OneDrive download failed: ${error}`);
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
      throw new Error("Not authenticated");
    }

    const response = await fetch(
      `${ONEDRIVE_API_BASE}/me/drive/items/${fileId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
        },
      },
    );

    if (!response.ok && response.status !== 404) {
      const error = await response.text();
      throw new Error(`OneDrive delete failed: ${error}`);
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
      const response = await fetch(
        `${ONEDRIVE_API_BASE}/me/drive/items/${fileId}?select=id,lastModifiedDateTime,size`,
        {
          headers: {
            Authorization: `Bearer ${this.tokens.accessToken}`,
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          return { modified: "", size: 0, exists: false };
        }
        const error = await response.text();
        throw new Error(`OneDrive metadata failed: ${error}`);
      }

      const data = await response.json();

      return {
        modified: data.lastModifiedDateTime,
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

    const onedrivePath = `/Documents/SubTracker/${fileName}`;

    try {
      const response = await fetch(
        `${ONEDRIVE_API_BASE}/me/drive/root:/Documents/SubTracker:/children?select=id,lastModifiedDateTime,size,name`,
        {
          headers: {
            Authorization: `Bearer ${this.tokens.accessToken}`,
          },
        },
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OneDrive search failed: ${error}`);
      }

      const data = await response.json();

      if (data.value && data.value.length > 0) {
        const file = data.value.find((f: any) => f.name === fileName);
        if (file) {
          return {
            fileId: file.id,
            modified: file.lastModifiedDateTime,
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
