# Discord Bot

Production-ready, multi-purpose Discord bot built as a **modular monolith** with
Node.js + TypeScript + discord.js v14 + PostgreSQL + Redis + Lavalink, plus a
React + Tailwind web panel.

Bundles, in one cohesive codebase, what would normally take 4–6 separate bots:
**music, moderation/anti-nuke, economy, clans, tickets, private rooms, voice XP,
verification, role menus, polls, casino, housing, news, events, analytics,
metaverse profiles, leaderboards** — all driven by a single Postgres schema and
sharing one Redis/event bus.

## Quick start (dev)

```bash
pnpm install
cp .env.example .env          # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, ...
docker compose up -d postgres redis lavalink adminer
pnpm prisma:generate
pnpm prisma:deploy            # apply migrations
pnpm bot:dev                  # bot in watch mode
pnpm web:dev                  # web panel on :3000
```

Adminer is on http://localhost:8080 (login: `user` / `pass`, db `bot`).
Web panel on http://localhost:3000.

## Quick start (prod)

```bash
docker compose up -d --build
```

Everything (bot, postgres, redis, lavalink, web panel, adminer) comes up.
The bot autoshards (`SHARDS=auto`) and runs background jobs in-process.

## Architecture

* `apps/bot/` — TypeScript bot, fastify HTTP for the panel, BullMQ jobs, Lavalink player.
* `apps/web/` — React + Tailwind dashboard (Discord OAuth2 via the bot API).
* `prisma/schema.prisma` — single source of truth (~40 models).
* `docker/` — Dockerfiles for bot, lavalink config.
* `docs/` — architecture, deployment, scaling, backup, logging.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and
module overview.

## What it can do

| Area | Highlights |
|---|---|
| Music | Lavalink v4, queue, skip, loop, shuffle, filters (bass/nightcore/8d/karaoke), volume, DJ roles, 24/7 mode, search across YT/YT Music/SoundCloud/Spotify. |
| Moderation | warn/mute/kick/ban/softban/purge with cases, anti-spam sliding windows, anti-raid join bursts, anti-nuke via audit log cascade detection, content/link/invite/phishing filter, autoslowmode, configurable punishments. |
| Economy | wallet + bank, daily/weekly/work/crime/rob/transfer/deposit/withdraw, hourly interest, distributed locks on every txn, rich leaderboard. |
| Clans | cross-server clans, treasury, deposits, level upgrades (1000·lvl² cost), clan top. |
| Tickets | button + dropdown opening, claim, auto-close, HTML transcript export, configurable categories. |
| Private rooms | hub-channel auto-create voice + text, owner panel (lock/hide/limit/rename/close), auto-cleanup on empty. |
| Voice XP | per-message + per-minute-in-voice XP, level rewards, /rank, /top, role rewards at thresholds. |
| Verification | button or captcha (6-char hex via DM), anti-alt account-age check, configurable role grant. |
| Roles | autoroles, reaction roles (add / remove / toggle), level rewards, temp roles. |
| Casino | slots / coinflip / blackjack with real coin stakes (locks on debits/credits). |
| Profile | global cross-server profile: level, xp, coins, reputation, prestige, equipped cosmetics. |
| Polls | up to 10 options, single/multi vote, real-time button voting. |
| Housing | buy/upgrade rooms, passive hourly income drip. |
| News | RSS feed registration; background job polls and posts. |
| Events | scheduled boss/pvp/seasonal/custom events with start/end. |
| Analytics | per-day per-user-per-channel message metrics, `/stats`. |
| Metaverse | global reputation (24h cooldown), global coin transfers, cross-server top. |
| Web panel | Discord OAuth login, dashboard, per-guild config (extendable). |

## What it intentionally does NOT have

* No Kubernetes, no microservices, no CQRS.
* No "AI everywhere" — AI hooks exist as clean interfaces with TODOs.
* No native canvas dep (rank cards are embeds, not images).

## Repo layout

```
apps/
  bot/
    src/
      core/                # DI, env, db, cache, locks, rate-limit, logger, handler, sharding
      shared/              # embeds, format, perms, ensure
      infrastructure/      # http (fastify), jobs (bullmq), lavalink
      modules/
        _core/             # lifecycle + interaction dispatcher + admin/help
        music/
        moderation/
        economy/
        tickets/
        rooms/
        voice/             # voice + levels (message XP)
        verification/
        roles/
        clans/
        polls/
        casino/
        profile/
        leaderboard/
        housing/
        news/
        events/
        analytics/
        metaverse/
  web/                     # React + Tailwind dashboard
prisma/schema.prisma
docker-compose.yml
docker/
docs/
```

See `docs/` for deployment, scaling, backup, and logging guides.
