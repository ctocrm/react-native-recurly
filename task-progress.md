# Icon Search/Crawl System - Fix Plan

## P1 - Critical Issues

### [ ] Fix web search returning 0 results (searchEngines.ts)
- [ ] Add comprehensive error logging to each search function
- [ ] Test each search engine individually with detailed logging
- [ ] Prioritize DuckDuckGo (most likely to work in React Native)
- [ ] Add fallback to DuckDuckGo's HTML/lite version
- [ ] Handle CORS/blocking issues gracefully

### [ ] Fix queue always empty (iconBackgroundCrawler.ts, database.ts)
- [ ] Add logging to enqueueIconScrape to confirm it writes to DB
- [ ] Add small delay between enqueue and process to ensure DB write completes
- [ ] Or change approach: pass URLs directly to processIconQueue instead of using queue table
- [ ] Fix the startup flow in SubscriptionContext to properly call processIconQueue

## P2 - High Priority Issues

### [ ] Fix library CDN search (iconScraper.ts)
- [ ] Check findAllIconSources function
- [ ] Add logging for each CDN source queried
- [ ] Fix nameToSlug to handle edge cases (trailing dashes, spaces, etc.)
- [ ] Add more CDN sources if needed
- [ ] Try multiple slug variations

### [ ] Fix spider (htmlIconExtractor.ts)
- [ ] Add logging for HTML received from each URL
- [ ] Check if HTML parsing correctly extracts icon links
- [ ] Test with known websites

## P3 - Medium Priority Issues

### [ ] Add background crawler for old URLs (iconBackgroundCrawler.ts, SubscriptionContext.tsx)
- [ ] Add setInterval in SubscriptionContext that runs every 30-60 minutes
- [ ] Pick random old URLs from crawled_urls table
- [ ] Re-download and update if content changed
- [ ] Use getOldCrawledUrls function (already added to database.ts)

### [ ] Show library icons in collection immediately (iconBackgroundCrawler.ts)
- [ ] After findIconUrls saves URLs to crawl_results, immediately trigger a fetch for those URLs
- [ ] Don't wait for queue — fetch the first batch immediately
- [ ] Queue handles the rest

## Testing
- [ ] Run TypeScript check: npx tsc --noEmit
- [ ] Run lint check: npm run lint
- [ ] Test the search functionality manually
