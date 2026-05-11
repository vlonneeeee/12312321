import { prisma } from "@core/db/prisma";

const INTEREST_RATE = 0.005; // 0.5% per hour, capped at bank limit
const MAX_BANK = 10_000_000n;

export async function runInterestAccrual(): Promise<void> {
  // Apply interest to all members with bank > 0. We chunk by id to avoid full
  // table scans in one shot on big deployments.
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.guildMember.findMany({
      where: { bank: { gt: 0n } },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;
    for (const r of rows) {
      const earn = BigInt(Math.floor(Number(r.bank) * INTEREST_RATE));
      if (earn <= 0n) continue;
      const newBank = r.bank + earn > MAX_BANK ? MAX_BANK : r.bank + earn;
      await prisma.guildMember.update({
        where: { id: r.id },
        data: { bank: newBank },
      });
      await prisma.transaction.create({
        data: {
          userId: r.userId,
          guildId: r.guildId,
          type: "INTEREST",
          amount: newBank - r.bank,
          balance: newBank,
          reason: "Bank interest accrual",
        },
      });
    }
  }
}
