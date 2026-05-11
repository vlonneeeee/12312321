# Architecture

> Production-ready Discord bot that intentionally **bundles** 19+ feature areas
> into one modular monolith. No microservices, no Kubernetes. Designed to be
> operated and extended by a small team.

## Stack

* **Node 20+, TypeScript 5.6 strict**, ESM via tsx for dev / tsc for prod.
* **discord.js v14.16** (gateway + REST).
* **PostgreSQL 16** via **Prisma 5.22** — single source of truth.
* **Redis 7** for cache, sliding-window rate limits, locks, OAuth state, voice-XP sessions, captcha codes.
* **Lavalink v4** for audio (search across YouTube / YT Music / SoundCloud / Spotify; built-in filters).
* **BullMQ 5** (Redis-backed) for recurring jobs.
* **Fastify 5** HTTP for the web panel API + Discord OAuth callback.
* **TSyringe** for DI (constructor injection, singletons).
* **Zod** for env validation, Pino for structured logging.

## High-level shape

```
                              ┌───────────────────────┐
                              │      Lavalink         │
                              └──────────▲────────────┘
                                         │ ws
┌────────────┐  gateway  ┌──────────────────────────────────────┐
│  Discord   │◀─────────▶│             Bot process              │
│  shards    │   REST    │   discord.js  +  Fastify  + BullMQ   │
└────────────┘           │      │            │           │      │
                         │      ▼            ▼           ▼      │
                         │  PostgreSQL    Redis      Jobs queue │
                         │   (Prisma)     (cache,     (bullmq)  │
                         │                locks,                │
                         │                ratelim)              │
                         └──────────▲───────────────▲───────────┘
                                    │ HTTPS          │ Redis
                              ┌─────┴───────┐  ┌─────┴─────┐
                              │  Web panel  │  │  Adminer  │
                              │   (React)   │  │   (DB UI) │
                              └─────────────┘  └───────────┘
```

In dev the bot runs as a single Node process; in prod
`ShardingManager` autoshards horizontally inside that process.

## Modular monolith

Each domain lives under `apps/bot/src/modules/<name>/` and exports:

* `*.commands.ts`  — slash commands and component handlers (`SlashCommand`, `ButtonHandler`, `SelectHandler`, `ModalHandler`).
* `*.events.ts`    — Discord gateway listeners (`messageCreate`, `voiceStateUpdate`, …).
* `*.service.ts`   — business logic (uses Prisma + Redis + locks). DI-resolvable.

The **registry** (`core/handler/registry.ts`) loads every module's exports by
discovering files and indexing handlers by name / customId. No registration
boilerplate. This is the closest you get to "plugins" without paying the cost
of separate processes.

## Event-driven core

`core/events/event-bus.ts` is a typed EventEmitter for **internal** domain
events (not Discord events):

```
economy.transaction   { userId, guildId, kind, amount, delta }
moderation.case       { caseId, guildId, action, targetId, ... }
ticket.created        { ticketId, guildId, channelId, openerId }
room.deleted          { roomId, guildId }
```

Modules subscribe in their `*.events.ts` files to e.g. write audit logs,
push to analytics, or trigger achievements — without coupling.

## Service layer + repositories

Business logic lives in services (`EconomyService`, `ModerationService`,
`ClanService`, `TicketService`). They:

* Use Prisma as the repository — no separate DAO layer; Prisma client *is* the typed repository.
* Wrap critical sections in **distributed locks** (Redis SETNX with TTL).
* Emit domain events via the event bus.
* Throw `UserFacingError` for messages the user should see; all other errors are logged and become "Something went wrong".

DI via TSyringe lets us swap implementations in tests, but we keep usage
minimal — most services are simple singletons constructed in `core/container/container.ts`.

## Database — Prisma

Single schema (`prisma/schema.prisma`) covers:

* **Global / metaverse**: `User`, `WebSession`.
* **Guilds**: `Guild` (per-guild config flags + premium), `GuildMember` (xp, coins, bank, last activity).
* **Music**: `MusicQueue`, `MusicHistoryItem`.
* **Moderation**: `Case`, `Warning`, `Mute`, `AntiSpamConfig`, `AntiRaidConfig`, `AntiNukeConfig`, `ContentFilter`.
* **Economy**: `Transaction`, `Cooldown`, `Business`.
* **Clans**: `Clan`, `ClanMember`, `ClanLog`.
* **Tickets**: `Ticket`, `TicketCategory`, `TicketTranscript`.
* **Rooms**: `PrivateRoom`, `RoomHub`.
* **Roles**: `ReactionRole`, `AutoRole`, `LevelReward`, `TempRole`.
* **Voice**: `VoiceSession`.
* **Verification**: `VerifyConfig`, `VerifyAttempt`.
* **Polls**: `Poll`, `PollOption`, `PollVote`.
* **Housing**: `Housing`.
* **News**: `NewsFeed`, `NewsItem`.
* **Events**: `ScheduledEvent`.
* **Analytics**: `MessageMetric`.
* **Cosmetics**: `Cosmetic`, `UserCosmetic`.
* **Reputation**: `ReputationGiven`.

