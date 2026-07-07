/**
 * WebView-based search engine for mobile scraping.
 * Uses react-native-webview to load search pages and extract links
 * after JavaScript has executed (bypasses anti-bot measures).
 *
 * This service provides a reliable alternative to fetch() when
 * search engines block simple HTTP requests.
 */

import { isDomainRateLimited } from "./rateLimitTracker";

// Types for search results
interface WebSearchResult {
  url: string;
  title?: string;
  snippet?: string;
}

// Store pending WebView requests - keyed by requestId
const pendingRequests = new Map<
  string,
  {
    resolve: (results: string[]) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

// Callback for triggering WebView search from React context
let triggerSearchCallback: ((brand: string, requestId: string) => void) | null =
  null;

// Search configuration
const SEARCH_TIMEOUT_MS = 15000;
const WEBVIEW_LOAD_DELAY_MS = 3000; // Additional time for JS to execute

let requestCounter = 0;

/**
 * Generate a unique request ID for tracking WebView searches
 */
function generateRequestId(): string {
  requestCounter++;
  return `search_${Date.now()}_${requestCounter}`;
}

/**
 * Set the callback that triggers WebView searches
 * This is called by the HiddenSearchWebView component
 */
export function setSearchTriggerCallback(
  callback: ((brand: string, requestId: string) => void) | null,
) {
  triggerSearchCallback = callback;
}

/**
 * Search for links to spider using WebView-based scraping.
 * This is the mobile-friendly alternative to fetch-based search.
 */
export async function searchForLinksWithWebView(
  brand: string,
): Promise<string[]> {
  // Check if DuckDuckGo is already rate-limited before attempting
  const rateLimited = await isDomainRateLimited("https://duckduckgo.com");
  if (rateLimited) {
    console.log(
      `[WEBVIEW_SEARCH] DuckDuckGo is rate-limited, skipping search for "${brand}"`,
    );
    return [];
  }

  const id = generateRequestId();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      console.log(
        `[WEBVIEW_SEARCH] Timeout after ${SEARCH_TIMEOUT_MS}ms for "${brand}"`,
      );
      resolve([]); // Return empty instead of rejecting - graceful degradation
    }, SEARCH_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timeout });

    console.log(
      `[WEBVIEW_SEARCH] Ready for WebView search: "${brand}" (requestId: ${id})`,
    );

    // Trigger the search via the callback
    if (triggerSearchCallback) {
      triggerSearchCallback(brand, id);
    } else {
      console.log(
        `[WEBVIEW_SEARCH] No search trigger configured, resolving empty`,
      );
      resolve([]);
    }
  });
}

/**
 * Handle messages from WebView - called by the WebView component
 */
export function handleWebViewMessage(event: {
  nativeEvent: { data: string };
}): void {
  try {
    const data = JSON.parse(event.nativeEvent.data);

    if (data.type === "searchResults") {
      const pending = pendingRequests.get(data.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        const urls = data.results
          .map((r: WebSearchResult) => r.url)
          .filter(Boolean);
        console.log(
          `[WEBVIEW_SEARCH] Received ${urls.length} links from WebView`,
        );
        pending.resolve(urls);
        pendingRequests.delete(data.requestId);
      }
    }
  } catch (e) {
    console.log("[WEBVIEW_SEARCH] Failed to parse WebView message:", e);
  }
}

/**
 * Generate the search URL for a brand
 */
export function getSearchUrl(brand: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(brand)}&ia=web`;
}

/**
 * Get the JavaScript to inject into the WebView
 */
export function getInjectionScript(requestId: string): string {
  return `
    (function() {
      // Wait for page load and JS execution
      setTimeout(function() {
        const results = [];
        const seen = new Set();
        
        // DuckDuckGo web results - multiple selectors for different page versions
        const selectors = [
          'a.result__a',
          'a[data-testid="result-title-a"]',
          'div[data-testid="result"] a',
          'a[class*="result"][href*="http"]',
          'a[href]:not([href*="duckduckgo"]):not([href*="javascript"]):not([href^="#"])'
        ];
        
        for (const selector of selectors) {
          const links = document.querySelectorAll(selector);
          links.forEach(link => {
            const href = link.href || link.getAttribute('href');
            if (href && href.startsWith('http') && !href.includes('duckduckgo.com') && !href.includes('google.com') && !href.includes('bing.com')) {
              let normalizedUrl = href;
              if (href.includes('uddg=') || href.includes('&uddg=')) {
                try {
                  const urlObj = new URL(href);
                  const uddgParam = urlObj.searchParams.get('uddg');
                  if (uddgParam) {
                    normalizedUrl = decodeURIComponent(uddgParam);
                  }
                } catch (e) {}
              }
              
              if (!seen.has(normalizedUrl)) {
                seen.add(normalizedUrl);
                results.push({
                  url: normalizedUrl,
                  title: link.textContent || link.title || '',
                  snippet: ''
                });
              }
            }
          });
        }
        
        // Extract from JSON data in page
        const scripts = document.querySelectorAll('script');
        scripts.forEach(script => {
          const content = script.textContent || script.innerHTML;
          if (content) {
            try {
              const jsonMatches = content.match(/"FirstUrl":\\s*"([^"]+)"/g);
              if (jsonMatches) {
                jsonMatches.forEach(match => {
                  const urlMatch = match.match(/"FirstUrl":\\s*"([^"]+)"/);
                  if (urlMatch) {
                    const url = decodeURIComponent(urlMatch[1].replace(/\\\\u0026/g, '&').replace(/\\\\\\//g, ''));
                    if (!seen.has(url) && url.startsWith('http') && !url.includes('duckduckgo')) {
                      seen.add(url);
                      results.push({ url, title: '', snippet: '' });
                    }
                  }
                });
              }
            } catch (e) {}
          }
        });
        
        window.ReactNativeWebView.postMessage(JSON.stringify({
          requestId: '${requestId}',
          type: 'searchResults',
          results: results
        }));
      }, ${WEBVIEW_LOAD_DELAY_MS});
      
      true;
    })();
    true;
  `;
}
