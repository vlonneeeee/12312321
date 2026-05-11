# Deployment

The whole stack is a single `docker compose up -d --build`. Containers:

| Service | Image / Build | Notes |
|---|---|---|
| `bot` | `docker/bot/Dockerfile` | Node 20, runs `node dist/index.js`. Health endpoint `/health` on `HTTP_PORT`. |
| `web` | served by `bot` static or your CDN | After `pnpm web:build`, drop `apps/web/dist` behind nginx/Caddy. |
| `postgres` | `postgres:16-alpine` | Volume `db` mounted at `/var/lib/postgresql/data`. |
| `redis` | `redis:7-alpine` | `--appendonly yes`. Volume `redis`. |
| `lavalink` | `ghcr.io/lavalink-devs/lavalink:4` | Config at `docker/lavalink/application.yml`. |
| `adminer` | `adminer:latest` | Port 8080. DB admin UI. |

## Env

Copy `.env.example` to `.env` and fill in. Required:

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=        # web panel OAuth
DATABASE_URL=postgresql://user:pass@postgres:5432/bot?schema=public
REDIS_URL=redis://redis:6379
LAVALINK_HOST=lavalink
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass
DASHBOARD_URL=http://localhost:3000
HTTP_PORT=3001
SHARDS=auto                   # or a number
LOG_LEVEL=info
NODE_ENV=production
```

## First-time setup

```bash
docker compose up -d postgres redis lavalink adminer
pnpm install
pnpm prisma:generate
pnpm prisma:deploy             # runs migrations
docker compose up -d --build bot
```

## Updates

```bash
git pull
pnpm install
pnpm prisma:deploy
docker compose up -d --build bot
```

Migrations are forward-only. To revert, restore from `scripts/backup.sh`.

## Health & probes

* HTTP: `GET /health` returns `{ ok: true }` and 200 once bot is ready.
* Compose `depends_on` healthchecks gate the bot on Postgres + Lavalink.
* Crash-loop: pino logs to stdout; capture via Docker or your log agent.

## Production hardening

* Run Postgres on its own host (or managed) once you outgrow ~100k transactions/day.
* Pin Lavalink resources (`--memory=512m` for typical small servers).
* Put Cloudflare or nginx in front of the web panel.
* Rotate the Discord bot token via the Developer Portal if it's ever leaked.
* Run `scripts/backup.sh` nightly via cron on the Postgres host.

## Scaling

Single-process is enough up to ~2.5k guilds. Beyond that:

1. Set `SHARDS=auto` and give the process more cores/RAM. discord.js will autoshard.
2. If you outgrow a single Node, split into two replicas with disjoint shard ids:
   * Replica A: `SHARD_LIST=0,1,...` `SHARD_COUNT=N`
   * Replica B: `SHARD_LIST=...` `SHARD_COUNT=N`
   * Both connect to the **same** Postgres and **same** Redis.
3. BullMQ workers are safe to run from any replica; just don't duplicate the scheduler (it uses a single recurring jobId so it's idempotent — but only schedule it once at boot).
4. Lavalink horizontally: add more nodes to `infrastructure/lavalink/manager.ts`'s `nodes` array. `lavalink-client` will load-balance.
