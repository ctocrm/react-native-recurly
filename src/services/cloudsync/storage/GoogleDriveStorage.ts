import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { CloudStorageProvider } from "../types";

const GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

export class GoogleDriveStorage implements CloudStorageProvider {
  private tokens: any = null;
  private userId: string = "";

  constructor(userId: string) {
    this.userId = userId;
  }

  async authenticate(): Promise<void> {
    // OAuth flow will be handled by the UI layer
    // This method is called after successful OAuth
    const tokensJson = await SecureStore.getItemAsync(
      `gdrive_tokens_${this.userId}`,
    );
    if (tokensJson) {
      this.tokens = JSON.parse(tokensJson);
    }
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.tokens) {
      const tokensJson = await SecureStore.getItemAsync(
        `gdrive_tokens_${this.userId}`,
      );
      if (tokensJson) {
        this.tokens = JSON.parse(tokensJson);
      }
    }
    return !!this.tokens?.accessToken;
  }

  async disconnect(): Promise<void> {
    await SecureStore.deleteItemAsync(`gdrive_tokens_${this.userId}`);
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

    // Read file content
    const fileContent = await FileSystem.readAsStringAsync(localPath, {
      encoding: FileSystem.EncodingType.Base64,
    } as any);

    // Upload to Google Drive
    const fileName = remotePath.split("/").pop() || "backup.db";

    const metadata = {
      name: fileName,
      parents: ["appDataFolder"], // Hidden folder, not visible to user
    };

    const response = await fetch(
      `${GOOGLE_DRIVE_API_BASE}/files?uploadType=multipart&fields=id,modifiedTime,size`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
          "Content-Type": "multipart/related; boundary=foo_boundary",
        },
        body: [
          "--foo_boundary",
          "Content-Type: application/json; charset=UTF-8",
          "",
          JSON.stringify(metadata),
          "--foo_boundary",
          `Content-Type: application/octet-stream`,
          `Content-Transfer-Encoding: base64`,
          "",
          fileContent,
          "--foo_boundary--",
        ].join("\r\n"),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google Drive upload failed: ${error}`);
    }

    const result = await response.json();

    return {
      fileId: result.id,
      modified: result.modifiedTime,
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
      `${GOOGLE_DRIVE_API_BASE}/files/${fileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google Drive download failed: ${error}`);
    }

    const blob = await response.blob();

    // Convert blob to base64 and write to file
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

    const response = await fetch(`${GOOGLE_DRIVE_API_BASE}/files/${fileId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      const error = await response.text();
      throw new Error(`Google Drive delete failed: ${error}`);
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

    const response = await fetch(
      `${GOOGLE_DRIVE_API_BASE}/files/${fileId}?fields=id,modifiedTime,size`,
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
      throw new Error(`Google Drive metadata failed: ${error}`);
    }

    const data = await response.json();

    return {
      modified: data.modifiedTime,
      size: parseInt(data.size || "0"),
      exists: true,
    };
  }

  async findBackupFile(fileName: string): Promise<{
    fileId: string;
    modified: string;
    size: number;
  } | null> {
    if (!this.tokens?.accessToken) {
      throw new Error("Not authenticated");
    }

    // Search for file in appDataFolder
    const query = encodeURIComponent(
      `name='${fileName}' and 'appDataFolder' in parents`,
    );

    const response = await fetch(
      `${GOOGLE_DRIVE_API_BASE}/files?q=${query}&fields=files(id,modifiedTime,size)`,
      {
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google Drive search failed: ${error}`);
    }

    const data = await response.json();

    if (data.files && data.files.length > 0) {
      return {
        fileId: data.files[0].id,
        modified: data.files[0].modifiedTime,
        size: parseInt(data.files[0].size || "0"),
      };
    }

    return null;
  }
}
