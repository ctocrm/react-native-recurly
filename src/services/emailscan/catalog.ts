/**
 * Native Connect catalog. Branded OAuth only if a documented mail API exists.
 * Yahoo/AOL are public IMAP (not branded OAuth). Proton/Tuta are not IMAP
 * (client REST in H4/H5). IMAP fetch is unverified on this Expo client.
 */
import type { MailProviderCatalogEntry } from "./types";

export const MAIL_PROVIDER_CATALOG: MailProviderCatalogEntry[] = [
  {
    id: "gmail",
    label: "Gmail",
    branded: true,
    auth: "oauth",
    liveScanInPhase4: true,
    note: "Consumer Google. Not Workspace.",
  },
  {
    id: "workspace",
    label: "Google Workspace",
    branded: true,
    auth: "oauth",
    liveScanInPhase4: true,
    note: "Same Gmail API parser, different login / admin consent.",
  },
  {
    id: "outlook",
    label: "Outlook",
    branded: true,
    auth: "oauth",
    liveScanInPhase4: true,
  },
  {
    id: "office365",
    label: "Office 365 / Microsoft 365",
    branded: true,
    auth: "oauth",
    liveScanInPhase4: false,
    note: "Own branded row; live Graph path is Outlook in Phase 4.",
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    branded: true,
    auth: "oauth",
    liveScanInPhase4: false,
    note: "OAuth + Mail API. HTTP fetcher in H3.",
  },
  {
    id: "fastmail",
    label: "Fastmail",
    branded: true,
    auth: "oauth",
    liveScanInPhase4: false,
    note: "Fastmail OAuth + JMAP. Live-scan when client id exists.",
  },
  {
    id: "imap",
    label: "IMAP / IMAPS",
    branded: false,
    auth: "imap",
    liveScanInPhase4: false,
    note: "Last row. Public IMAP only: iCloud, Yahoo, AOL, custom hosts. Not Proton or Tuta.",
  },
];

export function brandedConnectRows(): MailProviderCatalogEntry[] {
  return MAIL_PROVIDER_CATALOG.filter((row) => row.branded);
}

export function imapConnectRow(): MailProviderCatalogEntry {
  const row = MAIL_PROVIDER_CATALOG.find((r) => r.id === "imap");
  if (!row) throw new Error("IMAP catalog row missing");
  return row;
}
