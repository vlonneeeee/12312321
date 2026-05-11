import { prisma } from "@core/db/prisma";
import { child } from "@core/logger/logger";

const log = child("jobs:business");

const PAYOUT_INTERVAL_MS = 60 * 60 * 1000; // 1h
const BASE_INCOME_PER_LEVEL = 250n;

export async function runBusinessIncome(): Promise<void> {
  const cutoff = new Date(Date.now() - PAYOUT_INTERVAL_MS);
  const businesses = await prisma.business.findMany({
    where: { lastCollect: { lte: cutoff } },
    take: 500,
  });
  for (const b of businesses) {
    const elapsedHours = Math.max(
      1,
      Math.floor((Date.now() - b.lastCollect.getTime()) / PAYOUT_INTERVAL_MS),
    );
    const payout = BASE_INCOME_PER_LEVEL * BigInt(b.level) * BigInt(elapsedHours);
    try {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: b.ownerId },
          data: { globalBalance: { increment: payout } },
        }),
        prisma.business.update({
          where: { id: b.id },
          data: { lastCollect: new Date(), income: { increment: payout } },
        }),
        prisma.transaction.create({
          data: {
            userId: b.ownerId,
            guildId: b.guildId ?? null,
            type: "BUSINESS_INCOME",
            amount: payout,
            balance: 0n,
            reason: `Income from ${b.name}`,
          },
        }),
      ]);
    } catch (err) {
      log.warn({ err, id: b.id }, "business payout failed");
    }
  }
}
