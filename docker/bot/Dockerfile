# --- build stage ---
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ cairo-dev pango-dev jpeg-dev giflib-dev pixman-dev pkgconfig
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/bot/package.json apps/bot/
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile=false

COPY apps/bot ./apps/bot
COPY prisma ./prisma
RUN pnpm --filter @bot/core prisma:generate
RUN pnpm --filter @bot/core build

# --- runtime stage ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache cairo pango jpeg giflib pixman tini
RUN corepack enable

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/bot/package.json apps/bot/
COPY --from=builder /app/apps/bot/dist apps/bot/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/bot/node_modules apps/bot/node_modules
COPY --from=builder /app/prisma ./prisma

EXPOSE 3001

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/bot/dist/index.js"]
