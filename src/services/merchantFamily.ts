/**
 * R36: merchant families. Some merchants run several keyed streams that are
 * ONE card to the user — Amazon: the Prime membership (recurring
 * "primevideo") and the store purchases (sparse "amazon"). The family map
 * groups member slugs for card rendering and stacked sparse lines; the rows
 * themselves stay separate (stream identity is preserved).
 *
 * Keep this list DELIBERATELY small: a wrong family merges two businesses'
 * spend. Only families the user has confirmed.
 */
import { nameToSlug } from "@/services/iconScraper";

/** family slug → member slugs (each member appears in exactly one family). */
const FAMILIES: Record<string, string[]> = {
  amazon: ["amazon", "primevideo"],
};

const MEMBER_TO_FAMILY = new Map<string, string>();
for (const [family, members] of Object.entries(FAMILIES)) {
  for (const member of members) {
    MEMBER_TO_FAMILY.set(member, family);
  }
}

/** The family a row's name-slug belongs to, or null. */
export function familyForName(name: string): string | null {
  return MEMBER_TO_FAMILY.get(nameToSlug(name)) ?? null;
}

/**
 * All member slugs of the row's family INCLUDING its own slug — a flat
 * [own] for ungrouped merchants (callers never branch on family vs not).
 */
export function familyMemberSlugs(name: string): string[] {
  const slug = nameToSlug(name);
  const family = MEMBER_TO_FAMILY.get(slug);
  return family ? FAMILIES[family] : [slug];
}

/** Display name for the family card (title-cased family slug). */
export function familyDisplayName(family: string): string {
  return family
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * R36: one CARD per family. Rows stay individual; this groups them for
 * rendering — the recurring member fronts the card (the subscription is the
 * headline, store spend stacks under it), other members render in the meta
 * line. Ungrouped merchants are singleton groups.
 */
export function groupByFamily<
  T extends { name: string; category?: string | null },
>(rows: T[]): { primary: T; members: T[] }[] {
  const groups = new Map<string, T[]>();
  const singletons: { primary: T; members: T[] }[] = [];
  for (const row of rows) {
    const family = familyForName(row.name);
    if (!family) {
      singletons.push({ primary: row, members: [row] });
      continue;
    }
    const list = groups.get(family);
    if (list) list.push(row);
    else groups.set(family, [row]);
  }
  const familyGroups: { primary: T; members: T[] }[] = [];
  for (const list of groups.values()) {
    // The recurring member fronts the card; fall back to the first row.
    const primary = list.find((r) => r.category === "recurring") ?? list[0];
    familyGroups.push({ primary, members: list });
  }
  // Preserve overall ordering: family cards take the primary's position.
  const order = new Map(rows.map((r, i) => [r, i] as const));
  const withIndex = [...familyGroups, ...singletons].map((g) => ({
    g,
    i: Math.min(...g.members.map((m) => order.get(m) ?? 0)),
  }));
  withIndex.sort((a, b) => a.i - b.i);
  return withIndex.map((w) => w.g);
}
