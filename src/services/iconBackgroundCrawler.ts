import {
  dequeueIcon,
  enqueueIconScrape,
  getQueuedIcons,
  setCachedIcon,
} from "../../services/database";
import { setIconLoading } from "../hooks/useCachedIcon";
import { downloadFaviconAsBase64, extractFavicon } from "./faviconExtractor";
import { downloadIconAsBase64, findIconFromLibraries } from "./iconScraper";

// Process queued icons in FIFO order
export async function processIconQueue(): Promise<void> {
  const queuedIcons = await getQueuedIcons();
  console.log(`Processing ${queuedIcons.length} queued icons`);

  for (const { icon_key } of queuedIcons) {
    try {
      // Mark as loading
      setIconLoading(icon_key, true);

      // Try icon libraries first
      const libraryResult = await findIconFromLibraries(icon_key);
      let base64Data: string | null = null;
      let source: "local" | "url" | "base64" = "url";

      if (libraryResult) {
        base64Data = await downloadIconAsBase64(
          libraryResult.url,
          libraryResult.format,
        );
        if (base64Data) {
          source = "base64";
        }
      }

      // If no library icon, try favicon extraction
      if (!base64Data) {
        const faviconResult = await extractFavicon(icon_key);
        if (faviconResult) {
          base64Data = await downloadFaviconAsBase64(
            faviconResult.url,
            faviconResult.format,
          );
        }
      }

      // Cache if we got an icon
      if (base64Data) {
        await setCachedIcon(icon_key, base64Data, source);
        await dequeueIcon(icon_key);
        console.log(`Cached icon for ${icon_key}`);
      } else {
        // Failed to find icon, remove from queue
        await dequeueIcon(icon_key);
        console.log(`No icon found for ${icon_key}, removed from queue`);
      }
    } catch (error) {
      console.error(`Error processing icon ${icon_key}:`, error);
    } finally {
      // Mark as no longer loading
      setIconLoading(icon_key, false);
    }
  }
}

// Queue icon for background processing
export async function queueIconForScraping(
  iconKey: string,
  subscriptionId: string,
): Promise<void> {
  await enqueueIconScrape(iconKey, subscriptionId);
}
