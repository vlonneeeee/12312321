import { PrismaClient } from "@prisma/client";
import { env } from "@core/config/env";
import { child } from "@core/logger/logger";

const log = child("db");

export const prisma = new PrismaClient({
  log: env.isDev
    ? [
        { emit: "event", level: "query" },
        { emit: "event", level: "warn" },
        { emit: "event", level: "error" },
      ]
    : [
        { emit: "event", level: "warn" },
        { emit: "event", level: "error" },
      ],
  errorFormat: env.isDev ? "pretty" : "minimal",
});

prisma.$on("warn", (e) => log.warn({ msg: e.message, target: e.target }));
prisma.$on("error", (e) => log.error({ msg: e.message, target: e.target }));

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  log.info("Postgres connected");
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  log.info("Postgres disconnected");
}
