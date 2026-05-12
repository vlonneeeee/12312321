import type { ButtonHandler } from "@core/handler/command";
import { getGuildLocale } from "@core/i18n";
import { resolveViewer, OWNER_CATEGORY } from "./help-meta";
import { categoryPayload, overviewPayload, HELP_CUSTOM_IDS } from "./help.commands";
import { isOwner } from "@shared/utils/perms";

const home: ButtonHandler = {
  customId: HELP_CUSTOM_IDS.HOME,
  async execute(interaction) {
    const locale = await getGuildLocale(interaction.guildId);
    const viewer = resolveViewer(interaction.user.id);
    const payload = overviewPayload(locale, viewer.isOwner);
    const { flags: _f, ...rest } = payload as { flags?: number } & Record<string, unknown>;
    void _f;
    await interaction.update(rest);
  },
};

const owner: ButtonHandler = {
  customId: HELP_CUSTOM_IDS.OWNER_TOGGLE,
  async execute(interaction) {
    if (!isOwner(interaction.user.id)) {
      await interaction.deferUpdate().catch(() => null);
      return;
    }
    const locale = await getGuildLocale(interaction.guildId);
    const payload = categoryPayload(locale, true, OWNER_CATEGORY);
    const { flags: _f, ...rest } = payload as { flags?: number } & Record<string, unknown>;
    void _f;
    await interaction.update(rest);
  },
};

export const buttons = [home, owner];
