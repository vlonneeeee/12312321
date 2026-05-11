import type { FastifyInstance } from "fastify";
import { prisma } from "@core/db/prisma";

export function registerStatsRoutes(app: FastifyInstance) {
  app.get("/stats/global", async () => {
    const [users, guilds, transactions] = await Promise.all([
      prisma.user.count(),
      prisma.guild.count(),
      prisma.transaction.count(),
    ]);
    return { users, guilds, transactions, shardPing: app.client.ws.ping };
  });

  app.get("/stats/leaderboard/global", async () => {
    const top = await prisma.user.findMany({
      orderBy: [{ level: "desc" }, { xp: "desc" }],
      take: 100,
      select: { id: true, username: true, level: true, xp: true, globalBalance: true, reputation: true },
    });
    return { leaderboard: top };
  });
}
