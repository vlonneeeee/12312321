import {
  ChatInputCommandInteraction,
  GuildMember,
  SlashCommandBuilder,
  VoiceBasedChannel,
} from "discord.js";
import { getMusicService } from "./music.service";
import type { SlashCommand } from "@core/handler/command";
import { errorEmbed, infoEmbed, successEmbed } from "@shared/embeds/factory";
import { formatDuration, progressBar, truncate } from "@shared/utils/format";
import { UserFacingError } from "@core/errors/errors";

function memberVoice(interaction: ChatInputCommandInteraction): {
  member: GuildMember;
  channel: VoiceBasedChannel;
} {
  const member = interaction.member as GuildMember;
  const channel = member.voice.channel;
  if (!channel) throw new UserFacingError("Join a voice channel first.");
  return { member, channel };
}

async function safeReply(
  interaction: ChatInputCommandInteraction,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof UserFacingError ? err.message : "Something went wrong.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [errorEmbed("Music", message)] });
    } else {
      await interaction.reply({ embeds: [errorEmbed("Music", message)], ephemeral: true });
    }
  }
}

const playCommand: SlashCommand = {
  category: "music",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a track or playlist (YouTube / SoundCloud / Spotify URL).")
    .addStringOption((o) =>
      o.setName("query").setDescription("Song name or URL").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("source")
        .setDescription("Search source")
        .addChoices(
          { name: "YouTube Music", value: "ytmsearch" },
          { name: "YouTube", value: "ytsearch" },
          { name: "SoundCloud", value: "scsearch" },
          { name: "Spotify", value: "spsearch" },
        ),
    ),
  async execute(interaction) {
    await safeReply(interaction, async () => {
      await interaction.deferReply();
      const { member, channel } = memberVoice(interaction);
      const query = interaction.options.getString("query", true);
      const source = (interaction.options.getString("source") ?? "ytmsearch") as
        | "ytsearch"
        | "ytmsearch"
        | "scsearch"
        | "spsearch";
      const svc = getMusicService(interaction.client);
      const res = await svc.play(member, channel, query, source);

      if (res.loadType === "playlist") {
        await interaction.editReply({
          embeds: [
            successEmbed(
              `Added playlist (${res.tracks.length} tracks)`,
              truncate(res.playlistName ?? query, 200),
            ),
          ],
        });
      } else {
        const t = res.tracks[0]!;
        await interaction.editReply({
          embeds: [
            successEmbed("Added to queue", `**${truncate(t.info.title, 240)}**\n${t.info.author}`),
          ],
        });
      }
    });
  },
};

const skipCommand: SlashCommand = {
  category: "music",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("skip").setDescription("Skip the current track."),
  async execute(interaction) {
    await safeReply(interaction, async () => {
      const member = interaction.member as GuildMember;
      const svc = getMusicService(interaction.client);
      const skipped = await svc.skip(member);
      await interaction.reply({
        embeds: [
          successEmbed(
            "Skipped",
            skipped ? `**${truncate(skipped.info.title, 240)}**` : "Track skipped.",
          ),
        ],
      });
    });
  },
};

const pauseCommand: SlashCommand = {
  category: "music",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("pause").setDescription("Pause / resume playback."),
  async execute(interaction) {
    await safeReply(interaction, async () => {
      const member = interaction.member as GuildMember;
      const svc = getMusicService(interaction.client);
      const resumed = await svc.pause(member);
      await interaction.reply({
        embeds: [successEmbed(resumed ? "Resumed" : "Paused")],
      });
    });
  },
};

const stopCommand: SlashCommand = {
  category: "music",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear queue."),
  async execute(interaction) {
    await safeReply(interaction, async () => {
      const member = interaction.member as GuildMember;
      const svc = getMusicService(interaction.client);
      await svc.stop(member);
      await interaction.reply({ embeds: [successEmbed("Stopped")] });
    });
  },
};

const volumeCommand: SlashCommand = {
  category: "music",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set volume (0-200).")
    .addIntegerOption((o) =>
      o.setName("amount").setDescription("0-200").setMinValue(0).setMaxValue(200).setRequired(true),
    ),
  async execute(interaction) {
    await safeReply(interaction, async () => {
      const member = interaction.member as GuildMember;
      const vol = interaction.options.getInteger("amount", true);
      const svc = getMusicService(interaction.client);
      await svc.setVolume(member, vol);
      await interaction.reply({ embeds: [successEmbed(`Volume → ${vol}%`)] });
    });
  },
};

