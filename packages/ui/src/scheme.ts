// Color schemes: an accent and a dark background, picked from fixed lists, red
// on black by default. tokens.css holds the colors for each id (`data-accent`
// and `data-base` on the root element); this file holds the lists, the default
// and how a scheme reaches a page. Add an id in both places.

export const ACCENTS = [
  { id: "red", label: "Red", swatch: "#e00020" },
  { id: "orange", label: "Orange", swatch: "#f26a1b" },
  { id: "gold", label: "Gold", swatch: "#e0a800" },
  { id: "green", label: "Green", swatch: "#2fb36b" },
  { id: "teal", label: "Teal", swatch: "#3fb89d" },
  { id: "blue", label: "Blue", swatch: "#3b82f6" },
  { id: "purple", label: "Purple", swatch: "#8b5cf6" },
  { id: "pink", label: "Pink", swatch: "#e83e8c" },
] as const;

export const BASES = [
  { id: "black", label: "Black", swatch: "#1b1210" },
  { id: "graphite", label: "Graphite", swatch: "#18191c" },
  { id: "navy", label: "Navy", swatch: "#151e2a" },
  { id: "forest", label: "Forest", swatch: "#121c16" },
  { id: "plum", label: "Plum", swatch: "#1b1420" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];
export type BaseId = (typeof BASES)[number]["id"];

export interface Scheme {
  accent: AccentId;
  base: BaseId;
}

export const DEFAULT_SCHEME: Scheme = { accent: "red", base: "black" };

const isAccent = (value: unknown): value is AccentId => ACCENTS.some((a) => a.id === value);
const isBase = (value: unknown): value is BaseId => BASES.some((b) => b.id === value);

/** A scheme from untrusted data (an answer, a URL, storage); unknown parts fall back to the default. */
export function toScheme(value: unknown): Scheme {
  const v = (value ?? {}) as { accent?: unknown; base?: unknown };
  return {
    accent: isAccent(v.accent) ? v.accent : DEFAULT_SCHEME.accent,
    base: isBase(v.base) ? v.base : DEFAULT_SCHEME.base,
  };
}

export function sameScheme(a: Scheme, b: Scheme): boolean {
  return a.accent === b.accent && a.base === b.base;
}

/** "Red on black". */
export function schemeLabel(scheme: Scheme): string {
  const accent = ACCENTS.find((a) => a.id === scheme.accent)?.label ?? scheme.accent;
  const base = BASES.find((b) => b.id === scheme.base)?.label ?? scheme.base;
  return `${accent} on ${base.toLowerCase()}`;
}

/** Color the page: tokens.css reads these two attributes on the root element. */
export function applyScheme(scheme: Scheme, root: HTMLElement = document.documentElement): void {
  root.dataset.accent = scheme.accent;
  root.dataset.base = scheme.base;
}

/** A scheme given in a page's address (`?accent=blue&base=navy`). */
export function schemeFromUrl(search: string = location.search): Scheme | null {
  const params = new URLSearchParams(search);
  if (!params.has("accent") && !params.has("base")) return null;
  return toScheme({ accent: params.get("accent"), base: params.get("base") });
}

/** The query string for `schemeFromUrl`. */
export function schemeQuery(scheme: Scheme): string {
  return `accent=${scheme.accent}&base=${scheme.base}`;
}
