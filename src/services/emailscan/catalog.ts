/**
 * Native Connect catalog. Branded row only if a documented mail API exists.
 * Yahoo/AOL/Zoho/Fastmail are fully wired later; live-scan unverified.
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
    id: "yahoo",
    label: "Yahoo Mail",
    branded: true,
    auth: "oauth",
    liveScanInPhase4: false,
    note: "If new-app OAuth is closed, drop this row to IMAP. No dead button.",
  },
  {
    id: "aol",
    label: "AOL",
    branded: true,
    auth: "oauth",
    liveScanInPhase4: false,
    note: "Same Yahoo/AOL identity stack. Implement fully; live-scan unverified.",
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    branded: true,
    auth: "oauth",
    liveScanInPhase4: false,
    note: "Implement fully; live-scan unverified.",
  },
  {
    id: "fastmail",
    label: "Fastmail",
    branded: true,
    auth: "oauth",
    liveScanInPhase4: false,
    note: "Fastmail OAuth + JMAP. Implement fully; live-scan unverified.",
  },
  {
    id: "imap",
    label: "IMAP / IMAPS",
    branded: false,
    auth: "imap",
    liveScanInPhase4: true,
    note: "Last row. iCloud, Proton, Tuta, everyone else. No fake logos.",
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
