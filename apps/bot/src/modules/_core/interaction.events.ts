import {
  Events,
  type Interaction,
  PermissionsBitField,
  MessageFlags,
} from "discord.js";
import { defineEvent } from "@core/handler/event";
import { registry } from "@core/handler/registry";
import { RateLimiter } from "@core/ratelimit/rate-limiter";
import { canBypassPermissions, isOwner } from "@shared/utils/perms";
import { errorEmbed } from "@shared/embeds/factory";
import { UserFacingError } from "@core/errors/errors";
import { child } from "@core/logger/logger";
import { t } from "@core/i18n";

const log = child("interactions");

// Global per-user soft rate limit. OWNERS bypass.
const commandCooldown = new RateLimiter("cmd", 5, 5);
// Optional per-command cooldown bucket. OWNERS bypass.
const perCommandCooldowns = new Map<string, RateLimiter>();

function getPerCommandLimiter(name: string, seconds: number): RateLimiter {
  const key = `${name}:${seconds}`;
  let lim = perCommandCooldowns.get(key);
  if (!lim) {
    lim = new RateLimiter(`cmd:${name}`, 1, seconds);
    perCommandCooldowns.set(key, lim);
  }
  return lim;
}

async function handleInteraction(interaction: Interaction) {
  const meta = {
    type: interaction.type,
    name:
      (interaction as { commandName?: string; customId?: string }).commandName ??
      (interaction as { commandName?: string; customId?: string }).customId,
    user: interaction.user.id,
  };
  log.info(meta, "interaction received");
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = registry.commands.get(interaction.commandName);
      if (!cmd) return;

      const gid = interaction.guildId;
      const userId = interaction.user.id;
      const bypass = canBypassPermissions(userId);

      // OWNER-only commands stay strict: a non-owner can never invoke them.
      if (cmd.ownerOnly && !isOwner(userId)) {
        await interaction.reply({
          embeds: [
            errorEmbed(
              await t(gid, "interaction.forbidden_title"),
              await t(gid, "interaction.owner_only"),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // guildOnly is enforced for everyone вЂ” Discord rejects guild-scoped
      // operations from DMs even if the caller is OWNER, so we keep this.
      if (cmd.guildOnly && !interaction.inGuild()) {
        await interaction.reply({
          embeds: [
            errorEmbed(
              await t(gid, "interaction.guild_only_title"),
              await t(gid, "common.guild_only"),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Standard Discord permission gate. OWNERS bypass.
      if (cmd.permissions && interaction.inGuild() && !bypass) {
        const member = interaction.member;
        const perms =
          typeof member?.permissions === "string"
            ? new PermissionsBitField(BigInt(member.permissions))
            : (member?.permissions as PermissionsBitField | undefined);
        if (!perms?.has(cmd.permissions)) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                await t(gid, "interaction.missing_permission_title"),
                await t(gid, "common.no_permission"),
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      // Global anti-spam cooldown. OWNERS bypass.
      if (!bypass) {
        const rl = await commandCooldown.hit(userId);
        if (!rl.ok) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                await t(gid, "interaction.slow_down_title"),
                await t(gid, "interaction.slow_down_body"),
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      // Per-command cooldown. OWNERS bypass.
      if (!bypass && cmd.cooldownSec && cmd.cooldownSec > 0) {
        const lim = getPerCommandLimiter(cmd.data.name, cmd.cooldownSec);
        const rl = await lim.hit(userId);
        if (!rl.ok) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                await t(gid, "interaction.slow_down_title"),
                await t(gid, "interaction.slow_down_body"),
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      await cmd.execute(interaction);
    } else if (interaction.isButton()) {
      const match = registry.findButton(interaction.customId);
      if (!match) return;
      await match.handler.execute(interaction, match.params);
    } else if (interaction.isAnySelectMenu()) {
      const match = registry.findSelect(interaction.customId);
      if (!match) return;
      await match.handler.execute(interaction, match.params);
    } else if (interaction.isModalSubmit()) {
      const match = registry.findModal(interaction.customId);
      if (!match) return;
      await match.handler.execute(interaction, match.params);
    } else if (interaction.isAutocomplete()) {
      const cmd = registry.commands.get(interaction.commandName);
      if (cmd?.autocomplete) await cmd.autocomplete(interaction);
    }
  } catch (err) {
    log.error({ err, type: interaction.type }, "interaction handler error");
    if (interaction.isRepliable()) {
      const gid = interaction.guildId;
      const fallback = await t(gid, "common.something_went_wrong");
      const msg = err instanceof UserFacingError ? err.message : fallback;
      const title = await t(gid, "interaction.error_title");
      const payload = {
        embeds: [errorEmbed(title, msg)],
        flags: MessageFlags.Ephemeral,
      } as const;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }
  }
}

const event = defineEvent({
  name: Events.InteractionCreate,
  async execute(interaction) {
    await handleInteraction(interaction);
  },
});

export { event };
