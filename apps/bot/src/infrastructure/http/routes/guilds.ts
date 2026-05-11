import type { FastifyInstance } from "fastify";
import { prisma } from "@core/db/prisma";

export function registerGuildRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/guilds/:id", async (req, reply) => {
    const g = await prisma.guild.findUnique({
      where: { id: req.params.id },
      include: { antiSpam: true, antiRaid: true, antiNuke: true, verification: true },
    });
    if (!g) return reply.code(404).send({ error: "not found" });
    return reply.send({ guild: g });
  });

  app.get<{ Params: { id: string } }>("/guilds/:id/leaderboard", async (req) => {
    const top = await prisma.guildMember.findMany({
      where: { guildId: req.params.id },
      orderBy: [{ level: "desc" }, { xp: "desc" }],
      take: 100,
      include: { user: { select: { id: true, username: true, avatarHash: true } } },
    });
    return { leaderboard: top };
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/guilds/:id",
    async (req, reply) => {
      // NOTE: protect this route with proper auth + permission checks in
      // production. The web panel must verify the caller has ManageGuild in
      // the target guild before calling this endpoint.
      const allowed: (keyof typeof req.body)[] = [
        "musicEnabled",
        "moderationEnabled",
        "economyEnabled",
        "ticketsEnabled",
        "roomsEnabled",
        "verificationEnabled",
        "newsEnabled",
        "clansEnabled",
        "votingEnabled",
        "voiceXpEnabled",
        "analyticsEnabled",
        "language",
        "timezone",
        "prefix",
        "welcomeMessage",
        "goodbyeMessage",
      ];
      const data: Record<string, unknown> = {};
      for (const k of allowed) if (k in req.body) data[k] = req.body[k];
      const g = await prisma.guild.update({ where: { id: req.params.id }, data });
      return reply.send({ guild: g });
    },
  );
}
