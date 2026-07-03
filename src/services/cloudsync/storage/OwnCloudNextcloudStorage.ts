import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { CloudStorageProvider } from "../types";

export class OwnCloudNextcloudStorage implements CloudStorageProvider {
  private tokens: any = null;
  private userId: string = "";
  private serverUrl: string = "";
  private provider: "owncloud" | "nextcloud" = "nextcloud";

  constructor(
    userId: string,
    serverUrl: string,
    provider: "owncloud" | "nextcloud" = "nextcloud",
  ) {
    this.userId = userId;
    this.serverUrl = serverUrl.replace(/\/$/, ""); // Remove trailing slash
    this.provider = provider;
  }

  async authenticate(): Promise<void> {
    const key = `${this.provider}_tokens_${this.userId}`;
    const tokensJson = await SecureStore.getItemAsync(key);
    if (tokensJson) {
      this.tokens = JSON.parse(tokensJson);
    }
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.tokens) {
      const key = `${this.provider}_tokens_${this.userId}`;
      const tokensJson = await SecureStore.getItemAsync(key);
      if (tokensJson) {
        this.tokens = JSON.parse(tokensJson);
      }
    }
    return !!this.tokens?.accessToken;
  }

  async disconnect(): Promise<void> {
    const key = `${this.provider}_tokens_${this.userId}`;
    await SecureStore.deleteItemAsync(key);
    this.tokens = null;
  }

  private getRemotePath(fileName: string): string {
    const userId = this.tokens?.user_id;
    if (!userId) {
      throw new Error(
        `${this.provider}: user_id not available. Ensure authentication completed successfully.`,
      );
    }
    return `${this.serverUrl}/remote.php/dav/files/${userId}/SubTracker/${fileName}`;
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
    const remoteUrl = this.getRemotePath(fileName);

    const fileContent = await FileSystem.readAsStringAsync(localPath, {
      encoding: FileSystem.EncodingType.Base64,
    } as any);

    const response = await fetch(remoteUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: fileContent,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.provider} upload failed: ${error}`);
    }

    // Get the file info from response headers
    const modified =
      response.headers.get("Last-Modified") || new Date().toISOString();
    const contentLength = response.headers.get("Content-Length") || "0";

    return {
      fileId: remoteUrl,
      modified: new Date(modified).toISOString(),
      size: parseInt(contentLength),
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

    const response = await fetch(fileId, {
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.provider} download failed: ${error}`);
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

    const response = await fetch(fileId, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      const error = await response.text();
      throw new Error(`${this.provider} delete failed: ${error}`);
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
      const response = await fetch(fileId, {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { modified: "", size: 0, exists: false };
        }
        throw new Error(
          `${this.provider} metadata failed: ${response.statusText}`,
        );
      }

      const modified = response.headers.get("Last-Modified") || "";
      const contentLength = response.headers.get("Content-Length") || "0";

      return {
        modified: new Date(modified).toISOString(),
        size: parseInt(contentLength),
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

    const remoteUrl = this.getRemotePath(fileName);

    try {
      const response = await fetch(remoteUrl, {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
        },
      });

      if (response.ok) {
        const modified = response.headers.get("Last-Modified") || "";
        const contentLength = response.headers.get("Content-Length") || "0";

        return {
          fileId: remoteUrl,
          modified: new Date(modified).toISOString(),
          size: parseInt(contentLength),
        };
      }

      if (response.status === 404) {
        return null;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async listFiles(folderPath: string = ""): Promise<
    {
      fileId: string;
      name: string;
      modified: string;
      size: number;
    }[]
  > {
    if (!this.tokens?.accessToken) {
      throw new Error("Not authenticated");
    }

    const remoteUrl = `${this.serverUrl}/remote.php/dav/files/${this.tokens?.user_id || "user"}/SubTracker${folderPath}`;

    try {
      const response = await fetch(remoteUrl, {
        method: "PROPFIND",
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
          "Content-Type": "application/xml",
        },
        body: `<?xml version="1.0"?>
          <d:propfind xmlns:d="DAV:">
            <d:prop>
              <d:getlastmodified/>
              <d:getcontentlength/>
              <d:resourcetype/>
            </d:prop>
          </d:propfind>`,
      });

      if (!response.ok) {
        return [];
      }

      const text = await response.text();
      // Parse XML response (simplified - in production use a proper XML parser)
      const files: any[] = [];
      const regex = /<d:response>(.*?)<\/d:response>/gs;
      const matches = text.matchAll(regex);

      for (const match of matches) {
        const hrefMatch = match[1].match(/<d:href>(.*?)<\/d:href>/);
        const modifiedMatch = match[1].match(
          /<d:getlastmodified>(.*?)<\/d:getlastmodified>/,
        );
        const sizeMatch = match[1].match(
          /<d:getcontentlength>(.*?)<\/d:getcontentlength>/,
        );

        if (hrefMatch && !hrefMatch[1].endsWith("/")) {
          files.push({
            fileId: `${this.serverUrl}${hrefMatch[1]}`,
            name: hrefMatch[1].split("/").pop() || "",
            modified: modifiedMatch ? modifiedMatch[1] : "",
            size: sizeMatch ? parseInt(sizeMatch[1]) : 0,
          });
        }
      }

      return files;
    } catch (error) {
      return [];
    }
  }
}
