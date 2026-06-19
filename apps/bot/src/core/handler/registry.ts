import { Collection, REST, Routes } from "discord.js";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { env } from "@core/config/env";
import { child } from "@core/logger/logger";
import type { ButtonHandler, ModalHandler, SelectMenuHandler, SlashCommand } from "./command";
import type { DiscordEvent } from "./event";

const log = child("registry");

export class CommandRegistry {
  readonly commands = new Collection<string, SlashCommand>();
  readonly buttons: ButtonHandler[] = [];
  readonly selects: SelectMenuHandler[] = [];
  readonly modals: ModalHandler[] = [];
  readonly events: DiscordEvent[] = [];

  async loadFromModulesDir(rootDir: string): Promise<void> {
    await this.walk(rootDir, async (file) => {
      const mod = await import(pathToFileURL(file).href);
      if (mod?.command) this.registerCommand(mod.command);
      if (mod?.commands && Array.isArray(mod.commands)) {
        for (const c of mod.commands) this.registerCommand(c);
      }
      if (mod?.button) this.buttons.push(mod.button);
      if (mod?.buttons && Array.isArray(mod.buttons)) this.buttons.push(...mod.buttons);
      if (mod?.select) this.selects.push(mod.select);
      if (mod?.selects && Array.isArray(mod.selects)) this.selects.push(...mod.selects);
      if (mod?.modal) this.modals.push(mod.modal);
      if (mod?.modals && Array.isArray(mod.modals)) this.modals.push(...mod.modals);
      if (mod?.event) this.events.push(mod.event);
      if (mod?.events && Array.isArray(mod.events)) this.events.push(...mod.events);
    });
    log.info(
      {
        commands: this.commands.size,
        buttons: this.buttons.length,
        selects: this.selects.length,
        modals: this.modals.length,
        events: this.events.length,
      },
      "module registry loaded",
    );
  }

  private registerCommand(cmd: SlashCommand) {
    const name = cmd.data.name;
    if (this.commands.has(name)) {
      log.warn({ name }, "command duplicate, overwriting");
    }
    this.commands.set(name, cmd);
  }

  private async walk(dir: string, onFile: (file: string) => Promise<void>): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      const s = await stat(full);
      if (s.isDirectory()) {
        await this.walk(full, onFile);
      } else if (
        s.isFile() &&
        !entry.startsWith("_") &&
        (entry.endsWith(".commands.js") ||
          entry.endsWith(".commands.ts") ||
          entry.endsWith(".events.js") ||
          entry.endsWith(".events.ts") ||
          entry.endsWith(".buttons.js") ||
          entry.endsWith(".buttons.ts") ||
          entry.endsWith(".selects.js") ||
          entry.endsWith(".selects.ts") ||
          entry.endsWith(".modals.js") ||
          entry.endsWith(".modals.ts"))
      ) {
        await onFile(full);
      }
    }
  }

  findButton(customId: string): { handler: ButtonHandler; params: string[] } | null {
    return this.matchInteractive(customId, this.buttons);
  }

  findSelect(customId: string): { handler: SelectMenuHandler; params: string[] } | null {
    return this.matchInteractive(customId, this.selects);
  }

  findModal(customId: string): { handler: ModalHandler; params: string[] } | null {
    return this.matchInteractive(customId, this.modals);
  }

  private matchInteractive<T extends { customId: string }>(
    customId: string,
    list: T[],
  ): { handler: T; params: string[] } | null {
    for (const h of list) {
      if (customId === h.customId) return { handler: h, params: [] };
      if (customId.startsWith(`${h.customId}:`)) {
        return { handler: h, params: customId.slice(h.customId.length + 1).split(":") };
      }
    }
    return null;
  }

  async deploy(clientId: string): Promise<void> {
    const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
    const body = this.commands.map((c) => c.data.toJSON());

    if (env.DEV_GUILD_IDS.length > 0 && env.isDev) {
      for (const guildId of env.DEV_GUILD_IDS) {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
        log.info({ guildId, count: body.length }, "guild slash commands deployed");
      }
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body });
      log.info({ count: body.length }, "global slash commands deployed");
    }
  }
}

export const registry = new CommandRegistry();
