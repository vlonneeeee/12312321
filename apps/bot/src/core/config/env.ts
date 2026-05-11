import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { z } from "zod";

// Walk up from cwd looking for a .env so that running the bot from either the
// monorepo root or apps/bot works the same. Falls through to the default
// dotenv behaviour (current cwd) if nothing is found.
function loadEnvFile(): void {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  loadDotenv();
}

loadEnvFile();

const csv = (raw: string | undefined) =>
  (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DISCORD_TOKEN: z.string().min(10, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(5),
  DISCORD_CLIENT_SECRET: z.string().optional().default(""),
  DISCORD_PUBLIC_KEY: z.string().optional().default(""),
  DEV_GUILD_IDS: z.string().optional().default(""),
  OWNER_IDS: z.string().optional().default(""),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  LAVALINK_HOST: z.string().default("localhost"),
  LAVALINK_PORT: z.coerce.number().default(2333),
  LAVALINK_PASSWORD: z.string().default("youshallnotpass"),

  SHARD_COUNT: z.string().default("auto"),
  TOTAL_SHARDS: z.string().default("auto"),

  BOT_HTTP_PORT: z.coerce.number().default(3001),
  DASHBOARD_URL: z.string().default("http://localhost:3000"),

  SESSION_SECRET: z.string().default("change-me-please"),
  JWT_SECRET: z.string().default("change-me-please"),

  OPENAI_API_KEY: z.string().optional().default(""),
  PERSPECTIVE_API_KEY: z.string().optional().default(""),
  VPN_CHECK_API_KEY: z.string().optional().default(""),

  SPOTIFY_CLIENT_ID: z.string().optional().default(""),
  SPOTIFY_CLIENT_SECRET: z.string().optional().default(""),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("[env] Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  DEV_GUILD_IDS: csv(raw.DEV_GUILD_IDS),
  OWNER_IDS: csv(raw.OWNER_IDS),
  isProd: raw.NODE_ENV === "production",
  isDev: raw.NODE_ENV === "development",
} as const;

export type Env = typeof env;
