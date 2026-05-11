import { LavalinkManager, type LavalinkNodeOptions } from "lavalink-client";
import type { Client } from "discord.js";
import { env } from "@core/config/env";
import { child } from "@core/logger/logger";

const log = child("lavalink");

let manager: LavalinkManager | undefined;

const nodes: LavalinkNodeOptions[] = [
  {
    authorization: env.LAVALINK_PASSWORD,
    host: env.LAVALINK_HOST,
    port: env.LAVALINK_PORT,
    id: "main",
    secure: false,
    retryAmount: 6,
    retryDelay: 5000,
  },
];

export function getLavalink(client: Client): LavalinkManager {
  if (manager) return manager;

  manager = new LavalinkManager({
    nodes,
    sendToShard: (guildId, payload) => {
      const guild = client.guilds.cache.get(guildId);
      if (guild) guild.shard.send(payload);
    },
    autoSkip: true,
    autoSkipOnResolveError: true,
    emitNewSongsOnly: false,
    client: {
      id: env.DISCORD_CLIENT_ID,
      username: "bot",
    },
    playerOptions: {
      maxErrorsPerTime: { threshold: 10_000, maxAmount: 3 },
      onDisconnect: { autoReconnect: true, destroyPlayer: false },
      onEmptyQueue: { destroyAfterMs: 30_000 },
      volumeDecrementer: 0.75,
      applyVolumeAsFilter: false,
    },
    queueOptions: { maxPreviousTracks: 25 },
  });

  manager.nodeManager.on("connect", (node) =>
    log.info({ id: node.id }, "lavalink node connected"),
  );
  manager.nodeManager.on("disconnect", (node, reason) =>
    log.warn({ id: node.id, code: reason.code }, "lavalink node disconnected"),
  );
  manager.nodeManager.on("error", (node, err) =>
    log.error({ id: node.id, err: err.message }, "lavalink node error"),
  );

  client.on("raw", (d) => manager?.sendRawData(d));

  const initManager = () => {
    if (!client.user) return;
    manager
      ?.init({ id: client.user.id, username: client.user.username })
      .then(() => log.info("lavalink manager initialised"))
      .catch((err) => log.error({ err: err instanceof Error ? err.message : err }, "lavalink init failed"));
  };

  if (client.isReady() && client.user) {
    initManager();
  } else {
    client.once("ready", initManager);
  }

  return manager;
}
