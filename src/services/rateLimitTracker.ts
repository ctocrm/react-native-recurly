/**
 * Domain-level rate limit tracker.
 * Persists rate limit state to SecureStore so it survives app restarts.
 * Falls back to in-memory-only if SecureStore is unavailable.
 *
 * Prevents hammering domains that have returned 429 (or 403) responses.
 * Uses an escalating cooldown ladder: 30s → 2min → 5min → 15min → 1hr → 4hr
 */

const STORAGE_KEY = "rate_limiter_state_v1";

// Cooldown ladder in milliseconds
const COOLDOWN_LADDER = [
  30_000, 120_000, 300_000, 900_000, 3_600_000, 14_400_000,
];
const MAX_COOLDOWN = 14_400_000; // 4 hours

interface DomainRateState {
  isRateLimited: boolean;
  rateLimitedAt: number;
  cooldownUntil: number;
  consecutive429s: number;
  lastSuccessAt: number;
}

// In-memory state map
const stateMap = new Map<string, DomainRateState>();

// Listeners for UI updates
type Listener = () => void;
const listeners = new Set<Listener>();

let loaded = false;
let storageAvailable = true;

// ---- Lazy storage abstraction ----
// SecureStore may not be available in all environments (e.g. Expo Go, web, etc.)
// We lazily import it and fall back to in-memory-only if it fails.
// Sentinel undefined = not yet loaded, null = failed to load, object = loaded successfully
let secureStoreModule: any = undefined;

async function getSecureStore(): Promise<any> {
  if (secureStoreModule !== undefined) return secureStoreModule;
  try {
    secureStoreModule = await import("expo-secure-store");
    return secureStoreModule;
  } catch (err) {
    console.warn(
      "[RATE_LIMIT] expo-secure-store not available, using in-memory only:",
      err,
    );
    secureStoreModule = null;
    storageAvailable = false;
    return null;
  }
}

function getDomainFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return "unknown";
  }
}

// ---- Persistence ----

async function saveState(): Promise<void> {
  if (!storageAvailable) return;
  try {
    const store = await getSecureStore();
    if (!store) return;
    const obj: Record<string, DomainRateState> = {};
    stateMap.forEach((v, k) => {
      obj[k] = v;
    });
    await store.setItemAsync(STORAGE_KEY, JSON.stringify(obj));
  } catch (err) {
    console.warn("[RATE_LIMIT] Failed to save state:", err);
    storageAvailable = false;
  }
}

async function loadState(): Promise<void> {
  if (loaded) return;
  loaded = true;
  if (!storageAvailable) return;
  try {
    const store = await getSecureStore();
    if (!store) return;
    const raw = await store.getItemAsync(STORAGE_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, DomainRateState>;
      const now = Date.now();
      for (const [domain, state] of Object.entries(obj)) {
        if (state.cooldownUntil > now) {
          stateMap.set(domain, state);
        }
      }
    }
  } catch (err) {
    console.warn("[RATE_LIMIT] Failed to load state:", err);
    storageAvailable = false;
  }
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await loadState();
}

// ---- Core API ----

export async function recordRateLimit(url: string): Promise<void> {
  await ensureLoaded();
  const domain = getDomainFromUrl(url);
  const now = Date.now();
  const existing = stateMap.get(domain);

  const consecutive429s = (existing?.consecutive429s ?? 0) + 1;
  const ladderIndex = Math.min(consecutive429s - 1, COOLDOWN_LADDER.length - 1);
  const cooldownMs = COOLDOWN_LADDER[ladderIndex] ?? MAX_COOLDOWN;
  const cooldownUntil = now + cooldownMs;

  stateMap.set(domain, {
    isRateLimited: true,
    rateLimitedAt: now,
    cooldownUntil,
    consecutive429s,
    lastSuccessAt: existing?.lastSuccessAt ?? 0,
  });

  const cooldownSec = Math.round(cooldownMs / 1000);
  const cooldownMin = Math.round(cooldownSec / 60);
  console.log(
    `[RATE_LIMIT] ${domain}: 429 #${consecutive429s}, cooling down for ${cooldownSec > 120 ? `${cooldownMin}min` : `${cooldownSec}s`}`,
  );

  await saveState();
  notifyListeners();
}

export async function recordSuccess(url: string): Promise<void> {
  await ensureLoaded();
  const domain = getDomainFromUrl(url);
  const now = Date.now();

  stateMap.set(domain, {
    isRateLimited: false,
    rateLimitedAt: 0,
    cooldownUntil: 0,
    consecutive429s: 0,
    lastSuccessAt: now,
  });

  await saveState();
}

export async function isDomainRateLimited(url: string): Promise<boolean> {
  await ensureLoaded();
  const domain = getDomainFromUrl(url);
  const state = stateMap.get(domain);
  if (!state) return false;

  const now = Date.now();
  if (state.cooldownUntil <= now) {
    stateMap.set(domain, {
      isRateLimited: false,
      rateLimitedAt: 0,
      cooldownUntil: 0,
      consecutive429s: 0,
      lastSuccessAt: state.lastSuccessAt,
    });
    await saveState();
    return false;
  }

  return state.isRateLimited;
}

export async function getRateLimitedDomains(): Promise<
  { domain: string; cooldownUntil: number; remainingMs: number }[]
> {
  await ensureLoaded();
  const now = Date.now();
  const results: {
    domain: string;
    cooldownUntil: number;
    remainingMs: number;
  }[] = [];

  for (const [domain, state] of stateMap.entries()) {
    if (state.isRateLimited && state.cooldownUntil > now) {
      results.push({
        domain,
        cooldownUntil: state.cooldownUntil,
        remainingMs: state.cooldownUntil - now,
      });
    }
  }

  return results;
}

// ---- UI Integration ----

export function addRateLimitListener(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function notifyListeners(): void {
  listeners.forEach((cb) => cb());
}

// ---- Utility ----

export { getDomainFromUrl };
