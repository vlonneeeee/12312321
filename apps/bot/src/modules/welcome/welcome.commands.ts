import {
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { errorEmbed, infoEmbed, successEmbed } from "@shared/embeds/factory";
import { t } from "@core/i18n";
import { UserFacingError } from "@core/errors/errors";
import {
  buildMemberEventMessage,
  GOODBYE_DEFAULT_COLOR,
  parseWelcomeEmbed,
  WELCOME_DEFAULT_COLOR,
  type WelcomeEmbedPayload,
} from "./welcome.service";

type Kind = "welcome" | "goodbye";

interface Cfg {
  channelId: string | null;
  message: string | null;
  embed: WelcomeEmbedPayload | null;
}

async function loadCfg(guildId: string, kind: Kind): Promise<Cfg> {
  const g = await prisma.guild.findUnique({
    where: { id: guildId },
    select: {
      welcomeChannelId: true,
      welcomeMessage: true,
      welcomeEmbed: true,
      goodbyeChannelId: true,
      goodbyeMessage: true,
      goodbyeEmbed: true,
    },
  });
  if (kind === "welcome") {
    return {
      channelId: g?.welcomeChannelId ?? null,
      message: g?.welcomeMessage ?? null,
      embed: parseWelcomeEmbed(g?.welcomeEmbed ?? null),
    };
  }
  return {
    channelId: g?.goodbyeChannelId ?? null,
    message: g?.goodbyeMessage ?? null,
    embed: parseWelcomeEmbed(g?.goodbyeEmbed ?? null),
  };
}

async function handleErr(
  interaction: ChatInputCommandInteraction,
  fn: () => Promise<void>,
) {
  try {
    await fn();
  } catch (err) {
    const title = await t(interaction.guildId, "welcome.title");
    const fallback = await t(
      interaction.guildId,
      "common.something_went_wrong",
    );
    const msg = err instanceof UserFacingError ? err.message : fallback;
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ embeds: [errorEmbed(title, msg)] });
    } else {
      await interaction.reply({
        embeds: [errorEmbed(title, msg)],
        ephemeral: true,
      });
    }
  }
}

function build(kind: Kind): SlashCommand {
  const name = kind;
  const description =
    kind === "welcome"
      ? "Configure the welcome message for new members."
      : "Configure the goodbye message for leaving members.";
  return {
    category: "general",
    guildOnly: true,
    permissions: [PermissionsBitField.Flags.ManageGuild],
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .addSubcommand((sc) =>
        sc
          .setName("set")
          .setDescription("Set channel + message")
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("Channel for the message")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true),
          )
          .addStringOption((o) =>
            o
              .setName("message")
              .setDescription(
                "Text. Placeholders: {user}, {server}, {count}, {user.name}, {user.tag}",
              )
              .setRequired(false),
          )
          .addStringOption((o) =>
            o
              .setName("title")
              .setDescription("Optional embed title")
              .setRequired(false),
          )
          .addStringOption((o) =>
            o
              .setName("description")
              .setDescription("Optional embed description")
              .setRequired(false),
          )
          .addStringOption((o) =>
            o
              .setName("image")
              .setDescription("Image / banner URL")
              .setRequired(false),
          )
          .addStringOption((o) =>
            o
              .setName("color")
              .setDescription("Hex color (e.g. #5865F2)")
              .setRequired(false),
          ),
      )
      .addSubcommand((sc) =>
        sc.setName("preview").setDescription("Preview the current message"),
      )
      .addSubcommand((sc) =>
        sc.setName("disable").setDescription("Disable and clear the message"),
      )
      .addSubcommand((sc) =>
        sc.setName("show").setDescription("Show current configuration"),
      ),
    async execute(interaction) {
      const guildId = interaction.guildId!;
      const sub = interaction.options.getSubcommand();

      await handleErr(interaction, async () => {
        if (sub === "set") {
          const channel = interaction.options.getChannel("channel", true);
          const text = interaction.options.getString("message", false);
          const title = interaction.options.getString("title", false);
          const desc = interaction.options.getString("description", false);
          const image = interaction.options.getString("image", false);
          const color = interaction.options.getString("color", false);
          if (!text && !title && !desc && !image) {
            throw new UserFacingError(
              await t(guildId, "welcome.need_content"),
            );
          }
          const embed: WelcomeEmbedPayload | null =
            title || desc || image || color
              ? { title, description: desc, image, color }
              : null;
          // Prisma's Json input type rejects strict interfaces; cast through
          // InputJsonValue. `null` here means "explicitly clear the column".
          const embedJson = (embed ?? null) as unknown as
            | import("@prisma/client").Prisma.InputJsonValue
            | null;
          if (kind === "welcome") {
            await prisma.guild.update({
              where: { id: guildId },
              data: {
                welcomeChannelId: channel.id,
                welcomeMessage: text ?? null,
                welcomeEmbed: embedJson ?? undefined,
              },
            });
          } else {
            await prisma.guild.update({
              where: { id: guildId },
              data: {
                goodbyeChannelId: channel.id,
                goodbyeMessage: text ?? null,
                goodbyeEmbed: embedJson ?? undefined,
              },
            });
          }
          await interaction.reply({
            embeds: [
              successEmbed(
                await t(guildId, `${kind}.title`),
                await t(guildId, `${kind}.set_done`, {
                  channelId: channel.id,
                }),
              ),
            ],
            ephemeral: true,
          });
          return;
        }

        if (sub === "preview") {
          const cfg = await loadCfg(guildId, kind);
          if (!cfg.channelId || (!cfg.message && !cfg.embed)) {
            throw new UserFacingError(await t(guildId, `${kind}.not_set`));
          }
          const payload = buildMemberEventMessage({
            guild: interaction.guild!,
            member: interaction.member as GuildMember,
            text: cfg.message,
            embed: cfg.embed,
            fallbackColor:
              kind === "welcome"
                ? WELCOME_DEFAULT_COLOR
                : GOODBYE_DEFAULT_COLOR,
          });
          await interaction.reply({
            content: payload.content || undefined,
            embeds: payload.embeds,
            ephemeral: true,
          });
          return;
        }

        if (sub === "disable") {
          if (kind === "welcome") {
            await prisma.guild.update({
              where: { id: guildId },
              data: {
                welcomeChannelId: null,
                welcomeMessage: null,
                welcomeEmbed: undefined,
              },
            });
          } else {
            await prisma.guild.update({
              where: { id: guildId },
              data: {
                goodbyeChannelId: null,
                goodbyeMessage: null,
                goodbyeEmbed: undefined,
              },
            });
          }
          await interaction.reply({
            embeds: [
              successEmbed(
                await t(guildId, `${kind}.title`),
                await t(guildId, `${kind}.disabled`),
              ),
            ],
            ephemeral: true,
          });
          return;
        }

        if (sub === "show") {
          const cfg = await loadCfg(guildId, kind);
          const lines = [
            `**${await t(guildId, "welcome.field_channel")}:** ${cfg.channelId ? `<#${cfg.channelId}>` : "—"}`,
            `**${await t(guildId, "welcome.field_text")}:** ${cfg.message ? "```\n" + cfg.message + "\n```" : "—"}`,
            `**${await t(guildId, "welcome.field_embed")}:** ${cfg.embed ? "✓" : "—"}`,
          ];
          await interaction.reply({
            embeds: [
              infoEmbed(await t(guildId, `${kind}.title`), lines.join("\n")),
            ],
            ephemeral: true,
          });
          return;
        }
      });
    },
  };
}

