import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { ownerEmbed, errorEmbed, successEmbed } from "@shared/embeds/factory";
import { Colors } from "@shared/embeds/colors";
import { ownerState } from "./owner.service";

const fakeban: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription:
      "Post a convincing-looking ban announcement WITHOUT actually banning anyone. Pure prank.",
    examples: ["/fakeban user:@u reason:spamming"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("fakeban")
    .setDescription("Owner (fun): simulate a ban announcement. No real ban happens.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  async execute(interaction) {
    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") ?? "violation of trust";
    const embed = new EmbedBuilder()
      .setColor(Colors.danger)
      .setTitle("🔨 User banned")
      .setDescription(`**${user.tag}** has been banned.\n**Reason:** ${reason}`)
      .setThumbnail(user.displayAvatarURL({ size: 128 }))
      .setFooter({ text: "Bans are permanent." });
    if (interaction.channel && "send" in interaction.channel && typeof interaction.channel.send === "function") {
      await (interaction.channel as TextChannel).send({ embeds: [embed] });
    }
    await interaction.reply({
      embeds: [ownerEmbed("Prank delivered", "No real ban occurred.")],
      flags: MessageFlags.Ephemeral,
    });
  },
};

const ghostPing: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Send a mention and immediately delete it.",
    examples: ["/ghost-ping user:@u"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("ghost-ping")
    .setDescription("Owner (fun): mention a user and delete the message instantly.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),
  async execute(interaction) {
    const user = interaction.options.getUser("user", true);
    if (!interaction.channel || !("send" in interaction.channel) || typeof interaction.channel.send !== "function") {
      await interaction.reply({
        embeds: [errorEmbed("Bad channel", "Cannot send messages here.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const sent = await (interaction.channel as TextChannel).send({
      content: `<@${user.id}>`,
      allowedMentions: { users: [user.id] },
    });
    await sent.delete().catch(() => null);
    await interaction.reply({
      embeds: [ownerEmbed("Ghosted", `Pinged ${user.tag} and deleted.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

const chaosMode: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription:
      "Toggle a per-guild 'chaos mode' flag in Redis. Other modules can read this flag to enable joke behaviour. Auto-expires after the TTL.",
    examples: ["/chaos-mode enabled:true minutes:30", "/chaos-mode enabled:false"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("chaos-mode")
    .setDescription("Owner: toggle chaos mode for this guild.")
    .addBooleanOption((o) => o.setName("enabled").setDescription("On / off").setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName("minutes")
        .setDescription("How long to stay on (default 30m)")
        .setMinValue(1)
        .setMaxValue(720),
    ),
  async execute(interaction) {
    if (!interaction.guild) return;
    const enabled = interaction.options.getBoolean("enabled", true);
    const mins = interaction.options.getInteger("minutes") ?? 30;
    if (enabled) {
      await ownerState.enableChaos(interaction.guild.id, mins * 60);
      await interaction.reply({
        embeds: [ownerEmbed("Chaos enabled", `Active for ${mins} minutes.`)],
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await ownerState.disableChaos(interaction.guild.id);
      await interaction.reply({
        embeds: [successEmbed("Chaos disabled")],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

const trollEmbed: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Post a fake 'verified bot announcement' style embed for entertainment.",
    examples: ["/troll-embed message:Server going down in 5 min."],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("troll-embed")
    .setDescription("Owner (fun): post a troll embed.")
    .addStringOption((o) => o.setName("message").setDescription("Body").setRequired(true)),
  async execute(interaction) {
    const body = interaction.options.getString("message", true);
    if (!interaction.channel || !("send" in interaction.channel) || typeof interaction.channel.send !== "function") {
      await interaction.reply({
        embeds: [errorEmbed("Bad channel", "Cannot send messages here.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(Colors.warning)
      .setTitle("⚠ Server announcement ⚠")
      .setDescription(body)
      .setFooter({ text: "Official notice · do not reply" });
    await (interaction.channel as TextChannel).send({ embeds: [embed] });
    await interaction.reply({
      embeds: [ownerEmbed("Posted")],
      flags: MessageFlags.Ephemeral,
    });
  },
};

const randomMemeReply: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription:
      "Toggle a per-guild flag that lets a listener insert a random meme reply to ~1% of messages. The actual listener checks this flag in Redis.",
    examples: ["/random-meme-reply enabled:true minutes:60", "/random-meme-reply enabled:false"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("random-meme-reply")
    .setDescription("Owner: toggle random meme replies for this guild.")
    .addBooleanOption((o) => o.setName("enabled").setDescription("On / off").setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName("minutes")
        .setDescription("How long to stay on (default 60m)")
        .setMinValue(1)
        .setMaxValue(720),
    ),
  async execute(interaction) {
    if (!interaction.guild) return;
    const enabled = interaction.options.getBoolean("enabled", true);
    const mins = interaction.options.getInteger("minutes") ?? 60;
    if (enabled) {
      await ownerState.enableMeme(interaction.guild.id, mins * 60);
      await interaction.reply({
        embeds: [ownerEmbed("Meme replies on", `Active for ${mins} minutes.`)],
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await ownerState.disableMeme(interaction.guild.id);
      await interaction.reply({
        embeds: [successEmbed("Meme replies off")],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

void ChannelType;

export const commands: SlashCommand[] = [fakeban, ghostPing, chaosMode, trollEmbed, randomMemeReply];
