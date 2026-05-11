import type { Client, SendableChannels } from "discord.js";
import { prisma } from "@core/db/prisma";
import { child } from "@core/logger/logger";
import { infoEmbed } from "@shared/embeds/factory";
import { truncate } from "@shared/utils/format";

const log = child("jobs:reminders");

const BATCH_SIZE = 100;

/**
 * Fire due reminders. Restart-safe: state lives in the DB and the worker
 * itself is idempotent (rows are marked `fired` before being deleted).
 *
 * Delivery order:
 *   1. Try the original channel (if recorded and still accessible).
 *   2. Otherwise DM the user.
 *   3. Mark fired in DB regardless of delivery success, so a broken
 *      channel can't spin-loop forever.
 */
export async function runReminders(client: Client): Promise<void> {
  const due = await prisma.reminder.findMany({
    where: { fired: false, remindAt: { lte: new Date() } },
    orderBy: { remindAt: "asc" },
    take: BATCH_SIZE,
  });
  if (!due.length) return;

  for (const r of due) {
    let delivered = false;
    const embed = infoEmbed(
      "⏰ Reminder",
      `${truncate(r.message, 1800)}\n\n*Set <t:${Math.floor(r.createdAt.getTime() / 1000)}:R>*`,
    );
    const mention = `<@${r.userId}>`;

    try {
      if (r.channelId) {
        const channel = await client.channels
          .fetch(r.channelId)
          .catch(() => null);
        if (channel && channel.isTextBased() && "send" in channel) {
          await (channel as unknown as SendableChannels).send({
            content: mention,
            embeds: [embed],
            allowedMentions: { users: [r.userId] },
          });
          delivered = true;
        }
      }
      if (!delivered) {
        const user = await client.users.fetch(r.userId).catch(() => null);
        if (user) {
          await user.send({ embeds: [embed] });
          delivered = true;
        }
      }
    } catch (err) {
      log.warn(
        {
          err: err instanceof Error ? err.message : err,
          reminderId: r.id,
          userId: r.userId,
        },
        "failed to deliver reminder",
      );
    } finally {
      // Mark fired regardless; we don't retry forever on dead channels.
      await prisma.reminder
        .update({
          where: { id: r.id },
          data: { fired: true },
        })
        .catch((err) =>
          log.error({ err, reminderId: r.id }, "failed to mark reminder fired"),
        );
    }
  }

  log.info({ count: due.length }, "reminders processed");
}
