import { icons } from "@/constants/icons";
import type { ImageSourcePropType } from "react-native";

interface BrandEntry {
  names: string[];
  icon: ImageSourcePropType;
  category?: string;
}

interface LogoResult {
  icon: ImageSourcePropType;
  confidence: "high" | "medium" | "low";
  alternatives: { name: string; icon: ImageSourcePropType }[];
}

const brandLogos: BrandEntry[] = [
  {
    names: ["netflix", "netflix premium", "netflix basic", "netflix standard"],
    icon: icons.netflix,
    category: "Entertainment",
  },
  {
    names: ["spotify", "spotify premium", "spotify family", "spotify duo"],
    icon: icons.spotify,
    category: "Music",
  },
  {
    names: [
      "figma",
      "figma professional",
      "figma organization",
      "figma enterprise",
    ],
    icon: icons.figma,
    category: "Design",
  },
  {
    names: [
      "adobe",
      "adobe creative cloud",
      "creative cloud",
      "adobe photoshop",
      "adobe illustrator",
      "adobe after effects",
      "adobe premiere",
      "adobe xd",
    ],
    icon: icons.adobe,
    category: "Design",
  },
  {
    names: ["canva", "canva pro", "canva teams", "canva enterprise"],
    icon: icons.canva,
    category: "Design",
  },
  {
    names: ["github", "github pro", "github enterprise", "github team"],
    icon: icons.github,
    category: "Developer Tools",
  },
  {
    names: ["claude", "claude pro", "claude team", "anthropic"],
    icon: icons.claude,
    category: "AI Tools",
  },
  {
    names: ["openai", "chatgpt", "gpt", "openai api", "chatgpt plus", "gpt-4"],
    icon: icons.openai,
    category: "AI Tools",
  },
  {
    names: ["notion", "notion ai", "notion team", "notion enterprise"],
    icon: icons.notion,
    category: "Productivity",
  },
  {
    names: ["dropbox", "dropbox plus", "dropbox family", "dropbox business"],
    icon: icons.dropbox,
    category: "Cloud",
  },
  {
    names: ["medium", "medium membership"],
    icon: icons.medium,
    category: "Productivity",
  },
];

/**
 * Take a user-provided subscription name and resolve it to the best matching
 * brand icon. Returns the icon, a confidence level, and alternative matches.
 *
 * @param name - The subscription name (e.g. "Netflix Premium", "spotify")
 * @returns An object with the best matching icon, confidence, and alternatives
 */
export function resolveLogo(name: string): LogoResult {
  const query = name.toLowerCase().trim();
  if (!query) {
    return {
      icon: icons.plus,
      confidence: "low",
      alternatives: [],
    };
  }

  // 1. Exact match (high confidence)
  const exactMatches = brandLogos.filter((entry) =>
    entry.names.some((n) => n === query),
  );
  if (exactMatches.length > 0) {
    const alternatives = brandLogos
      .filter((entry) => entry !== exactMatches[0])
      .map((entry) => ({ name: entry.names[0], icon: entry.icon }));
    return {
      icon: exactMatches[0].icon,
      confidence: "high",
      alternatives,
    };
  }

  // 2. Name contains brand keyword or vice versa (medium confidence)
  const containingMatches = brandLogos.filter((entry) =>
    entry.names.some((n) => query.includes(n) || n.includes(query)),
  );
  if (containingMatches.length > 0) {
    const alternatives = brandLogos
      .filter((entry) => !containingMatches.includes(entry))
      .map((entry) => ({ name: entry.names[0], icon: entry.icon }));
    return {
      icon: containingMatches[0].icon,
      confidence: "medium",
      alternatives,
    };
  }

  // 3. Partial word match — check if any word in query matches a brand keyword
  const queryWords = query.split(/[\s_-]+/).filter(Boolean);
  const partialMatches = brandLogos.filter((entry) =>
    entry.names.some((n) =>
      queryWords.some((word) => word.length >= 3 && n.includes(word)),
    ),
  );
  if (partialMatches.length > 0) {
    const alternatives = brandLogos
      .filter((entry) => !partialMatches.includes(entry))
      .map((entry) => ({ name: entry.names[0], icon: entry.icon }));
    return {
      icon: partialMatches[0].icon,
      confidence: "low",
      alternatives,
    };
  }

  // 4. No match — return generic icon
  return {
    icon: icons.plus,
    confidence: "low",
    alternatives: brandLogos.map((entry) => ({
      name: entry.names[0],
      icon: entry.icon,
    })),
  };
}

/**
 * Search for brand logos matching a query. Used by the autocomplete dropdown.
 *
 * @param query - The search string
 * @returns Array of { name, icon } matches, sorted by relevance
 */
export function searchLogos(
  query: string,
): { name: string; icon: ImageSourcePropType; category?: string }[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results: {
    name: string;
    icon: ImageSourcePropType;
    category?: string;
    score: number;
  }[] = [];

  for (const entry of brandLogos) {
    for (const n of entry.names) {
      let score = 0;
      if (n === q) score = 100;
      else if (n.startsWith(q)) score = 80;
      else if (n.includes(q)) score = 60;
      else {
        // Check word-by-word
        const queryWords = q.split(/[\s_-]+/);
        const nameWords = n.split(/[\s_-]+/);
        for (const qw of queryWords) {
          if (nameWords.some((nw) => nw.startsWith(qw))) score += 20;
        }
      }
      if (score > 0) {
        results.push({
          name: entry.names[0],
          icon: entry.icon,
          category: entry.category,
          score,
        });
        break; // One result per brand entry
      }
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .map(({ score, ...rest }) => rest);
}

/**
 * Get category for a known brand name
 */
export function resolveCategory(name: string): string | undefined {
  const query = name.toLowerCase().trim();
  const match = brandLogos.find((entry) =>
    entry.names.some(
      (n) => n === query || query.includes(n) || n.includes(query),
    ),
  );
  return match?.category;
}
