import { ShardingManager } from "discord.js";
import path from "node:path";
import { env } from "@core/config/env";
import { child } from "@core/logger/logger";

const log = child("sharding");

/**
 * Manages a single ShardingManager. Use this to start the bot in production
 * across multiple shards. In development you can just run `tsx watch src/index.ts`
 * directly without sharding.
 */
export async function spawnShards(): Promise<ShardingManager> {
  const entry = path.resolve(__dirname, "../../index.js");
  const totalShards: number | "auto" =
    env.TOTAL_SHARDS === "auto" ? "auto" : Number(env.TOTAL_SHARDS);

  const manager = new ShardingManager(entry, {
    token: env.DISCORD_TOKEN,
    totalShards,
    respawn: true,
    mode: "process",
  });

  manager.on("shardCreate", (shard) => {
    log.info({ shardId: shard.id }, "shard spawned");
    shard.on("ready", () => log.info({ shardId: shard.id }, "shard ready"));
    shard.on("disconnect", () => log.warn({ shardId: shard.id }, "shard disconnected"));
    shard.on("reconnecting", () => log.warn({ shardId: shard.id }, "shard reconnecting"));
    shard.on("death", () => log.error({ shardId: shard.id }, "shard died"));
  });

  await manager.spawn();
  return manager;
}
