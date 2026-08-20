/**
 * JS bridge to the Android MailImap native module (SSL IMAPS).
 * Public hosts only. Not Proton. Not Tuta.
 */
import { NativeModules, Platform } from "react-native";
import type { MessageFetcher, NormalizedMessage } from "./types";

export interface ImapSocketCreds {
  host: string;
  port: number;
  username: string;
  password: string;
}

interface NativeImap {
  fetchMessages(
    host: string,
    port: number,
    username: string,
    password: string,
    sinceIso: string | null,
    limit: number,
  ): Promise<{
    messages: {
      messageId: string;
      from: string;
      subject: string;
      date: string;
      text?: string;
    }[];
  }>;
}

function nativeImap(): NativeImap | null {
  const mod = NativeModules.MailImap as NativeImap | undefined;
  return mod ?? null;
}

export function createImapFetcher(
  creds: ImapSocketCreds,
  mailboxId: string,
): MessageFetcher {
  return {
    async fetchMessages({ since, limit }) {
      const native = nativeImap();
      if (!native || Platform.OS !== "android") {
        throw new Error(
          "IMAP fetch needs the native MailImap module (Android SSL socket).",
        );
      }
      const result = await native.fetchMessages(
        creds.host,
        creds.port || 993,
        creds.username,
        creds.password,
        since?.date ?? null,
        limit,
      );
      return (result.messages || []).map((m): NormalizedMessage => ({
        mailboxId,
        messageId: m.messageId,
        from: m.from,
        subject: m.subject,
        date: m.date,
        text: m.text,
      }));
    },
  };
}
