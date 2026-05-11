import {
  Events,
  type Interaction,
  PermissionsBitField,
  MessageFlags,
} from "discord.js";
import { defineEvent } from "@core/handler/event";
import { registry } from "@core/handler/registry";
import { RateLimiter } from "@core/ratelimit/rate-limiter";
import { isOwner } from "@shared/utils/perms";
import { errorEmbed } from "@shared/embeds/factory";
import { UserFacingError } from "@core/errors/errors";
import { child } from "@core/logger/logger";

const log = child("interactions");

const commandCooldown = new RateLimiter("cmd", 5, 5); // 5 commands / 5s per user

async function handleInteraction(interaction: Interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = registry.commands.get(interaction.commandName);
      if (!cmd) return;

      if (cmd.ownerOnly && !isOwner(interaction.user.id)) {
        await interaction.reply({
          embeds: [errorEmbed("Forbidden", "Owner-only command.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (cmd.guildOnly && !interaction.inGuild()) {
        await interaction.reply({
          embeds: [errorEmbed("Guild only", "Use this in a server.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (cmd.permissions && interaction.inGuild()) {
        const member = interaction.member;
        const perms =
          typeof member?.permissions === "string"
            ? new PermissionsBitField(BigInt(member.permissions))
            : (member?.permissions as PermissionsBitField | undefined);
        if (!perms?.has(cmd.permissions)) {
          await interaction.reply({
            embeds: [errorEmbed("Missing permission")],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      const rl = await commandCooldown.hit(interaction.user.id);
      if (!rl.ok) {
        await interaction.reply({
          embeds: [errorEmbed("Slow down", "You are issuing commands too fast.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
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
      const msg =
        err instanceof UserFacingError ? err.message : "Something went wrong. Please try again.";
      const payload = { embeds: [errorEmbed("Error", msg)], flags: MessageFlags.Ephemeral } as const;
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
