import { Prisma } from "@prisma/client";
import { prisma } from "@core/db/prisma";
import { withLock } from "@core/locks/distributed-lock";
import { InsufficientFundsError, UserFacingError } from "@core/errors/errors";
import { eventBus } from "@core/events/event-bus";
import { RateLimiter } from "@core/ratelimit/rate-limiter";

const DAILY_AMOUNT = 500n;
const WEEKLY_AMOUNT = 5000n;
const WORK_MIN = 50n;
const WORK_MAX = 350n;
const CRIME_MIN = 100n;
const CRIME_MAX = 800n;
const CRIME_FAIL_FINE = 200n;

const robLimiter = new RateLimiter("rob", 3, 3600); // 3 robberies / hour

function pickRandom(min: bigint, max: bigint): bigint {
  const range = Number(max - min);
  return min + BigInt(Math.floor(Math.random() * (range + 1)));
}

export class EconomyService {
  async getBalance(userId: string, guildId: string) {
    const [user, member] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { globalBalance: true, globalBank: true },
      }),
      prisma.guildMember.findUnique({
        where: { userId_guildId: { userId, guildId } },
        select: { coins: true, bank: true },
      }),
    ]);
    return {
      globalWallet: user?.globalBalance ?? 0n,
      globalBank: user?.globalBank ?? 0n,
      wallet: member?.coins ?? 0n,
      bank: member?.bank ?? 0n,
    };
  }

  async daily(userId: string, guildId: string): Promise<bigint> {
    return withLock(`econ:${userId}:${guildId}:daily`, 4000, async () => {
      const member = await prisma.guildMember.findUnique({
        where: { userId_guildId: { userId, guildId } },
      });
      if (!member) throw new UserFacingError("Run any command first to register.");
      const now = new Date();
      if (member.lastDaily && now.getTime() - member.lastDaily.getTime() < 86_400_000) {
        const left = 86_400_000 - (now.getTime() - member.lastDaily.getTime());
        throw new UserFacingError(`Daily already claimed. Try again in ${Math.ceil(left / 3600000)}h.`);
      }
      await prisma.$transaction([
        prisma.guildMember.update({
          where: { userId_guildId: { userId, guildId } },
          data: { coins: { increment: DAILY_AMOUNT }, lastDaily: now },
        }),
        prisma.transaction.create({
          data: {
            userId,
            guildId,
            type: "DAILY",
            amount: DAILY_AMOUNT,
            balance: member.coins + DAILY_AMOUNT,
            reason: "Daily reward",
          },
        }),
      ]);
      eventBus.emit("economy.transaction", { userId, guildId, amount: DAILY_AMOUNT, type: "DAILY" });
      return DAILY_AMOUNT;
    });
  }

  async weekly(userId: string, guildId: string): Promise<bigint> {
    return withLock(`econ:${userId}:${guildId}:weekly`, 4000, async () => {
      const member = await prisma.guildMember.findUnique({
        where: { userId_guildId: { userId, guildId } },
      });
      if (!member) throw new UserFacingError("Run any command first to register.");
      const now = new Date();
      if (member.lastWeekly && now.getTime() - member.lastWeekly.getTime() < 7 * 86_400_000) {
        const left = 7 * 86_400_000 - (now.getTime() - member.lastWeekly.getTime());
        throw new UserFacingError(`Weekly already claimed. Come back in ${Math.ceil(left / 86_400_000)}d.`);
      }
      await prisma.$transaction([
        prisma.guildMember.update({
          where: { userId_guildId: { userId, guildId } },
          data: { coins: { increment: WEEKLY_AMOUNT }, lastWeekly: now },
        }),
        prisma.transaction.create({
          data: {
            userId,
            guildId,
            type: "WEEKLY",
            amount: WEEKLY_AMOUNT,
            balance: member.coins + WEEKLY_AMOUNT,
          },
        }),
      ]);
      eventBus.emit("economy.transaction", { userId, guildId, amount: WEEKLY_AMOUNT, type: "WEEKLY" });
      return WEEKLY_AMOUNT;
    });
  }

  async work(userId: string, guildId: string): Promise<bigint> {
    return withLock(`econ:${userId}:${guildId}:work`, 4000, async () => {
      const member = await prisma.guildMember.findUnique({
        where: { userId_guildId: { userId, guildId } },
      });
      if (!member) throw new UserFacingError("Run any command first to register.");
      const now = new Date();
      if (member.lastWork && now.getTime() - member.lastWork.getTime() < 3600_000) {
        const left = 3600_000 - (now.getTime() - member.lastWork.getTime());
        throw new UserFacingError(`You're tired. Try again in ${Math.ceil(left / 60_000)}m.`);
      }
      const earned = pickRandom(WORK_MIN, WORK_MAX);
      await prisma.$transaction([
        prisma.guildMember.update({
          where: { userId_guildId: { userId, guildId } },
          data: { coins: { increment: earned }, lastWork: now },
        }),
        prisma.transaction.create({
          data: { userId, guildId, type: "WORK", amount: earned, balance: member.coins + earned },
        }),
      ]);
      eventBus.emit("economy.transaction", { userId, guildId, amount: earned, type: "WORK" });
      return earned;
    });
  }

  async crime(
    userId: string,
    guildId: string,
  ): Promise<{ ok: boolean; amount: bigint }> {
    return withLock(`econ:${userId}:${guildId}:crime`, 4000, async () => {
      const member = await prisma.guildMember.findUnique({
        where: { userId_guildId: { userId, guildId } },
      });
      if (!member) throw new UserFacingError("Run any command first to register.");
      const now = new Date();
      if (member.lastCrime && now.getTime() - member.lastCrime.getTime() < 1800_000) {
        const left = 1800_000 - (now.getTime() - member.lastCrime.getTime());
        throw new UserFacingError(`Lay low for ${Math.ceil(left / 60_000)}m before the next job.`);
      }
      const success = Math.random() < 0.65;
      if (success) {
        const earned = pickRandom(CRIME_MIN, CRIME_MAX);
        await prisma.$transaction([
          prisma.guildMember.update({
            where: { userId_guildId: { userId, guildId } },
            data: { coins: { increment: earned }, lastCrime: now },
          }),
          prisma.transaction.create({
            data: { userId, guildId, type: "CRIME", amount: earned, balance: member.coins + earned },
          }),
        ]);
        return { ok: true, amount: earned };
      }
      const fine = member.coins < CRIME_FAIL_FINE ? member.coins : CRIME_FAIL_FINE;
      await prisma.$transaction([
        prisma.guildMember.update({
          where: { userId_guildId: { userId, guildId } },
          data: { coins: { decrement: fine }, lastCrime: now },
        }),
        prisma.transaction.create({
          data: {
            userId,
            guildId,
            type: "CRIME",
            amount: -fine,
            balance: member.coins - fine,
            reason: "Caught — fine",
          },
        }),
      ]);
      return { ok: false, amount: fine };
    });
  }

  async transfer(
    fromUserId: string,
    toUserId: string,
    guildId: string,
    amount: bigint,
  ): Promise<void> {
    if (amount <= 0n) throw new UserFacingError("Amount must be positive.");
    if (fromUserId === toUserId) throw new UserFacingError("Cannot transfer to yourself.");
    await withLock(`econ:${fromUserId}:${guildId}:tx`, 5000, async () => {
      const from = await prisma.guildMember.findUnique({
        where: { userId_guildId: { userId: fromUserId, guildId } },
      });
      if (!from || from.coins < amount) throw new InsufficientFundsError();
      await prisma.$transaction([
        prisma.guildMember.update({
          where: { userId_guildId: { userId: fromUserId, guildId } },
          data: { coins: { decrement: amount } },
        }),
        prisma.guildMember.upsert({
          where: { userId_guildId: { userId: toUserId, guildId } },
          create: { userId: toUserId, guildId, coins: amount },
          update: { coins: { increment: amount } },
        }),
        prisma.transaction.createMany({
          data: [
            { userId: fromUserId, guildId, type: "TRANSFER_OUT", amount: -amount, balance: 0n },
            { userId: toUserId, guildId, type: "TRANSFER_IN", amount, balance: 0n },
          ],
        }),
      ]);
    });
  }

  async deposit(userId: string, guildId: string, amount: bigint): Promise<void> {
    if (amount <= 0n) throw new UserFacingError("Amount must be positive.");
    await withLock(`econ:${userId}:${guildId}:bank`, 4000, async () => {
      const member = await prisma.guildMember.findUnique({
        where: { userId_guildId: { userId, guildId } },
      });
      if (!member || member.coins < amount) throw new InsufficientFundsError();
      await prisma.$transaction([
        prisma.guildMember.update({
          where: { userId_guildId: { userId, guildId } },
          data: { coins: { decrement: amount }, bank: { increment: amount } },
        }),
        prisma.transaction.create({
          data: { userId, guildId, type: "DEPOSIT", amount, balance: member.coins - amount },
        }),
      ]);
    });
  }

  async withdraw(userId: string, guildId: string, amount: bigint): Promise<void> {
    if (amount <= 0n) throw new UserFacingError("Amount must be positive.");
    await withLock(`econ:${userId}:${guildId}:bank`, 4000, async () => {
      const member = await prisma.guildMember.findUnique({
        where: { userId_guildId: { userId, guildId } },
      });
      if (!member || member.bank < amount) throw new InsufficientFundsError();
      await prisma.$transaction([
        prisma.guildMember.update({
          where: { userId_guildId: { userId, guildId } },
          data: { coins: { increment: amount }, bank: { decrement: amount } },
        }),
        prisma.transaction.create({
          data: { userId, guildId, type: "WITHDRAW", amount, balance: member.coins + amount },
        }),
      ]);
    });
  }

  async rob(
    fromUserId: string,
    toUserId: string,
    guildId: string,
  ): Promise<{ ok: boolean; amount: bigint }> {
    if (fromUserId === toUserId) throw new UserFacingError("You can't rob yourself.");
    const rl = await robLimiter.hit(fromUserId);
    if (!rl.ok) throw new UserFacingError("You've been robbing too much. Cool off.");
    return withLock(`econ:${toUserId}:${guildId}:rob`, 5000, async () => {
      const target = await prisma.guildMember.findUnique({
        where: { userId_guildId: { userId: toUserId, guildId } },
      });
      if (!target || target.coins <= 0n) throw new UserFacingError("Target has nothing worth taking.");
      const success = Math.random() < 0.4;
      if (!success) {
        const fine = 100n;
        await prisma.guildMember.update({
          where: { userId_guildId: { userId: fromUserId, guildId } },
          data: { coins: { decrement: fine } },
        });
        return { ok: false, amount: fine };
      }
      const stolen = BigInt(Math.floor(Number(target.coins) * 0.2));
      const amount = stolen > 0n ? stolen : 1n;
      await prisma.$transaction([
        prisma.guildMember.update({
          where: { userId_guildId: { userId: toUserId, guildId } },
          data: { coins: { decrement: amount } },
        }),
        prisma.guildMember.update({
          where: { userId_guildId: { userId: fromUserId, guildId } },
          data: { coins: { increment: amount } },
        }),
        prisma.transaction.create({
          data: { userId: fromUserId, guildId, type: "ROB", amount, balance: 0n },
        }),
      ]);
      return { ok: true, amount };
    });
  }

  async leaderboard(guildId: string, limit = 10) {
    return prisma.guildMember.findMany({
      where: { guildId },
      orderBy: [{ coins: "desc" }, { bank: "desc" }],
      take: limit,
      include: { user: { select: { id: true, username: true } } },
    });
  }
}

export const economyService = new EconomyService();
export { Prisma };
