export function formatNumber(n: number | bigint): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatCoins(n: number | bigint): string {
  return `${formatNumber(n)} coins`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || !parts.length) parts.push(`${s}s`);
  return parts.join(" ");
}

export function truncate(s: string, max: number, ellipsis = "…"): string {
  return s.length > max ? s.slice(0, Math.max(0, max - ellipsis.length)) + ellipsis : s;
}

export function progressBar(value: number, total: number, length = 20): string {
  const ratio = total <= 0 ? 0 : Math.min(1, Math.max(0, value / total));
  const filled = Math.round(ratio * length);
  return "█".repeat(filled) + "░".repeat(length - filled);
}
