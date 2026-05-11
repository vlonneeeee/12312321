# --- build stage ---
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile=false

COPY apps/web ./apps/web
RUN pnpm --filter @bot/web build

# --- runtime stage ---
FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
