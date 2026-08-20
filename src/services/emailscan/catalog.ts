/**
 * Native Connect catalog. Branded OAuth only if a documented mail API exists.
 * Yahoo/AOL are public IMAP (not branded OAuth). Proton/Tuta are not IMAP
 * (client REST in H4/H5). IMAP fetch uses the Android SSL socket.
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
    liveScanInPhase4: true,
    note: "Same Graph API as Outlook; own branded row.",
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    branded: true,
    auth: "oauth",
    liveScanInPhase4: true,
    note: "OAuth + Mail API HTTP search.",
  },
  {
    id: "fastmail",
    label: "Fastmail",
    branded: true,
    auth: "oauth",
    liveScanInPhase4: true,
    note: "Fastmail OAuth + JMAP subject-union query.",
  },
  {
    id: "imap",
    label: "IMAP / IMAPS",
    branded: false,
    auth: "imap",
    liveScanInPhase4: true,
    note: "Last row. Public IMAP only: iCloud, Yahoo, AOL, custom hosts. Native SSL socket. Not Proton or Tuta.",
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
