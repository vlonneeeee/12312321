import type { FastifyInstance } from "fastify";
import axios from "axios";
import { randomBytes } from "node:crypto";
import { env } from "@core/config/env";
import { prisma } from "@core/db/prisma";
import { redis } from "@core/cache/redis";

const STATE_TTL = 600; // 10m
const SESSION_TTL_DAYS = 30;

export function registerAuthRoutes(app: FastifyInstance) {
  app.get("/auth/login", async (req, reply) => {
    const state = randomBytes(16).toString("hex");
    await redis.set(`oauth:state:${state}`, "1", "EX", STATE_TTL);
    const url = new URL("https://discord.com/api/oauth2/authorize");
    url.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
    url.searchParams.set("redirect_uri", `${env.DASHBOARD_URL}/auth/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify guilds");
    url.searchParams.set("state", state);
    reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/auth/callback",
    async (req, reply) => {
      const { code, state } = req.query;
      if (!code || !state) return reply.code(400).send({ error: "missing code/state" });
      const stateOk = await redis.del(`oauth:state:${state}`);
      if (!stateOk) return reply.code(400).send({ error: "invalid state" });

      const tokenRes = await axios
        .post(
          "https://discord.com/api/oauth2/token",
          new URLSearchParams({
            client_id: env.DISCORD_CLIENT_ID,
            client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: `${env.DASHBOARD_URL}/auth/callback`,
          }),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
        )
        .catch((err) => {
          app.log.error?.(err);
          return null;
        });
      if (!tokenRes) return reply.code(401).send({ error: "token exchange failed" });

      const me = await axios.get<{ id: string; username: string; global_name?: string; avatar?: string }>(
        "https://discord.com/api/users/@me",
        { headers: { Authorization: `Bearer ${tokenRes.data.access_token}` } },
      );

      await prisma.user.upsert({
        where: { id: me.data.id },
        create: {
          id: me.data.id,
          username: me.data.username,
          globalName: me.data.global_name ?? null,
          avatarHash: me.data.avatar ?? null,
        },
        update: {
          username: me.data.username,
          globalName: me.data.global_name ?? null,
          avatarHash: me.data.avatar ?? null,
          lastSeenAt: new Date(),
        },
      });

      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
      await prisma.webSession.create({
        data: { userId: me.data.id, token, expiresAt, ip: req.ip, userAgent: req.headers["user-agent"] ?? null },
      });
      reply.header(
        "Set-Cookie",
        `session=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${expiresAt.toUTCString()}`,
      );
      reply.redirect(`${env.DASHBOARD_URL}/dashboard?token=${token}`);
    },
  );

  app.get("/auth/me", async (req, reply) => {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const session = await prisma.webSession.findUnique({ where: { token } });
    if (!session || session.expiresAt < new Date()) {
      return reply.code(401).send({ error: "session expired" });
    }
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    return reply.send({ user });
  });
}
