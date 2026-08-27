/**
 * What cloud sync / scoped backup actually carries.
 * Crawl ephemera stays device-local so sync is not a dump of spider junk.
 */

/** Tables included in cloud sync payloads and user-data hashes. */
export const SYNC_USER_TABLES = [
  "subscriptions",
  "preferences",
  "icon_cache",
] as const;

/**
 * Tables wiped from cloud-sync uploads. Still present in full local backup export.
 * icon_reports: user feedback is local unless we add a dedicated export later.
 */
export const SYNC_LOCAL_ONLY_TABLES = [
  "icon_crawl_results",
  "icon_crawl_queue",
  "icon_crawl_sessions",
  "crawled_urls",
  "icon_reports",
  "mail_mailboxes",
  "mail_messages",
] as const;

/** Short copy for Settings / alerts. */
export const SYNC_SCOPE_USER_COPY =
  "Syncs subscriptions, preferences, and chosen icons. Icon search candidates, crawl history, and reports stay on this device.";

export const BACKUP_FULL_USER_COPY =
  "Full encrypted database (includes local crawl cache). Cloud sync uploads only subscriptions, preferences, and chosen icons.";