const loopCommand: SlashCommand = {
  category: "music",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set loop mode.")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("Loop mode")
        .setRequired(true)
        .addChoices(
          { name: "Off", value: "none" },
          { name: "Track", value: "track" },
          { name: "Queue", value: "queue" },
        ),
    ),
  async execute(interaction) {
    await safeReply(interaction, async () => {
      const member = interaction.member as GuildMember;
      const mode = interaction.options.getString("mode", true) as "none" | "track" | "queue";
      await getMusicService(interaction.client).setLoop(member, mode);
      await interaction.reply({ embeds: [successEmbed(`Loop → ${mode}`)] });
    });
  },
};

const shuffleCommand: SlashCommand = {
  category: "music",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the queue."),
  async execute(interaction) {
    await safeReply(interaction, async () => {
      const member = interaction.member as GuildMember;
      await getMusicService(interaction.client).shuffle(member);
      await interaction.reply({ embeds: [successEmbed("Queue shuffled")] });
    });
  },
};

const filterCommand: SlashCommand = {
  category: "music",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("filter")
    .setDescription("Toggle an audio filter.")
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Filter")
        .setRequired(true)
        .addChoices(
          { name: "Bass boost", value: "bassboost" },
          { name: "Nightcore", value: "nightcore" },
          { name: "Vaporwave", value: "vaporwave" },
          { name: "8D", value: "8d" },
          { name: "Karaoke", value: "karaoke" },
          { name: "Off", value: "off" },
        ),
    ),
  async execute(interaction) {
    await safeReply(interaction, async () => {
      const member = interaction.member as GuildMember;
      const f = interaction.options.getString("type", true) as
        | "bassboost"
        | "nightcore"
        | "vaporwave"
        | "8d"
        | "karaoke"
        | "off";
      await getMusicService(interaction.client).applyFilter(member, f);
      await interaction.reply({ embeds: [successEmbed(`Filter → ${f}`)] });
    });
  },
};

const queueCommand: SlashCommand = {
  category: "music",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("queue").setDescription("Show the current queue."),
  async execute(interaction) {
    await safeReply(interaction, async () => {
      const queue = getMusicService(interaction.client).getQueue(interaction.guildId!);
      if (!queue.length) {
        await interaction.reply({ embeds: [infoEmbed("Queue is empty")] });
        return;
      }
      const head = queue
        .slice(0, 10)
        .map(
          (t, i) =>
            `${i === 0 ? "▶" : `\`${i}.\``} **${truncate(t.info.title, 60)}** — ${formatDuration(
              t.info.duration ?? 0,
            )}`,
        )
        .join("\n");
      await interaction.reply({
        embeds: [infoEmbed(`Queue (${queue.length})`, head)],
      });
    });
  },
};

const nowplayingCommand: SlashCommand = {
  category: "music",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current track."),
  async execute(interaction) {
    await safeReply(interaction, async () => {
      const svc = getMusicService(interaction.client);
      const queue = svc.getQueue(interaction.guildId!);
      const current = queue[0];
      if (!current) {
        await interaction.reply({ embeds: [infoEmbed("Nothing playing")] });
        return;
      }
      const bar = progressBar(0, current.info.duration ?? 1);
      await interaction.reply({
        embeds: [
          infoEmbed(`Now playing`, `**${truncate(current.info.title, 240)}**\n${bar}`).setURL(
            current.info.uri ?? null,
          ),
        ],
      });
    });
  },
};

const dj247Command: SlashCommand = {
  category: "music",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("247")
    .setDescription("Toggle 24/7 mode.")
    .addBooleanOption((o) => o.setName("enabled").setDescription("Enable").setRequired(true)),
  async execute(interaction) {
    await safeReply(interaction, async () => {
      const member = interaction.member as GuildMember;
      const on = interaction.options.getBoolean("enabled", true);
      await getMusicService(interaction.client).enable247(member, on);
      await interaction.reply({ embeds: [successEmbed(`24/7 → ${on ? "on" : "off"}`)] });
    });
  },
};

export const commands: SlashCommand[] = [
  playCommand,
  skipCommand,
  pauseCommand,
  stopCommand,
  volumeCommand,
  loopCommand,
  shuffleCommand,
  filterCommand,
  queueCommand,
  nowplayingCommand,
  dj247Command,
];
