import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { inspect } from "node:util";
import type { SlashCommand } from "@core/handler/command";
import { ownerEmbed, errorEmbed } from "@shared/embeds/factory";
import { Colors } from "@shared/embeds/colors";
import { registry } from "@core/handler/registry";
import { prisma } from "@core/db/prisma";
import { redis } from "@core/cache/redis";
import { env } from "@core/config/env";
import { child, logger } from "@core/logger/logger";
import { formatNumber, formatDuration } from "@shared/utils/format";

const log = child("owner.system");

/* -------------------------------------------------------------------------- */
/*  /eval                                                                     */
/* -------------------------------------------------------------------------- */

const evalCmd: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  meta: {
    longDescription:
      "Run arbitrary JavaScript inside the bot process. The expression's value is rendered with util.inspect and truncated for safety.",
    examples: ["/eval code:client.guilds.cache.size", "/eval code:await prisma.user.count()"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("eval")
    .setDescription("Owner: evaluate JavaScript inside the bot process.")
    .addStringOption((o) => o.setName("code").setDescription("Expression / statement").setRequired(true))
    .addBooleanOption((o) => o.setName("hidden").setDescription("Ephemeral reply (default true)"))
    .addIntegerOption((o) =>
      o
        .setName("depth")
        .setDescription("util.inspect depth (1..5)")
        .setMinValue(1)
        .setMaxValue(5),
    ),
  async execute(interaction) {
    const code = interaction.options.getString("code", true);
    const hidden = interaction.options.getBoolean("hidden") ?? true;
    const depth = interaction.options.getInteger("depth") ?? 1;
    await interaction.deferReply(hidden ? { flags: MessageFlags.Ephemeral } : undefined);

    // Bindings available inside /eval.
    const client = interaction.client;
    const guild = interaction.guild;
    const channel = interaction.channel;
    void client;
    void guild;
    void channel;

    let result: unknown;
    let success = true;
    const started = performance.now();
    try {
      const wrapper = new Function(
        "client",
        "guild",
        "channel",
        "interaction",
        "prisma",
        "redis",
        "registry",
        "env",
        "logger",
        `return (async () => { return (${code}); })();`,
      );
      result = await wrapper(
        client,
        guild,
        channel,
        interaction,
        prisma,
        redis,
        registry,
        env,
        logger,
      );
    } catch (err) {
      success = false;
      result = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err);
    }
    const took = (performance.now() - started).toFixed(1);

    const rendered =
      typeof result === "string"
        ? result
        : inspect(result, { depth, maxArrayLength: 50, breakLength: 80 });

    const clipped = rendered.length > 1800 ? rendered.slice(0, 1800) + "\nвЂ¦(truncated)" : rendered;

    const embed = (success ? ownerEmbed("/eval result", null as unknown as string) : errorEmbed("/eval failed"))
      .setDescription(`Took: \`${took}ms\`\n\n\`\`\`js\n${clipped}\n\`\`\``);
    await interaction.editReply({ embeds: [embed] });
  },
};

/* -------------------------------------------------------------------------- */
/*  /reload                                                                   */
/* -------------------------------------------------------------------------- */

