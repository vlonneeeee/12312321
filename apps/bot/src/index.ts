import "reflect-metadata";
import { createBot, shutdownBot } from "@core/bot";
import { logger } from "@core/logger/logger";

let clientRef: import("discord.js").Client | undefined;

async function main() {
  process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "unhandledRejection"));
  process.on("uncaughtException", (err) => logger.error({ err }, "uncaughtException"));

  clientRef = await createBot();
}

const onSignal = (signal: NodeJS.Signals) => {
  logger.warn({ signal }, "signal received, shutting down");
  shutdownBot(clientRef).finally(() => process.exit(0));
};

process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

main().catch((err) => {
  logger.fatal({ err }, "fatal startup error");
  process.exit(1);
});
