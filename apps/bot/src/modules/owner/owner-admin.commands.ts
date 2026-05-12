import {
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildBasedChannel,
  GuildMember,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
  TextChannel,
  VoiceBasedChannel,
} from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { ownerEmbed, errorEmbed, successEmbed, infoEmbed } from "@shared/embeds/factory";
import { parseDuration } from "@shared/utils/duration";
import { child } from "@core/logger/logger";
import { ownerState } from "./owner.service";
import { Colors } from "@shared/embeds/colors";

const log = child("owner.admin");

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

async function requireGuildAndMember(
  interaction: ChatInputCommandInteraction,
  userOptionName = "user",
): Promise<GuildMember | null> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      embeds: [errorEmbed("Guild only", "Run this command inside a server.")],
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  const user = interaction.options.getUser(userOptionName, true);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    await interaction.reply({
      embeds: [errorEmbed("Target missing", `<@${user.id}> is not in this server.`)],
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  return member;
}

async function safeReplyError(
  interaction: ChatInputCommandInteraction,
  err: unknown,
  scope: string,
): Promise<void> {
  log.error({ err, scope }, "owner admin command failed");
  const msg = err instanceof Error ? err.message : String(err);
  const payload = {
    embeds: [errorEmbed("Operation failed", msg)],
    flags: MessageFlags.Ephemeral,
  } as const;
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => null);
  } else {
    await interaction.reply(payload).catch(() => null);
  }
}

/* -------------------------------------------------------------------------- */
/*  Commands                                                                  */
/* -------------------------------------------------------------------------- */

