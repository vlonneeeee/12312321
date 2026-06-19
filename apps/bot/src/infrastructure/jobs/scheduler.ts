import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type { Client } from "discord.js";
import { env } from "@core/config/env";
import { child } from "@core/logger/logger";
import { runTempRoleExpiry } from "./jobs/temp-roles";
import { runMuteExpiry } from "./jobs/mute-expiry";
import { runJailRelease } from "./jobs/jail-release";
import { runBusinessIncome } from "./jobs/business-income";
import { runRoomCleanup } from "./jobs/room-cleanup";
import { runNewsFetch } from "./jobs/news-fetch";
import { runScheduledMessages } from "./jobs/scheduled-messages";
import { runInterestAccrual } from "./jobs/interest";
import { runVoiceXpFlush } from "./jobs/voice-xp-flush";

const log = child("jobs");

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const QUEUE_NAME = "bot-jobs";

type JobName =
  | "temp-roles"
  | "mute-expiry"
  | "jail-release"
  | "business-income"
  | "room-cleanup"
  | "news-fetch"
  | "scheduled-messages"
  | "interest"
  | "voice-xp-flush";

const queue = new Queue(QUEUE_NAME, { connection });
let worker: Worker | undefined;

const RECURRING: Array<{ name: JobName; every: number }> = [
  { name: "temp-roles", every: 60_000 },
  { name: "mute-expiry", every: 60_000 },
  { name: "jail-release", every: 60_000 },
  { name: "business-income", every: 5 * 60_000 },
  { name: "room-cleanup", every: 60_000 },
  { name: "news-fetch", every: 10 * 60_000 },
  { name: "scheduled-messages", every: 30_000 },
  { name: "interest", every: 60 * 60_000 },
  { name: "voice-xp-flush", every: 60_000 },
];

export async function startBackgroundJobs(client: Client): Promise<void> {
  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      switch (job.name as JobName) {
        case "temp-roles":
          return runTempRoleExpiry(client);
        case "mute-expiry":
          return runMuteExpiry(client);
        case "jail-release":
          return runJailRelease(client);
        case "business-income":
          return runBusinessIncome();
        case "room-cleanup":
          return runRoomCleanup(client);
        case "news-fetch":
          return runNewsFetch(client);
        case "scheduled-messages":
          return runScheduledMessages(client);
        case "interest":
          return runInterestAccrual();
        case "voice-xp-flush":
          return runVoiceXpFlush();
        default:
          log.warn({ name: job.name }, "unknown job");
      }
    },
    { connection, concurrency: 4 },
  );

  worker!.on("failed", (job, err) =>
    log.error({ err, job: job?.name }, "background job failed"),
  );

  for (const { name, every } of RECURRING) {
    await queue.add(
      name,
      {},
      {
        repeat: { every },
        jobId: `recurring:${name}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }
  log.info({ count: RECURRING.length }, "background jobs scheduled");
}

export async function stopBackgroundJobs(): Promise<void> {
  await worker?.close();
  await queue.close();
  connection.disconnect();
}
