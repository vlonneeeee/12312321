import pino, { Logger } from "pino";
import { env } from "@core/config/env";

const transport = env.isDev
  ? {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
        singleLine: false,
      },
    }
  : undefined;

export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "bot", env: env.NODE_ENV },
  redact: {
    paths: [
      "*.token",
      "*.password",
      "*.authorization",
      "config.token",
      "config.DISCORD_TOKEN",
      "headers.authorization",
    ],
    censor: "[REDACTED]",
  },
  transport,
});

export function child(name: string, meta: Record<string, unknown> = {}): Logger {
  return logger.child({ scope: name, ...meta });
}
