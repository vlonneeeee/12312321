import {
  ActivityType,
  Client,
  GatewayIntentBits,
  Options,
  Partials,
  type ClientOptions,
} from "discord.js";
import path from "node:path";
import { env } from "@core/config/env";
import { child, logger } from "@core/logger/logger";
import { registry } from "@core/handler/registry";
import { connectDatabase, disconnectDatabase } from "@core/db/prisma";
import { redis } from "@core/cache/redis";
import { startHttpServer, stopHttpServer } from "@infra/http/server";
import { startBackgroundJobs, stopBackgroundJobs } from "@infra/jobs/scheduler";
import { getLavalink } from "@infra/lavalink/manager";

const log = child("bot");

const intents: GatewayIntentBits[] = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildIntegrations,
  GatewayIntentBits.GuildPresences,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildEmojisAndStickers,
];

const partials: Partials[] = [
  Partials.Channel,
  Partials.Message,
  Partials.Reaction,
  Partials.User,
  Partials.GuildMember,
];

const clientOpts: ClientOptions = {
  intents,
  partials,
  // Aggressive cache pruning to keep memory under control on big shards.
  makeCache: Options.cacheWithLimits({
    MessageManager: { maxSize: 200 },
    PresenceManager: 0,
    ThreadMemberManager: 0,
    GuildMemberManager: { maxSize: 1000 },
    UserManager: { maxSize: 2000 },
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 300, lifetime: 1800 },
    users: { interval: 3600, filter: () => (u) => u.bot && u.id !== u.client.user.id },
  },
  allowedMentions: { parse: ["users", "roles"], repliedUser: true },
  presence: {
    status: "online",
    activities: [{ name: "your server | /help", type: ActivityType.Watching }],
  },
};

export async function createBot(): Promise<Client> {
  const client = new Client(clientOpts);
  await connectDatabase();
  await redis.ping();

  const modulesDir = path.resolve(__dirname, "../modules");
  await registry.loadFromModulesDir(modulesDir);

  for (const event of registry.events) {
    const wrapped = async (...args: unknown[]) => {
      try {
        await (event.execute as (...a: unknown[]) => Promise<void>)(...args);
      } catch (err) {
        logger.error({ err, event: event.name }, "event handler failed");
      }
    };
    if (event.once) client.once(event.name as string, wrapped);
    else client.on(event.name as string, wrapped);
  }

  client.once("ready", async (c) => {
    log.info({ tag: c.user.tag, guilds: c.guilds.cache.size }, "client ready");
    try {
      await registry.deploy(c.user.id);
    } catch (err) {
      log.error({ err }, "failed to deploy commands");
    }
  });

  client.on("error", (err) => log.error({ err }, "client error"));
  client.on("warn", (msg) => log.warn(msg));
  if (env.isDev) client.on("debug", (msg) => log.debug(msg));

  getLavalink(client);

  await client.login(env.DISCORD_TOKEN);
  await startHttpServer(client);
  await startBackgroundJobs(client);
  return client;
}

export async function shutdownBot(client: Client | undefined): Promise<void> {
  log.info("graceful shutdown starting");
  try {
    await stopBackgroundJobs();
  } catch (err) {
    log.error({ err }, "stopBackgroundJobs failed");
  }
  try {
    await stopHttpServer();
  } catch (err) {
    log.error({ err }, "stopHttpServer failed");
  }
  try {
    await client?.destroy();
  } catch (err) {
    log.error({ err }, "client destroy failed");
  }
  try {
    await disconnectDatabase();
  } catch (err) {
    log.error({ err }, "db disconnect failed");
  }
  try {
    redis.disconnect();
  } catch (err) {
    log.error({ err }, "redis disconnect failed");
  }
  log.info("shutdown complete");
}