const reloadCmd: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  meta: {
    longDescription:
      "Hot-reload command and event modules without restarting the bot. Useful after editing a single .commands.ts file in dev.",
    examples: ["/reload scope:commands", "/reload scope:all"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("reload")
    .setDescription("Owner: hot-reload command/event modules.")
    .addStringOption((o) =>
      o
        .setName("scope")
        .setDescription("What to reload")
        .setRequired(true)
        .addChoices(
          { name: "commands", value: "commands" },
          { name: "events", value: "events" },
          { name: "all", value: "all" },
        ),
    ),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const scope = interaction.options.getString("scope", true);
    try {
      const before = {
        commands: registry.commands.size,
        events: registry.events.length,
      };

      // Clear require cache for everything under src/modules so the next walk
      // picks up edits. We intentionally only clear our own modules and never
      // the discord.js / prisma / redis singletons.
      const modulesRoot = path.resolve(__dirname, "..");
      let purged = 0;
      for (const key of Object.keys(require.cache)) {
        if (key.startsWith(modulesRoot)) {
          delete require.cache[key];
          purged += 1;
        }
      }

      // Re-walk and re-register.
      if (scope === "commands" || scope === "all") {
        registry.commands.clear();
        registry.buttons.length = 0;
        registry.selects.length = 0;
        registry.modals.length = 0;
      }
      if (scope === "events" || scope === "all") {
        registry.events.length = 0;
      }
      await registry.loadFromModulesDir(modulesRoot);

      await interaction.editReply({
        embeds: [
          ownerEmbed(
            "Reload complete",
            [
              `Scope: \`${scope}\``,
              `Modules purged: **${purged}**`,
              `Commands: ${before.commands} в†’ **${registry.commands.size}**`,
              `Events:   ${before.events} в†’ **${registry.events.length}**`,
              "",
              "Note: events re-registered in-process only on next listener attach. Bot restart recommended for event scope.",
            ].join("\n"),
          ),
        ],
      });
    } catch (err) {
      log.error({ err }, "reload failed");
      await interaction.editReply({
        embeds: [errorEmbed("Reload failed", err instanceof Error ? err.message : String(err))],
      });
    }
  },
};

/* -------------------------------------------------------------------------- */
/*  /guild-info                                                               */
/* -------------------------------------------------------------------------- */

