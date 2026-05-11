import Fastify, { type FastifyInstance } from "fastify";
import type { Client } from "discord.js";
import { env } from "@core/config/env";
import { child } from "@core/logger/logger";
import { prisma } from "@core/db/prisma";
import { redis } from "@core/cache/redis";
import { registerStatsRoutes } from "./routes/stats";
import { registerGuildRoutes } from "./routes/guilds";
import { registerAuthRoutes } from "./routes/auth";

const log = child("http");
let server: FastifyInstance | undefined;

export async function startHttpServer(client: Client): Promise<FastifyInstance> {
  server = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  server.decorate("client", client);

  server.addHook("onRequest", async (req) => {
    log.debug({ method: req.method, url: req.url, ip: req.ip }, "http request");
  });

  server.get("/health", async () => ({
    status: "ok",
    uptime: process.uptime(),
    guilds: client.guilds.cache.size,
    ping: client.ws.ping,
  }));

  server.get("/ready", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      reply.code(200).send({ ready: true });
    } catch (err) {
      reply.code(503).send({ ready: false, err: (err as Error).message });
    }
  });

  registerAuthRoutes(server);
  registerStatsRoutes(server);
  registerGuildRoutes(server);

  await server.listen({ port: env.BOT_HTTP_PORT, host: "0.0.0.0" });
  log.info({ port: env.BOT_HTTP_PORT }, "http server started");
  return server;
}

export async function stopHttpServer(): Promise<void> {
  if (server) await server.close();
  server = undefined;
}

declare module "fastify" {
  interface FastifyInstance {
    client: Client;
  }
}
