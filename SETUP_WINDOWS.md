# Setup Discord-бота на Windows (с фиксами)

В этом архиве уже применены:
- `apps/bot/src/infrastructure/jobs/scheduler.ts` — переименована BullMQ-очередь `bot:jobs` → `bot-jobs`
- `apps/bot/src/core/handler/registry.ts` — `pathToFileURL()` для ESM dynamic import на Windows
- `apps/bot/src/modules/analytics/analytics.events.ts` — `ensureMember()` перед `MessageMetric.upsert`
- `apps/bot/src/modules/_core/interaction.events.ts` — диагностический лог `interaction received`
- `apps/bot/src/core/bot.ts` — диагностические listener'ы для shard/gateway событий
- `docker-compose.yml` — `user: root` для Lavalink (фиксит permission denied на plugins volume)

## Перед началом — обязательно проверь версию Node

```powershell
node --version
```

Должно быть **`v22.x.x`** (Node 22 LTS). Если у тебя `v26.x.x` или новее — **обязательно** установи Node 22 LTS:

https://nodejs.org/en/download → выбери LTS → Windows Installer (.msi) → установить → закрой и открой PowerShell заново.

Node 26+ имеет несовместимости с `@discordjs/ws` и `ws` — gateway-соединение установится, но события (включая `interactionCreate`) не будут доходить до handler'ов.

## Шаг 1. Подготовь папку

1. Останови старый бот (`Ctrl+C` в окне `pnpm bot:dev`, ответь `Y`).
2. Убей все node-процессы:
   ```powershell
   Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
   ```
3. Сохрани свой `.env` файл из старой папки в безопасное место (просто скопируй на рабочий стол).
4. Распакуй этот архив в `C:\Users\Admin\Desktop\discord-bot-new\` (или любую папку без пробелов в пути).
5. Скопируй сохранённый `.env` в корень новой папки.

## Шаг 2. Установи зависимости

```powershell
cd C:\Users\Admin\Desktop\discord-bot-new
pnpm install
```

## Шаг 3. Подними Docker-сервисы

Если контейнеры от старой папки ещё крутятся — останови их:
```powershell
cd C:\Users\Admin\Desktop\discordbot
docker compose down
```

Удали том с плагинами Lavalink (там кэш битых прав):
```powershell
docker volume rm discord-bot_lavalink_plugins
```
Если ругается `volume in use` — `docker volume rm -f discord-bot_lavalink_plugins`.

Запусти сервисы в новой папке:
```powershell
cd C:\Users\Admin\Desktop\discord-bot-new
docker compose up -d postgres redis lavalink adminer
```

Подожди ~60 секунд для Lavalink. Проверь:
```powershell
docker compose ps
```
Все 4 контейнера должны быть `Up (healthy)`. Если Lavalink `Restarting` — пришли `docker compose logs --tail=50 lavalink`.

## Шаг 4. Prisma миграции

Если у тебя в `apps/bot/` уже есть `.env` (или ты копировал в корень) — нормально. Иначе:
```powershell
copy .env apps\bot\.env
```

Затем:
```powershell
pnpm prisma:generate
pnpm prisma:migrate
```
На вопрос имени миграции — введи `init` если первый раз, либо просто Enter.

## Шаг 5. Запусти бота

```powershell
pnpm bot:dev
```

Дождись в логе:
```
INFO: client ready  tag: "Test bot by aura#7695"  guilds: 1
INFO: background jobs scheduled  count: 9
INFO: guild slash commands deployed  count: 61
```

## Шаг 6. Тест

В Discord:
1. Нажми `Ctrl+R` (перезагрузка клиента) — гарантирует свежий кэш команд.
2. В канале набери `/ping` → Enter.
3. Подожди 3 секунды.

В терминале бота должно появиться:
```
[XX:XX:XX] INFO: raw gateway: INTERACTION_CREATE
[XX:XX:XX] INFO: interaction received  type: 2  name: "ping"  user: "..."
```

**Если эти строки появились** — бот работает, команды отвечают.

**Если их нет** — это явное доказательство несовместимости Node с `discord.js`. Двойная проверка: `node --version` → должно быть `v22.x.x`. Если `v24+` — переустанавливай Node 22 LTS.

## Известные проблемы

### `Used disallowed intents`
В Discord Developer Portal → выбери приложение → Bot → Privileged Gateway Intents → включи все 3:
- Presence Intent
- Server Members Intent  
- Message Content Intent

### Команды видны но не отвечают
1. Убей все node-процессы: `Get-Process node | Stop-Process -Force`
2. Запусти бота заново: `pnpm bot:dev`
3. Жди `guild slash commands deployed count: 61`
4. `Ctrl+R` в Discord
5. Тестируй

### Команд нет в Discord-клиенте
- Проверь что в `.env` `DEV_GUILD_IDS=` равен ID сервера где ты тестируешь (ПКМ по серверу → Копировать ID)
- Если бота не приглашал через `applications.commands` scope: открой Developer Portal → OAuth2 → URL Generator → отметь `bot` и `applications.commands` → внизу скопируй URL → открой в браузере → выбери свой сервер → Authorize. Затем перезапусти бота.
