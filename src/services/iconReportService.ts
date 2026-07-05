/**
 * Icon reporting service.
 * Handles wrong/broken icon reports: stores locally, provides feedback,
 * and can hide rejected icons from appearing again.
 */

import { getDatabase } from "../../services/database";

export type ReportType = "wrong" | "broken";

export interface IconReport {
  id?: number;
  iconKey: string;
  reportType: ReportType;
  source: string;
  imageData: string;
  rejected: boolean;
  reportedAt: string;
}

const REPORTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS icon_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  icon_key      TEXT NOT NULL,
  report_type   TEXT NOT NULL,
  source        TEXT,
  image_data    TEXT,
  rejected      INTEGER DEFAULT 0,
  reported_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_icon_reports_key ON icon_reports(icon_key);
`;

/**
 * Generate a stable hash of a base64 string for comparison/storage.
 * Uses a simple but deterministic hash (Fowler-Noll-Vo-1a) that avoids
 * storing full base64 payloads in the database.
 */
function hashBase64(data: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash.toString(16);
}

let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    const db = getDatabase();
    await db.execAsync(REPORTS_TABLE_SQL);
    tableEnsured = true;
  } catch {
    // Table might already exist
    tableEnsured = true;
  }
}

/**
 * Report an icon as wrong or broken.
 * Returns true if the report was saved successfully.
 */
export async function reportIcon(
  iconKey: string,
  reportType: ReportType,
  source: string,
  imageData: string,
): Promise<boolean> {
  try {
    await ensureTable();
    const db = getDatabase();
    await db.runAsync(
      `INSERT INTO icon_reports (icon_key, report_type, source, image_data, rejected)
       VALUES (?, ?, ?, ?, 0)`,
      iconKey,
      reportType,
      source,
      imageData,
    );
    console.log(`Icon reported: ${iconKey} (${reportType}) from ${source}`);
    return true;
  } catch (error) {
    console.error("Failed to report icon:", error);
    return false;
  }
}

/**
 * Get all reports for a specific icon key.
 */
export async function getReportsForIcon(
  iconKey: string,
): Promise<IconReport[]> {
  try {
    await ensureTable();
    const db = getDatabase();
    const rows = await db.getAllAsync<Record<string, any>>(
      "SELECT * FROM icon_reports WHERE icon_key = ? ORDER BY reported_at DESC",
      iconKey,
    );
    return rows.map((r) => ({
      id: r.id,
      iconKey: r.icon_key,
      reportType: r.report_type,
      source: r.source,
      imageData: r.image_data,
      rejected: r.rejected === 1,
      reportedAt: r.reported_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Check if a specific image data string has been reported for a given icon key.
 * This is used by the icon picker to hide reported icons.
 */
export async function isImageReported(
  iconKey: string,
  imageData: string,
): Promise<boolean> {
  try {
    await ensureTable();
    const db = getDatabase();
    const dataHash = hashBase64(imageData);
    const row = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM icon_reports WHERE icon_key = ? AND image_data = ?",
      iconKey,
      dataHash,
    );
    return (row?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Mark a specific report as rejected (removed by user).
 */
export async function rejectReportedIcon(
  iconKey: string,
  imageData: string,
): Promise<void> {
  try {
    await ensureTable();
    const db = getDatabase();
    const dataHash = hashBase64(imageData);
    await db.runAsync(
      "UPDATE icon_reports SET rejected = 1 WHERE icon_key = ? AND image_data = ?",
      iconKey,
      dataHash,
    );
  } catch (error) {
    console.error("Failed to reject icon:", error);
  }
}
