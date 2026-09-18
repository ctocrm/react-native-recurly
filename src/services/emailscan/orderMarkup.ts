/**
 * R38 Phase 1: schema.org Order markup — the top evidence tier.
 *
 * Emails that carry `application/ld+json` with an Order payload state the
 * facts we otherwise regex-mine (seller, item names, price, currency, order
 * number, status). Canonical field layout (schema.org v30.1, verified
 * 2026-09-18): price/priceCurrency live on the NESTED acceptedOffer (Offer),
 * NOT on Order; orderNumber is being superseded by confirmationNumber — both
 * accepted; orderedItem is OrderItem|Product|Service, single or array, each
 * OrderItem nesting the real Product/Service under its own `orderedItem`.
 *
 * Encoding: JSON-LD is primary (dominant in transactional email); microdata/
 * RDFa are NOT decoded yet (no corpus evidence any sender uses them in mail).
 */

export interface OrderMarkup {
  seller?: string;
  /** Real item names from orderedItem / itemOffered. */
  items: string[];
  price?: number;
  currency?: string;
  orderNumber?: string;
  orderStatus?: string;
  paymentMethod?: string;
  orderDate?: string;
}

/** Extract + parse all ld+json script bodies from an HTML string. */
export function extractLdJsonBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      /* malformed block — skip, regex tiers still apply */
    }
  }
  return out;
}

/** Depth-first walk of a JSON-LD tree (incl. @graph) collecting Order nodes. */
function findOrderNodes(
  node: unknown,
  depth = 0,
  acc: unknown[] = [],
): unknown[] {
  if (depth > 6 || node === null || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const n of node) findOrderNodes(n, depth + 1, acc);
    return acc;
  }
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  const types = Array.isArray(t) ? t.map(String) : t ? [String(t)] : [];
  if (types.some((x) => x.toLowerCase() === "order")) acc.push(obj);
  if (obj["@graph"]) findOrderNodes(obj["@graph"], depth + 1, acc);
  return acc;
}

function asName(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (v && typeof v === "object") {
    const name = (v as Record<string, unknown>)["name"];
    if (typeof name === "string") return name.trim() || undefined;
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    let s = v.replace(/[^0-9.,\-]/g, "");
    if (s.includes(",") && s.includes(".")) {
      // both separators: dots and commas are thousands grouping ("1,234.56")
      s = s.replace(/,/g, "");
    } else if (s.includes(",")) {
      // comma only: single comma = European decimal ("12,50"); several = grouping
      const parts = s.split(",");
      s = parts.length === 2 ? `${parts[0]}.${parts[1]}` : parts.join("");
    }
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function tailOfUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const tail = v.slice(Math.max(v.lastIndexOf("/"), v.lastIndexOf(":")) + 1);
  return tail || undefined;
}

/**
 * Parse the first Order found in an email's HTML. Returns null when the
 * message carries no Order markup (the common case — regex tiers apply).
 */
export function extractOrderMarkup(html?: string | null): OrderMarkup | null {
  if (!html) return null;
  const orders: Record<string, unknown>[] = [];
  for (const block of extractLdJsonBlocks(html)) {
    findOrderNodes(block).forEach((o) =>
      orders.push(o as Record<string, unknown>),
    );
  }
  if (orders.length === 0) return null;
  const o = orders[0];

  const items: string[] = [];
  const pushItem = (v: unknown): void => {
    const name = asName(v);
    if (name && !items.includes(name)) items.push(name);
  };
  const ordered = o["orderedItem"];
  const orderedArr = Array.isArray(ordered)
    ? ordered
    : ordered
      ? [ordered]
      : [];
  for (const it of orderedArr) {
    if (!it || typeof it !== "object") continue;
    const oi = it as Record<string, unknown>;
    // OrderItem: nested Product/Service under `orderedItem`; bare Product/
    // Service carry their own name.
    pushItem(oi["orderedItem"] ?? oi["name"] ?? oi);
  }

  // Price: nested Offer first (schema.org current), Order-level fallback.
  let price: number | undefined;
  let currency: string | undefined;
  const offers = o["acceptedOffer"];
  const offerArr = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const offer of offerArr) {
    if (!offer || typeof offer !== "object") continue;
    const ov = offer as Record<string, unknown>;
    if (price === undefined) price = asNumber(ov["price"]);
    if (currency === undefined && typeof ov["priceCurrency"] === "string") {
      currency = (ov["priceCurrency"] as string).trim() || undefined;
    }
    const offered = ov["itemOffered"];
    if (offered) pushItem(offered);
  }
  if (price === undefined) price = asNumber(o["price"]);
  if (currency === undefined && typeof o["priceCurrency"] === "string") {
    currency = o["priceCurrency"] as string;
  }

  return {
    seller: asName(o["seller"]),
    items: items.slice(0, 8),
    price,
    currency,
    // orderNumber is being superseded by confirmationNumber — accept both.
    orderNumber:
      typeof o["orderNumber"] === "string"
        ? (o["orderNumber"] as string) || undefined
        : typeof o["confirmationNumber"] === "string"
          ? (o["confirmationNumber"] as string) || undefined
          : undefined,
    orderStatus: tailOfUrl(o["orderStatus"]),
    paymentMethod: asName(o["paymentMethod"]),
    orderDate: typeof o["orderDate"] === "string" ? o["orderDate"] : undefined,
  };
}
