import { prisma } from "@core/db/prisma";
import { withLock } from "@core/locks/distributed-lock";
import { UserFacingError, InsufficientFundsError } from "@core/errors/errors";

const CREATE_COST = 5000n;
const UPGRADE_BASE_COST = 1000n;

export class ClanService {
  async create(ownerId: string, name: string, tag: string, guildId?: string) {
    if (name.length < 3 || name.length > 32) throw new UserFacingError("Name must be 3–32 chars.");
    if (!/^[A-Z0-9]{2,5}$/i.test(tag)) throw new UserFacingError("Tag must be 2-5 alphanumeric chars.");
    return withLock(`clan:create:${ownerId}`, 5000, async () => {
      const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { globalBalance: true } });
      if (!user || user.globalBalance < CREATE_COST) throw new InsufficientFundsError();
      const existingOwn = await prisma.clan.findFirst({ where: { ownerId } });
      if (existingOwn) throw new UserFacingError("You already own a clan.");
      const existingMember = await prisma.clanMember.findUnique({ where: { userId: ownerId } });
      if (existingMember) throw new UserFacingError("Leave your current clan first.");

      const [clan] = await prisma.$transaction([
        prisma.clan.create({
          data: { ownerId, name, tag: tag.toUpperCase(), guildId: guildId ?? null },
        }),
        prisma.user.update({ where: { id: ownerId }, data: { globalBalance: { decrement: CREATE_COST } } }),
      ]);
      await prisma.clanMember.create({ data: { userId: ownerId, clanId: clan.id, rank: "owner" } });
      return clan;
    });
  }

  async invite(_actorId: string, _clanId: string, _targetId: string) {
    // Stub: in production, invitations are stored in a separate table and the
    // invited user accepts via a button DM. Left intentionally simple here.
    throw new UserFacingError("Invitations are managed via the web panel.");
  }

  async leave(userId: string) {
    return withLock(`clan:leave:${userId}`, 4000, async () => {
      const member = await prisma.clanMember.findUnique({ where: { userId } });
      if (!member) throw new UserFacingError("You're not in a clan.");
      const clan = await prisma.clan.findUnique({ where: { id: member.clanId } });
      if (clan?.ownerId === userId) throw new UserFacingError("Owner must transfer ownership first.");
      await prisma.clanMember.delete({ where: { id: member.id } });
    });
  }

  async deposit(userId: string, amount: bigint) {
    if (amount <= 0n) throw new UserFacingError("Amount must be positive.");
    return withLock(`clan:dep:${userId}`, 4000, async () => {
      const member = await prisma.clanMember.findUnique({ where: { userId } });
      if (!member) throw new UserFacingError("You're not in a clan.");
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { globalBalance: true } });
      if (!user || user.globalBalance < amount) throw new InsufficientFundsError();
      await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: { globalBalance: { decrement: amount } } }),
        prisma.clan.update({ where: { id: member.clanId }, data: { treasury: { increment: amount } } }),
        prisma.clanMember.update({ where: { id: member.id }, data: { contrib: { increment: amount } } }),
      ]);
    });
  }

  async upgrade(userId: string, key: string) {
    return withLock(`clan:upg:${userId}`, 5000, async () => {
      const member = await prisma.clanMember.findUnique({ where: { userId } });
      if (!member) throw new UserFacingError("You're not in a clan.");
      if (!["owner", "officer"].includes(member.rank)) {
        throw new UserFacingError("Only owners/officers can upgrade.");
      }
      const clan = await prisma.clan.findUnique({ where: { id: member.clanId } });
      if (!clan) throw new UserFacingError("Clan missing.");
      const cur = await prisma.clanUpgrade.findUnique({
        where: { clanId_key: { clanId: clan.id, key } },
      });
      const nextLevel = (cur?.level ?? 0) + 1;
      const cost = UPGRADE_BASE_COST * BigInt(nextLevel * nextLevel);
      if (clan.treasury < cost) throw new InsufficientFundsError();
      await prisma.$transaction([
        prisma.clan.update({ where: { id: clan.id }, data: { treasury: { decrement: cost } } }),
        prisma.clanUpgrade.upsert({
          where: { clanId_key: { clanId: clan.id, key } },
          create: { clanId: clan.id, key, level: 1 },
          update: { level: { increment: 1 } },
        }),
      ]);
      return nextLevel;
    });
  }
}

export const clanService = new ClanService();