Indexes are pre-set on every hot path: `(guildId, userId)`, `(guildId, createdAt)`, etc.

## Caching, rate-limits, locks (Redis)

`core/cache/redis.ts` — ioredis client + namespaced `Cache` helper.

* **Cache wrap**: `cache.wrap(key, ttl, fn)` for read-through caching.
* **Rate limit**: `core/ratelimit/rate-limiter.ts` — Redis sorted-set sliding window. Used per-user per-command (default 5/5s) plus per-feature throttles (anti-spam ZSET counts).
* **Distributed locks**: `core/locks/distributed-lock.ts` — SETNX + TTL + random token. `withLock(key, ttlMs, fn)` is the standard wrapper. Used on:
  * every economy transaction (`econ:lock:user:<id>:guild:<id>`),
  * clan deposit / upgrade,
  * ticket creation (prevents duplicate channels),
  * room creation (prevents duplicate channels on the same hub join).

All keys are prefixed `bot:` for shared Redis safety.

## Sharding

`core/sharding/sharding.ts` uses `ShardingManager`:

```
SHARDS=auto   (default in prod)
SHARDS=1      (default in dev)
```

In single-shard dev mode we spawn one shard directly to keep stack traces clean.

## Background jobs (BullMQ)

`infrastructure/jobs/scheduler.ts` registers recurring jobs:

| Job | Cadence | Purpose |
|---|---|---|
| `temp-roles` | 1m | revoke expired `TempRole`s. |
| `mute-expiry` | 1m | unmute users whose `Mute.expiresAt` has passed. |
| `jail-release` | 1m | release crime/jail entries. |
| `business-income` | 5m | drip business passive income. |
| `room-cleanup` | 1m | delete empty `PrivateRoom`s + their channels. |
| `news-fetch` | 10m | poll `NewsFeed`s and post new items. |
| `scheduled-messages` | 30s | post any due scheduled messages. |
| `interest` | 1h | accrue bank interest at the configured APR. |
| `voice-xp-flush` | 1m | flush per-user voice-time XP from Redis to DB. |

The queue is `bot-jobs`. Single worker with concurrency 4; safe because each
job is idempotent (operates on `expiresAt < now()` etc.).

## Music

`infrastructure/lavalink/manager.ts` exposes a single `LavalinkManager` for
`lavalink-client`. The bot forwards Discord voice updates via `client.on("raw")`.
Player options: auto-skip on resolve error, auto-reconnect on voice
disconnect, destroy after 30s of empty queue (unless 24/7 mode is set in
`MusicQueue`).

`MusicService` enforces DJ-only mutating commands via `shared/utils/perms.ts`
(`isDj`) — anyone can skip their own track, otherwise DJ role is required.

## Moderation

Three layered systems running off `messageCreate` / `guildMemberAdd` /
`guildAuditLogEntryCreate`:

1. **Antispam** (`antispam.events.ts`): Redis ZSET sliding window per `user:guild`.
   Detects message-rate floods, duplicate-content spam, mention spam, invite
   spam, link spam. Punishment escalates: `warn → mute → kick → ban` per
   `AntiSpamConfig`.

2. **Antiraid** (`antiraid.events.ts`): Redis ZSET join tracker per guild. If
   N joins land within window AND accounts are younger than threshold, applies
   `kick_new` / `ban_new` / `lockdown` (server-wide verification level bump)
   per `AntiRaidConfig`.

3. **Antinuke** (`antinuke.events.ts`): Audit-log watcher. Detects rapid
   channel deletes, role deletes, mass bans, and mass kicks per executor.
   Above threshold → executor punished, optionally rolled back via cached
   originals.

4. **Content filter** (`content-filter.events.ts`): `ContentFilter` rows per
   guild — invite/link/word/regex/extension/mention. Built-in phishing
   detection for common lookalike domains. Per-rule action (warn/mute/ban).

5. **Manual mod** (`moderation.commands.ts` + `moderation.service.ts`):
   warn / mute (≤28d via timeout) / kick / ban (with `delete_message_days`) /
   softban / purge / cases history. Every action goes through
   `ModerationService.createCase`, role-hierarchy-checked, locked,
   audit-logged.

## Economy

`EconomyService` is the only writer of `GuildMember.coins` and
`GuildMember.bank`. Every mutating method:

1. Acquires `withLock("econ:user:<user>:guild:<guild>")` (TTL 5s, retries).
2. Reads current balance.
3. Applies the rule (cap at 0 for debits; bank caps for deposits; etc.).
4. Writes via Prisma `update`.
5. Inserts a `Transaction` row (kind, delta, balanceAfter, source).
6. Emits `economy.transaction`.

