import "reflect-metadata";
import { container, Lifecycle } from "tsyringe";

export { container };

/**
 * Tokens for non-class dependencies (config objects, primitives, third-party clients).
 * Resolve via `container.resolve(TOKENS.X)`.
 */
export const TOKENS = {
  Logger: Symbol("Logger"),
  Prisma: Symbol("Prisma"),
  Redis: Symbol("Redis"),
  Cache: Symbol("Cache"),
  EventBus: Symbol("EventBus"),
  DiscordClient: Symbol("DiscordClient"),
  MusicManager: Symbol("MusicManager"),
} as const;

/**
 * Registers a class as a singleton (one instance per process).
 * Decorator: `@singleton() class FooService {}`
 */
export function singleton(): ClassDecorator {
  return (target) => {
    container.register(
      target as unknown as new (...args: never[]) => unknown,
      { useClass: target as unknown as new (...args: never[]) => unknown },
      { lifecycle: Lifecycle.Singleton },
    );
  };
}
