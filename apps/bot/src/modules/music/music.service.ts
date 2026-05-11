import type { Client, GuildMember, VoiceBasedChannel } from "discord.js";
import type { Player, SearchPlatform, Track, UnresolvedTrack } from "lavalink-client";
import { getLavalink } from "@infra/lavalink/manager";
import { prisma } from "@core/db/prisma";
import { UserFacingError } from "@core/errors/errors";
import { child } from "@core/logger/logger";
import { isDj } from "@shared/utils/perms";

const log = child("music");

export interface PlayResult {
  player: Player;
  loadType: string;
  tracks: (Track | UnresolvedTrack)[];
  playlistName?: string;
}

export class MusicService {
  constructor(private readonly client: Client) {}

  private getManager() {
    return getLavalink(this.client);
  }

  async ensurePlayer(member: GuildMember, voiceChannel: VoiceBasedChannel): Promise<Player> {
    const manager = this.getManager();
    let player = manager.getPlayer(member.guild.id);
    if (!player) {
      player = manager.createPlayer({
        guildId: member.guild.id,
        voiceChannelId: voiceChannel.id,
        selfDeaf: true,
        selfMute: false,
        volume: 80,
        instaUpdateFiltersFix: true,
      });
    }
    if (!player.connected) await player.connect();
    return player;
  }

  async play(
    member: GuildMember,
    voiceChannel: VoiceBasedChannel,
    query: string,
    source: SearchPlatform = "ytsearch",
  ): Promise<PlayResult> {
    const player = await this.ensurePlayer(member, voiceChannel);
    const result = await player.search({ query, source }, member.user);

    if (!result.tracks.length) {
      throw new UserFacingError("Nothing found for that query.");
    }

    if (result.loadType === "playlist") {
      player.queue.add(result.tracks);
    } else {
      player.queue.add(result.tracks[0]!);
    }

    if (!player.playing && !player.paused) await player.play();
    return {
      player,
      loadType: result.loadType,
      tracks: result.tracks,
      playlistName: result.playlist?.name,
    };
  }

  async skip(member: GuildMember): Promise<Track | null> {
    const player = this.requirePlayer(member.guild.id);
    if (!(await this.canControl(member, player))) {
      throw new UserFacingError("Only DJs and the song requester can skip.");
    }
    const current = player.queue.current ?? null;
    await player.skip();
    return current;
  }

  async pause(member: GuildMember): Promise<boolean> {
    const player = this.requirePlayer(member.guild.id);
    if (!(await isDj(member))) throw new UserFacingError("DJ only.");
    if (player.paused) {
      await player.resume();
      return false;
    }
    await player.pause();
    return true;
  }

  async stop(member: GuildMember): Promise<void> {
    const player = this.requirePlayer(member.guild.id);
    if (!(await isDj(member))) throw new UserFacingError("DJ only.");
    await player.destroy("stopped by user");
  }

  async setVolume(member: GuildMember, vol: number): Promise<void> {
    if (vol < 0 || vol > 200) throw new UserFacingError("Volume must be 0–200.");
    const player = this.requirePlayer(member.guild.id);
    if (!(await isDj(member))) throw new UserFacingError("DJ only.");
    await player.setVolume(vol);
    await prisma.musicQueue.upsert({
      where: { guildId: member.guild.id },
      create: { guildId: member.guild.id, volume: vol },
      update: { volume: vol },
    });
  }

  async setLoop(
    member: GuildMember,
    mode: "none" | "track" | "queue",
  ): Promise<void> {
    const player = this.requirePlayer(member.guild.id);
    if (!(await isDj(member))) throw new UserFacingError("DJ only.");
    player.setRepeatMode(mode === "none" ? "off" : mode);
    await prisma.musicQueue.upsert({
      where: { guildId: member.guild.id },
      create: { guildId: member.guild.id, loopMode: mode },
      update: { loopMode: mode },
    });
  }

  async shuffle(member: GuildMember): Promise<void> {
    const player = this.requirePlayer(member.guild.id);
    if (!(await isDj(member))) throw new UserFacingError("DJ only.");
    player.queue.shuffle();
  }

  async applyFilter(
    member: GuildMember,
    filter: "bassboost" | "nightcore" | "vaporwave" | "8d" | "karaoke" | "off",
  ): Promise<void> {
    const player = this.requirePlayer(member.guild.id);
    if (!(await isDj(member))) throw new UserFacingError("DJ only.");
    const f = player.filterManager;
    switch (filter) {
      case "bassboost":
        await f.setEQ([
          { band: 0, gain: 0.25 },
          { band: 1, gain: 0.2 },
          { band: 2, gain: 0.15 },
        ]);
        break;
      case "nightcore":
        await f.toggleNightcore();
        break;
      case "vaporwave":
        await f.toggleVaporwave();
        break;
      case "8d":
        await f.toggleRotation();
        break;
      case "karaoke":
        await f.toggleKaraoke();
        break;
      case "off":
        await f.resetFilters();
        break;
    }
  }

  async enable247(member: GuildMember, on: boolean): Promise<void> {
    if (!(await isDj(member))) throw new UserFacingError("DJ only.");
    await prisma.musicQueue.upsert({
      where: { guildId: member.guild.id },
      create: { guildId: member.guild.id, is24x7: on },
      update: { is24x7: on },
    });
  }

  getQueue(guildId: string): (Track | UnresolvedTrack)[] {
    const player = this.getManager().getPlayer(guildId);
    if (!player) return [];
    const current = player.queue.current;
    const rest = player.queue.tracks;
    return current ? [current, ...rest] : [...rest];
  }

  private requirePlayer(guildId: string): Player {
    const player = this.getManager().getPlayer(guildId);
    if (!player) throw new UserFacingError("Nothing is playing.");
    return player;
  }

  private async canControl(member: GuildMember, player: Player): Promise<boolean> {
    const requester = player.queue.current?.requester as { id?: string } | undefined;
    if (requester?.id === member.id) return true;
    return isDj(member);
  }
}

let _service: MusicService | undefined;
export function getMusicService(client: Client): MusicService {
  if (!_service) _service = new MusicService(client);
  return _service;
}

export { log as musicLog };
