import { MessageFlags } from "discord.js";
import type { SelectMenuHandler } from "@core/handler/command";
import { getGuildLocale } from "@core/i18n";
import { resolveViewer } from "./help-meta";
import { categoryPayload, HELP_CUSTOM_IDS } from "./help.commands";

export const select: SelectMenuHandler = {
  customId: HELP_CUSTOM_IDS.SELECT,
  async execute(interaction) {
    if (!interaction.isStringSelectMenu()) return;
    const locale = await getGuildLocale(interaction.guildId);
    const viewer = resolveViewer(interaction.user.id);
    const choice = interaction.values[0];
    if (!choice) {
      await interaction.deferUpdate().catch(() => null);
      return;
    }
    const payload = categoryPayload(locale, viewer.isOwner, choice);
    // Re-render in place. Strip `flags` since editReply doesn't accept them.
    const { flags: _flags, ...rest } = payload as { flags?: typeof MessageFlags.Ephemeral } & Record<string, unknown>;
    void _flags;
    await interaction.update(rest);
  },
};