Defaults (override via DB):

* daily 500, weekly 5000, work 50-350 (5m cd), crime 100-800 (40% success, 30m cd, fine on fail), rob 20% of target balance (40% success, ≥1h cd), bank APR 1% per real day.

This makes auditing trivial: every coin movement has a row.

## Voice XP & levels

* `voice.events.ts` — on `voiceStateUpdate`, store `startedAt` and `channelId`
  in a Redis hash (`voicexp:session:<guildId>:<userId>`) with 12h TTL. On leave,
  write a `VoiceSession` row.
* `voice-xp-flush` (BullMQ) — every minute, sweep active sessions, atomically
  increment `GuildMember.voiceMinutes` and `xp`. No write-spam.
* `levels.events.ts` — per-message XP (5-15) with 60s cooldown. Calculates
  level from xp using `5·lvl² + 50·lvl + 100` per level. Triggers level-up
  embed and role rewards.

## Private rooms (voice hubs)

* Hub channel ids stored in `RoomHub`. On `voiceStateUpdate`, joining a hub
  triggers `withLock("room:create:<guildId>:<userId>")` → bot creates a voice
  channel and (optionally) a private text channel with `permissionOverwrites`
  granting the owner manage perms. Both are linked in `PrivateRoom`.
* Owner control panel = 5 buttons: lock, hide, limit (modal), rename (modal), close.
* `room-cleanup` job deletes empty rooms every minute.

## Tickets

* `/ticket-panel` posts a button + (optional) category dropdown.
* On click, `TicketService.openTicket` acquires `withLock("ticket:open:<guildId>:<userId>")`,
  ensures no open ticket from same user, creates a text channel with
  overrides for opener + staff role.
* `claim` records `claimedById` and pings staff; `close` writes a
  full HTML transcript to `transcripts/` and stores the path on
  `Ticket.transcriptUrl`, then deletes the channel.

## Verification

* `/verify-setup` configures role + channel + mode (button | captcha).
* Button click: if mode=button, grants role immediately. If mode=captcha,
  generates a 6-char hex code, stores in Redis (`captcha:<userId>` TTL 180s),
  DMs the user; the message-listener checks DMs against pending codes and
  grants the role on match. `VerifyAttempt` rows track failures for anti-alt.

## Web panel

* React + Vite + Tailwind, single SPA (`apps/web`).
* `/auth/login` redirects to Discord OAuth; `/auth/callback` exchanges code,
  upserts `User`, creates `WebSession`, returns `?token=…` and a `Set-Cookie`.
* Subsequent API calls send `Authorization: Bearer <token>`. `auth.ts`,
  `stats.ts`, `guilds.ts` are wired; extending is just adding a route file
  and registering it.

## Security & anti-abuse summary

* All mutating economy / clan / room / ticket flows wrapped in distributed locks.
* All slash commands rate-limited (5/5s default; configurable per command).
* `staffRoleIds` on `Guild` gates mod commands — `shared/utils/perms.ts::isStaff`.
* `RoleHierarchy` is checked on every mod action before applying.
* `WebSession` is bearer-token, scoped per-IP/UA snapshot, 30d sliding.
* Inputs are bounded (Discord max lengths) and validated; SQL via Prisma (no raw concat).
* Phishing domain list + content filter regex/patterns evaluated on `messageCreate`.

## Scaling

* Vertical first — one process, one shard pool, autosharding handles ≤2.5k guilds easily on modern hardware. The single-process design makes everything Postgres + Redis can do.
* Horizontal — adding a replica is "run another bot container with different shard ids" + same Postgres + same Redis. ShardingManager supports this via env vars.
* Postgres — index hot paths (already done in schema); enable `pg_stat_statements` and add specific covering indexes on slow queries; vacuum/autovacuum tuning if `Transaction` grows large.
* Redis — separate Redis instance for cache vs queue if QPS warrants it (BullMQ supports it via `connection` config).

## Logging

Pino with `pino-pretty` in dev. Child loggers per area (`music`, `moderation`, `economy`, …). Each command/event log is structured: `{ guildId, userId, command }`. In prod ship to Loki/Vector/anything that reads stdout JSON.

## Backups

* Postgres: `pg_dump -Fc` nightly into S3 (or any object store). Retain 30 daily + 12 weekly + 12 monthly. Encryption at rest by your storage provider.
* Redis: ephemeral by design. The only data we don't tolerate losing is in Postgres. Anti-spam counters, locks, captcha codes, voice sessions are all rebuilt from incoming events within a minute or two.
* Lavalink: stateless.
* Transcripts: shipped to S3 (or kept on a volume); path recorded in `Ticket.transcriptUrl`.

A sample backup script lives at `scripts/backup.sh`.
