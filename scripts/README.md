# Helper scripts

All scripts live in `scripts/`. Three things:

| Script           | What it does                                                       |
|------------------|--------------------------------------------------------------------|
| `start.bat`      | Double-click to start everything with preflight checks.            |
| `stop.bat`       | Double-click to stop all containers (data preserved).              |
| `update.ps1`     | One-liner installer / updater pulled from GitHub raw.              |

## `start.bat` / `start.ps1` — quick start with full preflight

Double-click `scripts\start.bat`, or run it from `cmd` / PowerShell. By default it
`docker compose`-s the whole stack. It performs these checks in order, and refuses
to continue past any failure:

1. **Tooling**: `git`, `node`, `pnpm`, `docker` are installed; Node ≥ 20 (warns at 26+);
   Docker Desktop daemon is reachable.
2. **`.env`**: file exists at the repo root; required keys are non-empty
   (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL`, `OWNER_IDS`). Warns if
   `SESSION_SECRET` / `JWT_SECRET` are still the example placeholders.
3. **Dependencies**: runs `pnpm install --frozen-lockfile` only when `node_modules`
   is missing or `pnpm-lock.yaml` is newer than the last install marker.
4. **Infrastructure**: `docker compose up -d postgres redis lavalink adminer` and
   waits for each to report healthy (90s timeout per service).
5. **Schema**: `prisma generate` + `prisma migrate deploy`.
6. **App**: starts `bot` + `web` containers (default), `bot` only, or two
   `pnpm bot:dev` / `pnpm web:dev` windows.

**Modes** (env override for the .bat, or `-Mode` for the .ps1):

```cmd
rem default — docker compose for everything
start.bat

rem dev windows (no docker for bot/web, but infra still in containers)
set BOT_MODE=dev
start.bat

rem only the bot container, no web
set BOT_MODE=bot
start.bat

rem follow logs after starting
set BOT_TAIL=1
start.bat
```

Or directly:

```powershell
.\scripts\start.ps1                  # docker mode
.\scripts\start.ps1 -Mode dev        # dev windows
.\scripts\start.ps1 -Tail            # tail logs after start
.\scripts\start.ps1 -SkipInstall     # skip pnpm install
.\scripts\start.ps1 -SkipMigrate     # skip prisma migrate
```

`stop.bat` runs `docker compose down`. Volumes (`postgres_data`, `redis_data`,
`lavalink_plugins`) are preserved, so your DB and Redis stay intact between runs.

## `update.ps1` — Windows / PowerShell

### One-liner — first install OR routine update

Open PowerShell (no admin needed) and run:

```powershell
iex "& { $(iwr -useb https://raw.githubusercontent.com/ambasssadorvlon/qweqweqwe/main/scripts/update.ps1) }"
```

The script is idempotent:

* If `%USERPROFILE%\discord-bot` doesn't exist yet, it clones the repo there.
* If it does exist, it fast-forwards `main` and (only if needed) reinstalls
  pnpm deps and runs `prisma migrate deploy`.
* Then it restarts the bot via **docker compose**, then **pm2**, then
  `pnpm bot:dev` — whichever it finds first.

Your `.env` is **never touched** — it is gitignored and the script never
overwrites or copies over it. The first run will print a reminder if you
haven't created `.env` yet (copy `.env.example` and fill it in).

### Custom install location

```powershell
.\scripts\update.ps1 -InstallDir 'D:\bots\production'
```

### Update only (don't restart anything)

```powershell
.\scripts\update.ps1 -NoRestart
```

### Prerequisites

The script will exit early with a clear message if any of these are missing:

| Tool   | Version | Where                                        |
|--------|---------|----------------------------------------------|
| git    | any     | <https://git-scm.com/download/win>           |
| node   | 22 LTS  | <https://nodejs.org/>                        |
| pnpm   | 9.15.1  | `npm install -g pnpm@9.15.1`                 |

Optional, but recommended for production:

* **docker** + **docker compose** — the bundled `docker-compose.yml` already
  defines `postgres`, `redis`, `lavalink`, `adminer`, `bot`, `web`.
* **pm2** — for non-docker hosts.

### What the script changes vs. what it leaves alone

| File / path                  | Action                                           |
|------------------------------|--------------------------------------------------|
| `.env`                       | **never touched** — gitignored                   |
| `node_modules/`              | rebuilt when lockfile changes                    |
| `prisma/migrations/`         | applied via `prisma migrate deploy`              |
| `data/`, `logs/`, `uploads/` | left alone (gitignored)                          |
| tracked source files         | fast-forward only; refuses to clobber edits      |