const forceban: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription:
      "Bypasses Discord permissions and bans the target user using the bot's own permissions, even if you don't have Ban Members in this guild.",
    examples: ["/forceban user:@spammer reason:raid", "/forceban user_id:1234 reason:retro"],
    permissionsLabel: "OWNER (bot bans on your behalf)",
  },
  data: new SlashCommandBuilder()
    .setName("forceban")
    .setDescription("Owner: ban any user by mention or raw id.")
    .addUserOption((o) => o.setName("user").setDescription("Member to ban (optional if user_id given)"))
    .addStringOption((o) => o.setName("user_id").setDescription("Raw snowflake when user not in guild"))
    .addStringOption((o) => o.setName("reason").setDescription("Audit-log reason"))
    .addIntegerOption((o) =>
      o
        .setName("delete_seconds")
        .setDescription("Delete recent messages within N seconds (0..604800)")
        .setMinValue(0)
        .setMaxValue(604800),
    ),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      const user = interaction.options.getUser("user");
      const id = interaction.options.getString("user_id") || user?.id;
      if (!id) {
        await interaction.reply({
          embeds: [errorEmbed("Need a target", "Pass either `user` or `user_id`.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const reason = interaction.options.getString("reason") ?? "OWNER /forceban";
      const seconds = interaction.options.getInteger("delete_seconds") ?? 0;
      await interaction.guild.bans.create(id, {
        reason: `${reason} · by owner ${interaction.user.tag}`,
        deleteMessageSeconds: seconds,
      });
      await interaction.reply({
        embeds: [ownerEmbed("Force-banned", `<@${id}> · reason: ${reason}`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await safeReplyError(interaction, err, "forceban");
    }
  },
};

const forcekick: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Kicks any member regardless of your Discord permissions.",
    examples: ["/forcekick user:@user reason:cleanup"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("forcekick")
    .setDescription("Owner: kick any member.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Audit-log reason")),
  async execute(interaction) {
    try {
      const target = await requireGuildAndMember(interaction);
      if (!target) return;
      const reason = interaction.options.getString("reason") ?? "OWNER /forcekick";
      await target.kick(`${reason} · by owner ${interaction.user.tag}`);
      await interaction.reply({
        embeds: [ownerEmbed("Force-kicked", `${target.user.tag} · ${reason}`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await safeReplyError(interaction, err, "forcekick");
    }
  },
};

const forceRoleAdd: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Add a role to a member ignoring Discord permission checks.",
    examples: ["/force-role-add user:@user role:@VIP"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("force-role-add")
    .setDescription("Owner: add a role to a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
  async execute(interaction) {
    try {
      const target = await requireGuildAndMember(interaction);
      if (!target) return;
      const role = interaction.options.getRole("role", true);
      await target.roles.add(role.id, `OWNER /force-role-add by ${interaction.user.tag}`);
      await interaction.reply({
        embeds: [ownerEmbed("Role added", `${role.name} → ${target.user.tag}`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await safeReplyError(interaction, err, "force-role-add");
    }
  },
};

const forceRoleRemove: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Remove a role from a member ignoring Discord permission checks.",
    examples: ["/force-role-remove user:@user role:@VIP"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("force-role-remove")
    .setDescription("Owner: remove a role from a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
  async execute(interaction) {
    try {
      const target = await requireGuildAndMember(interaction);
      if (!target) return;
      const role = interaction.options.getRole("role", true);
      await target.roles.remove(role.id, `OWNER /force-role-remove by ${interaction.user.tag}`);
      await interaction.reply({
        embeds: [ownerEmbed("Role removed", `${role.name} ← ${target.user.tag}`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await safeReplyError(interaction, err, "force-role-remove");
    }
  },
};

const forceNick: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Forcefully set or reset a member's nickname.",
    examples: ["/force-nick user:@user nickname:Спамер", "/force-nick user:@user"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("force-nick")
    .setDescription("Owner: set or reset a member's nickname.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("nickname")
        .setDescription("New nickname (empty to reset)")
        .setMaxLength(32),
    ),
  async execute(interaction) {
    try {
      const target = await requireGuildAndMember(interaction);
      if (!target) return;
      const nick = interaction.options.getString("nickname") ?? null;
      await target.setNickname(nick, `OWNER /force-nick by ${interaction.user.tag}`);
      await interaction.reply({
        embeds: [ownerEmbed("Nickname set", `${target.user.tag} → ${nick ?? "(reset)"}`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await safeReplyError(interaction, err, "force-nick");
    }
  },
};

const forceTimeout: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Apply a Discord timeout to a member. Accepts duration strings like 30m, 2h, 1d.",
    examples: ["/force-timeout user:@user duration:30m", "/force-timeout user:@user duration:2d reason:raid"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("force-timeout")
    .setDescription("Owner: timeout a member.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("duration")
        .setDescription("e.g. 30m, 2h, 1d (max 28d)")
        .setRequired(true),
    )
    .addStringOption((o) => o.setName("reason").setDescription("Audit-log reason")),
  async execute(interaction) {
    try {
      const target = await requireGuildAndMember(interaction);
      if (!target) return;
      const raw = interaction.options.getString("duration", true);
      const ms = parseDuration(raw);
      if (!ms || ms > 28 * 24 * 60 * 60 * 1000) {
        await interaction.reply({
          embeds: [errorEmbed("Bad duration", "Use formats like 30m, 2h, 1d (max 28d).")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const reason = interaction.options.getString("reason") ?? "OWNER /force-timeout";
      await target.timeout(ms, `${reason} · by owner ${interaction.user.tag}`);
      await interaction.reply({
        embeds: [ownerEmbed("Timed out", `${target.user.tag} · ${raw}`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await safeReplyError(interaction, err, "force-timeout");
    }
  },
};

const forceUntimeout: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Clear a member's active timeout.",
    examples: ["/force-untimeout user:@user"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("force-untimeout")
    .setDescription("Owner: remove a member's timeout.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true)),
  async execute(interaction) {
    try {
      const target = await requireGuildAndMember(interaction);
      if (!target) return;
      await target.timeout(null, `OWNER /force-untimeout by ${interaction.user.tag}`);
      await interaction.reply({
        embeds: [ownerEmbed("Timeout cleared", target.user.tag)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await safeReplyError(interaction, err, "force-untimeout");
    }
  },
};

const forceMoveVoice: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Move a member to a voice channel, or disconnect them.",
    examples: [
      "/force-move-voice user:@user channel:#general-voice",
      "/force-move-voice user:@user disconnect:true",
    ],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("force-move-voice")
    .setDescription("Owner: move/disconnect a member from voice.")
    .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Target voice channel")
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
    )
    .addBooleanOption((o) => o.setName("disconnect").setDescription("Disconnect instead of moving")),
  async execute(interaction) {
    try {
      const target = await requireGuildAndMember(interaction);
      if (!target) return;
      const disconnect = interaction.options.getBoolean("disconnect") ?? false;
      const channel = interaction.options.getChannel("channel") as VoiceBasedChannel | null;
      if (!target.voice.channelId) {
        await interaction.reply({
          embeds: [errorEmbed("Not in voice", "Target is not connected to a voice channel.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (disconnect) {
        await target.voice.disconnect(`OWNER by ${interaction.user.tag}`);
        await interaction.reply({
          embeds: [ownerEmbed("Disconnected", `${target.user.tag}`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!channel) {
        await interaction.reply({
          embeds: [errorEmbed("No channel", "Pass `channel` or `disconnect:true`.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await target.voice.setChannel(channel, `OWNER /force-move-voice by ${interaction.user.tag}`);
      await interaction.reply({
        embeds: [ownerEmbed("Voice moved", `${target.user.tag} → <#${channel.id}>`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await safeReplyError(interaction, err, "force-move-voice");
    }
  },
};

const purgeAdvanced: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription:
      "Bulk-delete up to 100 messages with optional filters: only from a user, only containing text, only bots/humans.",
    examples: [
      "/purge-advanced count:50 user:@spammer",
      "/purge-advanced count:30 contains:scam",
      "/purge-advanced count:20 only:bots",
    ],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("purge-advanced")
    .setDescription("Owner: advanced bulk message deletion.")
    .addIntegerOption((o) =>
      o
        .setName("count")
        .setDescription("How many messages to scan")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    )
    .addUserOption((o) => o.setName("user").setDescription("Only this user"))
    .addStringOption((o) => o.setName("contains").setDescription("Only messages containing substring"))
    .addStringOption((o) =>
      o
        .setName("only")
        .setDescription("Filter mode")
        .addChoices(
          { name: "bots", value: "bots" },
          { name: "humans", value: "humans" },
          { name: "with attachments", value: "attachments" },
          { name: "with embeds", value: "embeds" },
        ),
    ),
  async execute(interaction) {
    try {
      if (!interaction.channel || !("messages" in interaction.channel)) {
        await interaction.reply({
          embeds: [errorEmbed("Bad channel", "Run inside a text channel.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const count = interaction.options.getInteger("count", true);
      const user = interaction.options.getUser("user");
      const contains = interaction.options.getString("contains")?.toLowerCase();
      const only = interaction.options.getString("only");
      const fetched = await interaction.channel.messages.fetch({ limit: count });
      const filtered = fetched.filter((m) => {
        if (user && m.author.id !== user.id) return false;
        if (contains && !m.content.toLowerCase().includes(contains)) return false;
        if (only === "bots" && !m.author.bot) return false;
        if (only === "humans" && m.author.bot) return false;
        if (only === "attachments" && m.attachments.size === 0) return false;
        if (only === "embeds" && m.embeds.length === 0) return false;
        if (Date.now() - m.createdTimestamp > 14 * 24 * 60 * 60 * 1000) return false;
        return true;
      });
      if (filtered.size === 0) {
        await interaction.reply({
          embeds: [infoEmbed("Nothing matched")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const channel = interaction.channel as TextChannel;
      const deleted = await channel.bulkDelete(filtered, true);
      await interaction.reply({
        embeds: [ownerEmbed("Purged", `Deleted ${deleted.size} messages.`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await safeReplyError(interaction, err, "purge-advanced");
    }
  },
};

const say: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Make the bot post a plain message in this or another channel.",
    examples: ["/say text:hello", "/say text:hello channel:#announcements"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("say")
    .setDescription("Owner: make the bot post a plain message.")
    .addStringOption((o) => o.setName("text").setDescription("Message").setRequired(true))
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Target channel")
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
        ),
    ),
  async execute(interaction) {
    try {
      const text = interaction.options.getString("text", true);
      const channel = (interaction.options.getChannel("channel") as GuildBasedChannel | null) ??
        (interaction.channel as GuildBasedChannel | null);
      if (!channel || !("send" in channel) || typeof channel.send !== "function") {
        await interaction.reply({
          embeds: [errorEmbed("Bad channel", "Target channel does not accept messages.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await (channel as TextChannel).send({ content: text });
      await interaction.reply({
        embeds: [ownerEmbed("Sent", `→ <#${channel.id}>`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await safeReplyError(interaction, err, "say");
    }
  },
};

const embed: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Post a clean embed using the bot identity.",
    examples: [
      "/embed title:Update body:New rules in #rules",
      "/embed title:Notice body:read pinned color:warning",
    ],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Owner: post a structured embed.")
    .addStringOption((o) => o.setName("title").setDescription("Title").setRequired(true))
    .addStringOption((o) => o.setName("body").setDescription("Description").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("color")
        .setDescription("Accent color")
        .addChoices(
          { name: "primary", value: "primary" },
          { name: "success", value: "success" },
          { name: "warning", value: "warning" },
          { name: "danger", value: "danger" },
          { name: "premium", value: "premium" },
        ),
    )
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Target channel")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),
  async execute(interaction) {
    try {
      const title = interaction.options.getString("title", true);
      const body = interaction.options.getString("body", true);
      const colorKey = (interaction.options.getString("color") ?? "primary") as keyof typeof Colors;
      const channel = (interaction.options.getChannel("channel") as GuildBasedChannel | null) ??
        (interaction.channel as GuildBasedChannel | null);
      if (!channel || !("send" in channel)) {
        await interaction.reply({
          embeds: [errorEmbed("Bad channel", "Target channel does not accept messages.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const built = new EmbedBuilder()
        .setColor(Colors[colorKey] ?? Colors.primary)
        .setTitle(title)
        .setDescription(body);
      await (channel as TextChannel).send({ embeds: [built] });
      await interaction.reply({
        embeds: [ownerEmbed("Embed sent", `→ <#${channel.id}>`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await safeReplyError(interaction, err, "embed");
    }
  },
};

const serverLockdown: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription:
      "Deny SendMessages from @everyone on every text channel and remember the prior state so /server-unlock can restore it.",
    examples: ["/server-lockdown reason:raid"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("server-lockdown")
    .setDescription("Owner: deny @everyone SendMessages on every text channel.")
    .addStringOption((o) => o.setName("reason").setDescription("Audit-log reason")),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reason = interaction.options.getString("reason") ?? "OWNER /server-lockdown";
      const everyoneId = interaction.guild.roles.everyone.id;
      const prior: { id: string; allow: string; deny: string }[] = [];
      let locked = 0;
      for (const channel of interaction.guild.channels.cache.values()) {
        if (
          channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement
        ) {
          continue;
        }
        const overwrite = channel.permissionOverwrites.cache.get(everyoneId);
        prior.push({
          id: channel.id,
          allow: overwrite?.allow.bitfield.toString() ?? "0",
          deny: overwrite?.deny.bitfield.toString() ?? "0",
        });
        await channel.permissionOverwrites
          .edit(
            everyoneId,
            {
              SendMessages: false,
              SendMessagesInThreads: false,
              CreatePublicThreads: false,
              CreatePrivateThreads: false,
              AddReactions: false,
            },
            { reason: `${reason} · by owner ${interaction.user.tag}` },
          )
          .catch((err: unknown) => log.warn({ err, channelId: channel.id }, "lockdown overwrite failed"));
        locked += 1;
      }
      await ownerState.markLockdown(interaction.guild.id, JSON.stringify(prior));
      await interaction.editReply({
        embeds: [ownerEmbed("Locked down", `Channels affected: **${locked}**`)],
      });
    } catch (err) {
      await safeReplyError(interaction, err, "server-lockdown");
    }
  },
};

const serverUnlock: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Restore channel permissions saved by /server-lockdown.",
    examples: ["/server-unlock"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("server-unlock")
    .setDescription("Owner: restore prior @everyone overwrites set by /server-lockdown."),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const raw = await ownerState.readLockdown(interaction.guild.id);
      if (!raw) {
        await interaction.editReply({
          embeds: [errorEmbed("Nothing to restore", "No saved lockdown snapshot for this guild.")],
        });
        return;
      }
      const prior = JSON.parse(raw) as { id: string; allow: string; deny: string }[];
      const everyoneId = interaction.guild.roles.everyone.id;
      let restored = 0;
      for (const entry of prior) {
        const channel = interaction.guild.channels.cache.get(entry.id);
        if (!channel || !("permissionOverwrites" in channel)) continue;
        const allowBF = new PermissionsBitField(BigInt(entry.allow));
        const denyBF = new PermissionsBitField(BigInt(entry.deny));
        const hadOverwrite = allowBF.bitfield !== 0n || denyBF.bitfield !== 0n;
        if (!hadOverwrite) {
          await channel.permissionOverwrites
            .delete(everyoneId, `OWNER /server-unlock by ${interaction.user.tag}`)
            .catch(() => null);
        } else {
          await channel.permissionOverwrites
            .edit(
              everyoneId,
              {
                SendMessages: allowBF.has(PermissionsBitField.Flags.SendMessages)
                  ? true
                  : denyBF.has(PermissionsBitField.Flags.SendMessages)
                    ? false
                    : null,
                SendMessagesInThreads: allowBF.has(PermissionsBitField.Flags.SendMessagesInThreads)
                  ? true
                  : denyBF.has(PermissionsBitField.Flags.SendMessagesInThreads)
                    ? false
                    : null,
                CreatePublicThreads: allowBF.has(PermissionsBitField.Flags.CreatePublicThreads)
                  ? true
                  : denyBF.has(PermissionsBitField.Flags.CreatePublicThreads)
                    ? false
                    : null,
                CreatePrivateThreads: allowBF.has(PermissionsBitField.Flags.CreatePrivateThreads)
                  ? true
                  : denyBF.has(PermissionsBitField.Flags.CreatePrivateThreads)
                    ? false
                    : null,
                AddReactions: allowBF.has(PermissionsBitField.Flags.AddReactions)
                  ? true
                  : denyBF.has(PermissionsBitField.Flags.AddReactions)
                    ? false
                    : null,
              },
              { reason: `OWNER /server-unlock by ${interaction.user.tag}` },
            )
            .catch((err: unknown) => log.warn({ err, channelId: entry.id }, "unlock overwrite failed"));
        }
        restored += 1;
      }
      await ownerState.clearLockdown(interaction.guild.id);
      await interaction.editReply({
        embeds: [successEmbed("Server unlocked", `Channels restored: **${restored}**`)],
      });
    } catch (err) {
      await safeReplyError(interaction, err, "server-unlock");
    }
  },
};

export const commands: SlashCommand[] = [
  forceban,
  forcekick,
  forceRoleAdd,
  forceRoleRemove,
  forceNick,
  forceTimeout,
  forceUntimeout,
  forceMoveVoice,
  purgeAdvanced,
  say,
  embed,
  serverLockdown,
  serverUnlock,
];
