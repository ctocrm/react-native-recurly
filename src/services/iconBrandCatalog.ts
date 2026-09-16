/**
 * Curated provider-brand icon seeding (2026-09-15).
 *
 * For supported mailbox providers the brand identity is KNOWN to us — their
 * cards resolve to the curated brand icon by default. Slug crawling can grab
 * wrong-brand marks (Tuta Group is not Tuta the email company), so the
 * curated icon is seeded into the icon cache at app start:
 *
 *  - skips when the cache row is user-chosen (a manual pick is sacred), and
 *  - skips when the curated icon is already seeded (source = brand_catalog).
 *
 * The seeded row carries official-tier provenance (see iconQuality
 * provenanceFor), so the promote scorer keeps it over weak crawled marks but
 * still allows a better-resolution official candidate to win first place.
 */
import {
  PROVIDER_BRAND_ICONS,
  type ProviderBrandIcon,
} from "@/constants/providerBrandIcons";

export const CURATED_SOURCE = "brand_catalog";

/**
 * Seed curated brand icons for every supported provider. Never overwrites a
 * user-chosen cache row; re-running is a no-op for already-seeded keys.
 * Returns the number of keys seeded.
 */
export async function seedProviderBrandIcons(
  getCachedIconRow: (key: string) => Promise<
    | {
        imageData?: string | null;
        source?: string | null;
        chosen?: boolean | null;
      }
    | null
  >,
  setCached: (
    iconKey: string,
    imageData: string,
    source: string,
    format: string,
    originalUrl: string,
    width: number,
    height: number,
  ) => Promise<void>,
): Promise<number> {
  let seeded = 0;
  for (const [key, icon] of Object.entries(
    PROVIDER_BRAND_ICONS as Record<string, ProviderBrandIcon>,
  )) {
    try {
      const current = await getCachedIconRow(key);
      if (current?.chosen) continue; // user pick is sacred
      if (current?.source === CURATED_SOURCE) continue; // already seeded
      await setCached(key, icon.base64, CURATED_SOURCE, icon.format, icon.originalUrl, icon.width, icon.height);
      seeded += 1;
    } catch (error) {
      console.warn(
        `[BRAND_ICONS] seeding failed for ${key}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return seeded;
}
