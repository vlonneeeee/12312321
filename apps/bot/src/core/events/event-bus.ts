import { EventEmitter } from "node:events";
import { child } from "@core/logger/logger";

const log = child("eventbus");

export type DomainEventMap = {
  // economy
  "economy.transaction": { userId: string; guildId?: string; amount: bigint; type: string };
  // moderation
  "moderation.case": { caseId: string; guildId: string; subjectId: string; action: string };
  // voice
  "voice.session.ended": {
    userId: string;
    guildId: string;
    durationSec: number;
    xpAwarded: number;
  };
  // tickets
  "ticket.created": { ticketId: string; guildId: string; authorId: string };
  "ticket.closed": { ticketId: string; guildId: string; closedBy: string };
  // rooms
  "room.created": { roomId: string; ownerId: string; guildId: string };
  "room.deleted": { roomId: string; guildId: string };
  // levelling
  "xp.gained": { userId: string; guildId: string; amount: number; newLevel: number | null };
  // clan
  "clan.war.started": { warId: string; attackerId: string; defenderId: string };
  // generic
  [k: `custom.${string}`]: Record<string, unknown>;
};

class TypedEventBus {
  private readonly emitter = new EventEmitter({ captureRejections: true });

  constructor() {
    this.emitter.setMaxListeners(200);
    this.emitter.on("error", (err) => log.error({ err }, "event bus listener errored"));
  }

  on<K extends keyof DomainEventMap>(
    event: K,
    listener: (payload: DomainEventMap[K]) => void | Promise<void>,
  ): void {
    this.emitter.on(event as string, listener);
  }

  off<K extends keyof DomainEventMap>(
    event: K,
    listener: (payload: DomainEventMap[K]) => void | Promise<void>,
  ): void {
    this.emitter.off(event as string, listener);
  }

  emit<K extends keyof DomainEventMap>(event: K, payload: DomainEventMap[K]): void {
    if (log.isLevelEnabled("debug")) log.debug({ event, payload }, "emit");
    this.emitter.emit(event as string, payload);
  }
}

export const eventBus = new TypedEventBus();
