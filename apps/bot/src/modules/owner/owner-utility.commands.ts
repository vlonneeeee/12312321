import {
  ChannelType,
  ChatInputCommandInteraction,
  Collection,
  ColorResolvable,
  GuildChannel,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
  type OverwriteResolvable,
} from "discord.js";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SlashCommand } from "@core/handler/command";
import { ownerEmbed, errorEmbed, successEmbed, infoEmbed } from "@shared/embeds/factory";
import { child } from "@core/logger/logger";

const log = child("owner.utility");

const BACKUP_DIR = path.resolve(process.cwd(), "backups", "guilds");

/* -------------------------------------------------------------------------- */
/*  Role management                                                           */
/* -------------------------------------------------------------------------- */

const createRole: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Create a role.",
    examples: ["/create-role name:VIP", "/create-role name:Mute color:#777777 hoist:false"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("create-role")
    .setDescription("Owner: create a role.")
    .addStringOption((o) => o.setName("name").setDescription("Role name").setRequired(true))
    .addStringOption((o) => o.setName("color").setDescription("Hex color, e.g. #ff8800"))
    .addBooleanOption((o) => o.setName("hoist").setDescription("Display separately in sidebar"))
    .addBooleanOption((o) => o.setName("mentionable").setDescription("Allow mentioning")),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      const name = interaction.options.getString("name", true);
      const color = interaction.options.getString("color") ?? undefined;
      const role = await interaction.guild.roles.create({
        name,
        color: color as ColorResolvable | undefined,
        hoist: interaction.options.getBoolean("hoist") ?? false,
        mentionable: interaction.options.getBoolean("mentionable") ?? false,
        reason: `OWNER /create-role by ${interaction.user.tag}`,
      });
      await interaction.reply({
        embeds: [ownerEmbed("Role created", `<@&${role.id}> · id=${role.id}`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await replyErr(interaction, err, "create-role");
    }
  },
};

const deleteRole: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Delete a role. Cannot delete @everyone or managed roles.",
    examples: ["/delete-role role:@OldRole"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("delete-role")
    .setDescription("Owner: delete a role.")
    .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      const role = interaction.options.getRole("role", true);
      if (role.id === interaction.guild.roles.everyone.id) {
        await interaction.reply({
          embeds: [errorEmbed("Refused", "Cannot delete @everyone.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const guildRole = await interaction.guild.roles.fetch(role.id);
      if (!guildRole) {
        await interaction.reply({
          embeds: [errorEmbed("Not found", "Role not in this guild.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await guildRole.delete(`OWNER /delete-role by ${interaction.user.tag}`);
      await interaction.reply({
        embeds: [ownerEmbed("Role deleted", `${role.name}`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await replyErr(interaction, err, "delete-role");
    }
  },
};

/* -------------------------------------------------------------------------- */
/*  Channel management                                                        */
/* -------------------------------------------------------------------------- */

const createChannel: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Create a text, voice or announcement channel.",
    examples: [
      "/create-channel name:welcome kind:text",
      "/create-channel name:music kind:voice category:#General",
    ],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("create-channel")
    .setDescription("Owner: create a channel.")
    .addStringOption((o) => o.setName("name").setDescription("Name").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("kind")
        .setDescription("Type")
        .setRequired(true)
        .addChoices(
          { name: "text", value: "text" },
          { name: "voice", value: "voice" },
          { name: "announcement", value: "announcement" },
          { name: "category", value: "category" },
        ),
    )
    .addChannelOption((o) =>
      o
        .setName("category")
        .setDescription("Parent category (for text/voice)")
        .addChannelTypes(ChannelType.GuildCategory),
    ),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      const name = interaction.options.getString("name", true);
      const kind = interaction.options.getString("kind", true);
      const parent = interaction.options.getChannel("category");
      const type =
        kind === "voice"
          ? ChannelType.GuildVoice
          : kind === "announcement"
            ? ChannelType.GuildAnnouncement
            : kind === "category"
              ? ChannelType.GuildCategory
              : ChannelType.GuildText;
      const channel = await interaction.guild.channels.create({
        name,
        type,
        parent: parent?.id,
        reason: `OWNER /create-channel by ${interaction.user.tag}`,
      });
      await interaction.reply({
        embeds: [ownerEmbed("Channel created", `<#${channel.id}> · id=${channel.id}`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await replyErr(interaction, err, "create-channel");
    }
  },
};

const deleteChannel: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Delete a channel.",
    examples: ["/delete-channel channel:#old-room confirm:DELETE"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("delete-channel")
    .setDescription("Owner: delete a channel.")
    .addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("confirm")
        .setDescription("Type DELETE to confirm")
        .setRequired(true),
    ),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      if (interaction.options.getString("confirm", true) !== "DELETE") {
        await interaction.reply({
          embeds: [errorEmbed("Confirmation failed", "Pass `confirm:DELETE` exactly.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const channel = interaction.options.getChannel("channel", true);
      const guildChannel = await interaction.guild.channels.fetch(channel.id).catch(() => null);
      if (!guildChannel) {
        await interaction.reply({
          embeds: [errorEmbed("Not found", "Channel not in this guild.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await guildChannel.delete(`OWNER /delete-channel by ${interaction.user.tag}`);
      await interaction.reply({
        embeds: [ownerEmbed("Channel deleted", `${channel.name}`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await replyErr(interaction, err, "delete-channel");
    }
  },
};

/* -------------------------------------------------------------------------- */
/*  Mass role                                                                 */
/* -------------------------------------------------------------------------- */

const massRole: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription:
      "Add or remove a role to/from many members. Filters supported: bots-only, humans-only, members of another role.",
    examples: [
      "/mass-role op:add role:@Subscriber filter:humans",
      "/mass-role op:remove role:@Muted filter:role from_role:@Naughty",
    ],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("mass-role")
    .setDescription("Owner: assign/remove a role to many members.")
    .addStringOption((o) =>
      o
        .setName("op")
        .setDescription("Operation")
        .setRequired(true)
        .addChoices({ name: "add", value: "add" }, { name: "remove", value: "remove" }),
    )
    .addRoleOption((o) => o.setName("role").setDescription("Target role").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("filter")
        .setDescription("Filter")
        .addChoices(
          { name: "everyone", value: "everyone" },
          { name: "humans", value: "humans" },
          { name: "bots", value: "bots" },
          { name: "members of another role", value: "role" },
        ),
    )
    .addRoleOption((o) => o.setName("from_role").setDescription("Required role when filter=role")),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const op = interaction.options.getString("op", true);
      const role = interaction.options.getRole("role", true);
      const filter = interaction.options.getString("filter") ?? "everyone";
      const fromRole = interaction.options.getRole("from_role");
      const members = await interaction.guild.members.fetch();
      const targets = members.filter((m) => {
        if (filter === "humans") return !m.user.bot;
        if (filter === "bots") return m.user.bot;
        if (filter === "role") return fromRole ? m.roles.cache.has(fromRole.id) : false;
        return true;
      });
      let changed = 0;
      let failed = 0;
      for (const m of targets.values()) {
        const has = m.roles.cache.has(role.id);
        try {
          if (op === "add" && !has) {
            await m.roles.add(role.id, `OWNER /mass-role by ${interaction.user.tag}`);
            changed += 1;
          } else if (op === "remove" && has) {
            await m.roles.remove(role.id, `OWNER /mass-role by ${interaction.user.tag}`);
            changed += 1;
          }
        } catch (err) {
          log.warn({ err, memberId: m.id }, "mass-role member failed");
          failed += 1;
        }
      }
      await interaction.editReply({
        embeds: [
          ownerEmbed(
            "Mass role complete",
            `Scanned: ${targets.size} · Changed: **${changed}** · Failed: ${failed}`,
          ),
        ],
      });
    } catch (err) {
      await replyErr(interaction, err, "mass-role");
    }
  },
};

/* -------------------------------------------------------------------------- */
/*  Backup / restore                                                          */
/* -------------------------------------------------------------------------- */

type ChannelBackup = {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
  topic: string | null;
  nsfw: boolean;
  rateLimitPerUser: number | null;
  bitrate: number | null;
  userLimit: number | null;
  overwrites: { id: string; type: number; allow: string; deny: string }[];
};

type RoleBackup = {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  position: number;
  permissions: string;
  managed: boolean;
};

type GuildBackup = {
  version: 1;
  takenAt: string;
  guildId: string;
  name: string;
  iconHash: string | null;
  roles: RoleBackup[];
  channels: ChannelBackup[];
};

function backupPath(guildId: string, id: string): string {
  return path.join(BACKUP_DIR, guildId, `${id}.json`);
}

const backupNow: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription:
      "Save a JSON snapshot of all roles + channel structures (names, permissions, overwrites) to ./backups/guilds/<guildId>/<id>.json. Membership and messages are NOT backed up.",
    examples: ["/backup-now"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder().setName("backup-now").setDescription("Owner: snapshot guild structure to JSON."),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const id = `${Date.now()}`;
      const snap: GuildBackup = {
        version: 1,
        takenAt: new Date().toISOString(),
        guildId: interaction.guild.id,
        name: interaction.guild.name,
        iconHash: interaction.guild.icon,
        roles: interaction.guild.roles.cache
          .filter((r) => r.id !== interaction.guild!.roles.everyone.id)
          .map((r) => ({
            id: r.id,
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            mentionable: r.mentionable,
            position: r.position,
            permissions: r.permissions.bitfield.toString(),
            managed: r.managed,
          })),
        channels: interaction.guild.channels.cache.map((c) => {
          const channel = c as GuildChannel & {
            topic?: string | null;
            nsfw?: boolean;
            rateLimitPerUser?: number;
            bitrate?: number;
            userLimit?: number;
          };
          return {
            id: channel.id,
            name: channel.name,
            type: channel.type,
            parentId: channel.parentId,
            position: channel.position,
            topic: channel.topic ?? null,
            nsfw: channel.nsfw ?? false,
            rateLimitPerUser: channel.rateLimitPerUser ?? null,
            bitrate: channel.bitrate ?? null,
            userLimit: channel.userLimit ?? null,
            overwrites: channel.permissionOverwrites.cache.map((o) => ({
              id: o.id,
              type: o.type,
              allow: o.allow.bitfield.toString(),
              deny: o.deny.bitfield.toString(),
            })),
          };
        }),
      };
      await mkdir(path.dirname(backupPath(interaction.guild.id, id)), { recursive: true });
      await writeFile(backupPath(interaction.guild.id, id), JSON.stringify(snap, null, 2));
      await interaction.editReply({
        embeds: [
          ownerEmbed(
            "Backup saved",
            [
              `Snapshot id: \`${id}\``,
              `Roles: ${snap.roles.length}`,
              `Channels: ${snap.channels.length}`,
              `File: ./backups/guilds/${interaction.guild.id}/${id}.json`,
              "",
              "Use `/restore-backup snapshot_id:<id>` to roll forward.",
            ].join("\n"),
          ),
        ],
      });
    } catch (err) {
      await replyErr(interaction, err, "backup-now");
    }
  },
  async autocomplete(interaction) {
    // No autocomplete for backup-now.
    await interaction.respond([]);
  },
};

const restoreBackup: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription:
      "Restore channels and roles from a snapshot id. Creates missing entities, never deletes existing ones. Pass `dry_run:true` to preview.",
    examples: ["/restore-backup snapshot_id:1700000000000 dry_run:true"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("restore-backup")
    .setDescription("Owner: restore guild structure from snapshot id.")
    .addStringOption((o) =>
      o
        .setName("snapshot_id")
        .setDescription("Snapshot id from /backup-now")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addBooleanOption((o) => o.setName("dry_run").setDescription("Preview only (default true)")),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const id = interaction.options.getString("snapshot_id", true);
      const dryRun = interaction.options.getBoolean("dry_run") ?? true;
      let raw: string;
      try {
        raw = await readFile(backupPath(interaction.guild.id, id), "utf8");
      } catch {
        await interaction.editReply({
          embeds: [errorEmbed("Not found", `No snapshot with id \`${id}\` for this guild.`)],
        });
        return;
      }
      const snap = JSON.parse(raw) as GuildBackup;

      const existingRoles = new Map(
        interaction.guild.roles.cache.map((r) => [r.name.toLowerCase(), r.id]),
      );
      const existingChannels = new Map(
        interaction.guild.channels.cache.map((c) => [`${c.type}:${c.name.toLowerCase()}`, c.id]),
      );

      const toCreateRoles = snap.roles.filter(
        (r) => !r.managed && !existingRoles.has(r.name.toLowerCase()),
      );
      const toCreateChannels = snap.channels.filter(
        (c) => !existingChannels.has(`${c.type}:${c.name.toLowerCase()}`),
      );

      if (dryRun) {
        await interaction.editReply({
          embeds: [
            infoEmbed(
              "Dry run",
              [
                `Snapshot ${snap.takenAt}`,
                `Would create roles: **${toCreateRoles.length}**`,
                `Would create channels: **${toCreateChannels.length}**`,
              ].join("\n"),
            ),
          ],
        });
        return;
      }

      let createdRoles = 0;
      let createdChannels = 0;

      for (const r of toCreateRoles) {
        try {
          const role = await interaction.guild.roles.create({
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            mentionable: r.mentionable,
            permissions: new PermissionsBitField(BigInt(r.permissions)),
            reason: `OWNER /restore-backup ${id}`,
          });
          existingRoles.set(role.name.toLowerCase(), role.id);
          createdRoles += 1;
        } catch (err) {
          log.warn({ err, role: r.name }, "restore role failed");
        }
      }

      // Discord rejects thread channel types here; we only restore real
      // guild channels (text/voice/announcement/forum/category/stage/media).
      const RESTORABLE: ReadonlySet<number> = new Set([
        ChannelType.GuildText,
        ChannelType.GuildVoice,
        ChannelType.GuildCategory,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildStageVoice,
        ChannelType.GuildForum,
        ChannelType.GuildMedia,
      ]);

      // First pass: categories, so children can adopt them.
      const channelIdMap = new Map<string, string>();
      const orderedChannels = [...snap.channels]
        .filter((c) => RESTORABLE.has(c.type))
        .sort((a, b) => {
        if (a.type === ChannelType.GuildCategory && b.type !== ChannelType.GuildCategory) return -1;
        if (b.type === ChannelType.GuildCategory && a.type !== ChannelType.GuildCategory) return 1;
        return a.position - b.position;
      });

      for (const c of orderedChannels) {
        const key = `${c.type}:${c.name.toLowerCase()}`;
        if (existingChannels.has(key)) {
          channelIdMap.set(c.id, existingChannels.get(key)!);
          continue;
        }
        try {
          const overwrites: OverwriteResolvable[] = [];
          for (const ow of c.overwrites) {
            const targetId = ow.id === snap.guildId
              ? interaction.guild.roles.everyone.id
              : existingRoles.get(snap.roles.find((r) => r.id === ow.id)?.name.toLowerCase() ?? "")
                ?? ow.id;
            overwrites.push({
              id: targetId,
              allow: new PermissionsBitField(BigInt(ow.allow)),
              deny: new PermissionsBitField(BigInt(ow.deny)),
            });
          }
          // Cast is safe: filtered above to RESTORABLE channel types.
          const created = await interaction.guild.channels.create({
            name: c.name,
            type: c.type as ChannelType.GuildText,
            parent: c.parentId ? channelIdMap.get(c.parentId) ?? undefined : undefined,
            topic: c.topic ?? undefined,
            nsfw: c.nsfw,
            rateLimitPerUser: c.rateLimitPerUser ?? undefined,
            bitrate: c.bitrate ?? undefined,
            userLimit: c.userLimit ?? undefined,
            permissionOverwrites: overwrites,
            reason: `OWNER /restore-backup ${id}`,
          });
          channelIdMap.set(c.id, created.id);
          existingChannels.set(`${c.type}:${c.name.toLowerCase()}`, created.id);
          createdChannels += 1;
        } catch (err) {
          log.warn({ err, channel: c.name }, "restore channel failed");
        }
      }

      await interaction.editReply({
        embeds: [
          successEmbed(
            "Restore complete",
            `Created roles: ${createdRoles} · Created channels: ${createdChannels}`,
          ),
        ],
      });
    } catch (err) {
      await replyErr(interaction, err, "restore-backup");
    }
  },
  async autocomplete(interaction) {
    if (!interaction.guildId) {
      await interaction.respond([]);
      return;
    }
    const focused = interaction.options.getFocused().toString();
    try {
      const dir = path.join(BACKUP_DIR, interaction.guildId);
      const files = await readdir(dir).catch(() => [] as string[]);
      const ids = files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .filter((id) => id.includes(focused))
        .sort((a, b) => Number(b) - Number(a))
        .slice(0, 25)
        .map((id) => ({ name: `${id} (${new Date(Number(id)).toISOString()})`.slice(0, 100), value: id }));
      await interaction.respond(ids);
    } catch {
      await interaction.respond([]);
    }
  },
};

/* -------------------------------------------------------------------------- */
/*  Exports + helpers                                                         */
/* -------------------------------------------------------------------------- */

void PermissionFlagsBits;
void Collection;

async function replyErr(interaction: ChatInputCommandInteraction, err: unknown, scope: string) {
  log.error({ err, scope }, "owner utility command failed");
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

export const commands: SlashCommand[] = [
  createRole,
  deleteRole,
  createChannel,
  deleteChannel,
  massRole,
  backupNow,
  restoreBackup,
];