const guildInfo: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  meta: {
    longDescription: "Detailed information about a guild (defaults to the current guild).",
    examples: ["/guild-info", "/guild-info guild_id:123"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("guild-info")
    .setDescription("Owner: detailed information about a guild.")
    .addStringOption((o) => o.setName("guild_id").setDescription("Target guild id")),
  async execute(interaction) {
    const id = interaction.options.getString("guild_id") ?? interaction.guildId;
    if (!id) {
      await interaction.reply({
        embeds: [errorEmbed("No guild", "Run in a guild or pass `guild_id`.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const g = interaction.client.guilds.cache.get(id);
    if (!g) {
      await interaction.reply({
        embeds: [errorEmbed("Unknown guild", `Bot is not in guild \`${id}\`.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await g.fetch();
    const owner = await g.fetchOwner().catch(() => null);
    const dbGuild = await prisma.guild.findUnique({ where: { id: g.id } });
    const embed = new EmbedBuilder()
      .setColor(Colors.premium)
      .setTitle(`в… OWN В· Guild ${g.name}`)
      .setThumbnail(g.iconURL({ size: 128 }) ?? null)
      .addFields(
        { name: "ID", value: g.id, inline: true },
        { name: "Owner", value: owner ? `${owner.user.tag} (${owner.id})` : "вЂ”", inline: true },
        { name: "Members", value: String(g.memberCount), inline: true },
        { name: "Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
        { name: "Channels", value: String(g.channels.cache.size), inline: true },
        { name: "Roles", value: String(g.roles.cache.size), inline: true },
        { name: "Boost tier", value: String(g.premiumTier), inline: true },
        { name: "Boosts", value: String(g.premiumSubscriptionCount ?? 0), inline: true },
        { name: "Locale", value: g.preferredLocale, inline: true },
        {
          name: "DB record",
          value: dbGuild ? `lang=${dbGuild.language} В· staffRoles=${dbGuild.staffRoleIds.length}` : "(not seeded)",
          inline: false,
        },
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

/* -------------------------------------------------------------------------- */
/*  /user-info-advanced                                                       */
/* -------------------------------------------------------------------------- */

const userInfoAdvanced: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  meta: {
    longDescription:
      "Cross-server audit profile: global balance, level, reputation, recent transactions and recent mod cases.",
    examples: ["/user-info-advanced user:@u"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("user-info-advanced")
    .setDescription("Owner: full audit profile for a user.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),
  async execute(interaction) {
    const user = interaction.options.getUser("user", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [u, txns, cases] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id } }),
      prisma.transaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.moderationCase.findMany({
        where: { subjectId: user.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);
    const embed = new EmbedBuilder()
      .setColor(Colors.premium)
      .setTitle(`в… OWN В· ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: "ID", value: user.id, inline: true },
        { name: "Created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: "Bot", value: String(user.bot), inline: true },
      );
    if (u) {
      embed.addFields(
        { name: "Global wallet", value: formatNumber(u.globalBalance), inline: true },
        { name: "Global bank", value: formatNumber(u.globalBank), inline: true },
        { name: "Level / XP", value: `${u.level} В· ${formatNumber(u.xp)}`, inline: true },
        { name: "Reputation", value: String(u.reputation), inline: true },
        { name: "Blacklisted", value: String(u.isBlacklisted), inline: true },
        { name: "Risk score", value: String(u.globalRiskScore), inline: true },
      );
    } else {
      embed.addFields({ name: "DB", value: "(no global record)", inline: false });
    }
    if (txns.length) {
      embed.addFields({
        name: "Recent transactions",
        value: txns
          .map(
            (t) =>
              `\`${t.type}\` ${t.amount >= 0n ? "+" : ""}${formatNumber(t.amount)} в†’ ${formatNumber(t.balance)}${
                t.guildId ? ` В· g:${t.guildId.slice(0, 6)}` : ""
              }`,
          )
          .join("\n")
          .slice(0, 1024),
        inline: false,
      });
    }
    if (cases.length) {
      embed.addFields({
        name: "Recent mod cases",
        value: cases.map((c) => `\`${c.action}\` В· ${c.reason ?? "no reason"}`).join("\n").slice(0, 1024),
        inline: false,
      });
    }
    await interaction.editReply({ embeds: [embed] });
  },
};

/* -------------------------------------------------------------------------- */
/*  /cache-stats                                                              */
/* -------------------------------------------------------------------------- */

const cacheStats: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  meta: {
    longDescription: "Per-cache sizes for the Discord client, Redis db-size and Prisma pool state.",
    examples: ["/cache-stats"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder().setName("cache-stats").setDescription("Owner: bot cache statistics."),
  async execute(interaction) {
    const c = interaction.client;
    const rows = [
      ["Guilds", c.guilds.cache.size],
      ["Channels", c.channels.cache.size],
      ["Users", c.users.cache.size],
      ["Emojis", c.emojis.cache.size],
      ["Messages (sum)", sumGuildCaches(c, (g) => g.channels.cache.reduce((a, ch) => a + ("messages" in ch ? ch.messages.cache.size : 0), 0))],
      ["Members (sum)", sumGuildCaches(c, (g) => g.members.cache.size)],
      ["Voice states (sum)", sumGuildCaches(c, (g) => g.voiceStates.cache.size)],
    ] as [string, number][];

    let redisSize = "n/a";
    try {
      redisSize = String(await redis.dbsize());
    } catch {
      /* ignore */
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.premium)
      .setTitle("в… OWN В· Cache stats")
      .setDescription(rows.map(([k, v]) => `**${k}**: ${formatNumber(v)}`).join("\n"))
      .addFields({ name: "Redis keys", value: redisSize, inline: true });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

function sumGuildCaches(
  client: import("discord.js").Client,
  fn: (g: import("discord.js").Guild) => number,
): number {
  let n = 0;
  for (const g of client.guilds.cache.values()) n += fn(g);
  return n;
}

/* -------------------------------------------------------------------------- */
/*  /memory-usage                                                             */
/* -------------------------------------------------------------------------- */

const memoryUsage: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  meta: {
    longDescription: "Process memory usage and uptime.",
    examples: ["/memory-usage"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder().setName("memory-usage").setDescription("Owner: process memory usage."),
  async execute(interaction) {
    const m = process.memoryUsage();
    const fmt = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
    const embed = new EmbedBuilder()
      .setColor(Colors.premium)
      .setTitle("в… OWN В· Memory usage")
      .addFields(
        { name: "RSS", value: fmt(m.rss), inline: true },
        { name: "Heap used", value: fmt(m.heapUsed), inline: true },
        { name: "Heap total", value: fmt(m.heapTotal), inline: true },
        { name: "External", value: fmt(m.external), inline: true },
        { name: "Array buffers", value: fmt(m.arrayBuffers), inline: true },
        { name: "Uptime", value: formatDuration(Math.floor(process.uptime() * 1000)), inline: true },
        { name: "Node", value: process.version, inline: true },
        { name: "Platform", value: `${process.platform} (${process.arch})`, inline: true },
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

/* -------------------------------------------------------------------------- */
/*  /bot-stats                                                                */
/* -------------------------------------------------------------------------- */

const botStats: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  meta: {
    longDescription: "Aggregate bot statistics: guilds, users, commands, db counts.",
    examples: ["/bot-stats"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder().setName("bot-stats").setDescription("Owner: aggregate bot stats."),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const c = interaction.client;
    const [users, txns, cases, tickets] = await Promise.all([
      prisma.user.count(),
      prisma.transaction.count(),
      prisma.moderationCase.count(),
      prisma.ticket.count(),
    ]);
    const embed = new EmbedBuilder()
      .setColor(Colors.premium)
      .setTitle("в… OWN В· Bot statistics")
      .addFields(
        { name: "Guilds", value: formatNumber(c.guilds.cache.size), inline: true },
        { name: "Users (cached)", value: formatNumber(c.users.cache.size), inline: true },
        { name: "Channels", value: formatNumber(c.channels.cache.size), inline: true },
        { name: "Commands", value: formatNumber(registry.commands.size), inline: true },
        { name: "Buttons", value: formatNumber(registry.buttons.length), inline: true },
        { name: "Selects", value: formatNumber(registry.selects.length), inline: true },
        { name: "Events", value: formatNumber(registry.events.length), inline: true },
        { name: "DB users", value: formatNumber(users), inline: true },
        { name: "DB transactions", value: formatNumber(txns), inline: true },
        { name: "DB mod cases", value: formatNumber(cases), inline: true },
        { name: "DB tickets", value: formatNumber(tickets), inline: true },
        { name: "Uptime", value: formatDuration(Math.floor(process.uptime() * 1000)), inline: true },
      );
    await interaction.editReply({ embeds: [embed] });
  },
};

/* -------------------------------------------------------------------------- */
/*  /shards                                                                   */
/* -------------------------------------------------------------------------- */

const shardsCmd: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  meta: {
    longDescription: "Per-shard status. In single-process mode reports shard 0.",
    examples: ["/shards"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder().setName("shards").setDescription("Owner: shard status."),
  async execute(interaction) {
    const c = interaction.client;
    const lines: string[] = [];
    if (c.ws.shards.size === 0) {
      lines.push(`#0 В· status=ready В· ping=${c.ws.ping}ms`);
    } else {
      for (const shard of c.ws.shards.values()) {
        lines.push(`#${shard.id} В· status=${shard.status} В· ping=${shard.ping}ms`);
      }
    }
    await interaction.reply({
      embeds: [ownerEmbed("Shards", lines.join("\n"))],
      flags: MessageFlags.Ephemeral,
    });
  },
};

/* -------------------------------------------------------------------------- */
/*  /latency-detailed                                                         */
/* -------------------------------------------------------------------------- */

const latencyDetailed: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  meta: {
    longDescription: "Per-component latency: gateway WS, REST roundtrip, Postgres, Redis.",
    examples: ["/latency-detailed"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder().setName("latency-detailed").setDescription("Owner: detailed latency."),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ws = interaction.client.ws.ping;

    const restStart = performance.now();
    await interaction.editReply({ content: "вЂ¦" });
    const restMs = (performance.now() - restStart).toFixed(1);

    const dbStart = performance.now();
    let dbMs = "n/a";
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbMs = (performance.now() - dbStart).toFixed(1) + " ms";
    } catch {
      dbMs = "error";
    }

    const redisStart = performance.now();
    let redisMs = "n/a";
    try {
      await redis.ping();
      redisMs = (performance.now() - redisStart).toFixed(1) + " ms";
    } catch {
      redisMs = "error";
    }

    await interaction.editReply({
      content: "",
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.premium)
          .setTitle("в… OWN В· Latency")
          .addFields(
            { name: "Gateway WS", value: `${ws} ms`, inline: true },
            { name: "REST round-trip", value: `${restMs} ms`, inline: true },
            { name: "Postgres", value: dbMs, inline: true },
            { name: "Redis", value: redisMs, inline: true },
          ),
      ],
    });
  },
};

void ChatInputCommandInteraction;

export const commands: SlashCommand[] = [
  evalCmd,
  reloadCmd,
  guildInfo,
  userInfoAdvanced,
  cacheStats,
  memoryUsage,
  botStats,
  shardsCmd,
  latencyDetailed,
];
