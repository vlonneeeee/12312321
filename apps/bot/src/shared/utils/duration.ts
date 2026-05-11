/**
 * Parse a compact duration string into milliseconds.
 *
 * Accepts combinations like "2h", "30m", "1d6h", "1w2d", "45s".
 * Units: w(eek), d(ay), h(our), m(in), s(econd).
 * Returns null on invalid input.
 */
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  w: 7 * 24 * 60 * 60_000,
};

const PART_RE = /(\d+)([smhdw])/gi;

export function parseDuration(input: string): number | null {
  if (!input) return null;
  const cleaned = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!cleaned) return null;
  // Allow shorthand like "120" → seconds
  if (/^\d+$/.test(cleaned)) {
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n * 1000;
  }
  let total = 0;
  let matched = "";
  for (const m of cleaned.matchAll(PART_RE)) {
    const n = Number(m[1]);
    const u = m[2]!;
    const factor = UNIT_MS[u];
    if (!factor || !Number.isFinite(n)) return null;
    total += n * factor;
    matched += m[0];
  }
  if (matched !== cleaned) return null;
  if (total <= 0) return null;
  return total;
}

/**
 * Render a millisecond duration as compact, human-friendly text.
 * Drops zero parts; always returns at least seconds.
 */
export function humanizeDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  const w = Math.floor(sec / (7 * 24 * 3600));
  const d = Math.floor((sec % (7 * 24 * 3600)) / (24 * 3600));
  const h = Math.floor((sec % (24 * 3600)) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (w) parts.push(`${w}w`);
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || !parts.length) parts.push(`${s}s`);
  return parts.join(" ");
}