const welcome = build("welcome");
const goodbye = build("goodbye");

// ---------- /autorole ----------

const autorole: SlashCommand = {
  category: "general",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageGuild],
  data: new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Manage roles granted to new members automatically.")
    .addSubcommand((sc) =>
      sc
        .setName("add")
        .setDescription("Add an autorole")
        .addRoleOption((o) =>
          o.setName("role").setDescription("Role").setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("remove")
        .setDescription("Remove an autorole")
        .addRoleOption((o) =>
          o.setName("role").setDescription("Role").setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc.setName("list").setDescription("List autoroles"),
    )
    .addSubcommand((sc) =>
      sc.setName("clear").setDescription("Clear all autoroles"),
    ),
  async execute(interaction) {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();
    await handleErr(interaction, async () => {
      const cur = await prisma.guild.findUnique({
        where: { id: guildId },
        select: { autoRoleIds: true },
      });
      const list = cur?.autoRoleIds ?? [];

      if (sub === "add") {
        const role = interaction.options.getRole("role", true);
        if (list.includes(role.id)) {
          throw new UserFacingError(
            await t(guildId, "autorole.already_present"),
          );
        }
        const next = [...list, role.id];
        await prisma.guild.update({
          where: { id: guildId },
          data: { autoRoleIds: next },
        });
        await interaction.reply({
          embeds: [
            successEmbed(
              await t(guildId, "autorole.title"),
              await t(guildId, "autorole.added", { roleId: role.id }),
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      if (sub === "remove") {
        const role = interaction.options.getRole("role", true);
        const next = list.filter((id) => id !== role.id);
        await prisma.guild.update({
          where: { id: guildId },
          data: { autoRoleIds: next },
        });
        await interaction.reply({
          embeds: [
            successEmbed(
              await t(guildId, "autorole.title"),
              await t(guildId, "autorole.removed", { roleId: role.id }),
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      if (sub === "list") {
        const body = list.length
          ? list.map((id) => `<@&${id}>`).join("\n")
          : await t(guildId, "autorole.empty");
        await interaction.reply({
          embeds: [infoEmbed(await t(guildId, "autorole.title"), body)],
          ephemeral: true,
        });
        return;
      }
      if (sub === "clear") {
        await prisma.guild.update({
          where: { id: guildId },
          data: { autoRoleIds: [] },
        });
        await interaction.reply({
          embeds: [
            successEmbed(
              await t(guildId, "autorole.title"),
              await t(guildId, "autorole.cleared"),
            ),
          ],
          ephemeral: true,
        });
        return;
      }
    });
  },
};

export const commands = [welcome, goodbye, autorole];
