import { prisma } from "@core/db/prisma";
import { redis } from "@core/cache/redis";
import { child } from "@core/logger/logger";
import ru from "./locales/ru.json";
import en from "./locales/en.json";

const log = child("i18n");

export type Locale = "ru" | "en";
export const SUPPORTED_LOCALES: Locale[] = ["ru", "en"];
export const DEFAULT_LOCALE: Locale = "ru";

const bundles: Record<Locale, Record<string, unknown>> = { ru, en };

const CACHE_TTL_SEC = 300;
const CACHE_KEY = (guildId: string) => `i18n:lang:${guildId}`;

export async function getGuildLocale(guildId: string | null | undefined): Promise<Locale> {
  if (!guildId) return DEFAULT_LOCALE;
  try {
    const cached = await redis.get(CACHE_KEY(guildId));
    if (cached && SUPPORTED_LOCALES.includes(cached as Locale)) return cached as Locale;
  } catch {
    /* redis may be transiently unavailable; fall through to db */
  }
  const g = await prisma.guild.findUnique({
    where: { id: guildId },
    select: { language: true },
  });
  const lang = (g?.language && SUPPORTED_LOCALES.includes(g.language as Locale))
    ? (g.language as Locale)
    : DEFAULT_LOCALE;
  try {
    await redis.set(CACHE_KEY(guildId), lang, "EX", CACHE_TTL_SEC);
  } catch {
    /* ignore cache write failures */
  }
  return lang;
}

export async function setGuildLocale(guildId: string, lang: Locale): Promise<void> {
  if (!SUPPORTED_LOCALES.includes(lang)) {
    throw new Error(`Unsupported locale: ${lang}`);
  }
  await prisma.guild.update({ where: { id: guildId }, data: { language: lang } });
  try {
    await redis.set(CACHE_KEY(guildId), lang, "EX", CACHE_TTL_SEC);
  } catch {
    /* ignore */
  }
  log.info({ guildId, lang }, "guild language updated");
}

function lookup(bundle: Record<string, unknown>, dotted: string): string | undefined {
  const parts = dotted.split(".");
  let cur: unknown = bundle;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined ? `{${k}}` : String(v);
  });
}

/**
 * Synchronous translator. Resolves a key from the given locale and falls back
 * to the default locale (ru) and then to the key itself if both miss.
 */
export function tWithLocale(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const primary = lookup(bundles[locale], key);
  if (primary) return interpolate(primary, vars);
  if (locale !== DEFAULT_LOCALE) {
    const fallback = lookup(bundles[DEFAULT_LOCALE], key);
    if (fallback) return interpolate(fallback, vars);
  }
  // Try english as ultimate fallback
  if (locale !== "en") {
    const fallback = lookup(bundles.en, key);
    if (fallback) return interpolate(fallback, vars);
  }
  return key;
}

/**
 * Async translator that resolves the guild's stored locale automatically.
 * Prefer this in command handlers where we have an interaction.
 */
export async function t(
  guildId: string | null | undefined,
  key: string,
  vars?: Record<string, string | number>,
): Promise<string> {
  const locale = await getGuildLocale(guildId);
  return tWithLocale(locale, key, vars);
}
