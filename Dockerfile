# syntax=docker/dockerfile:1

# better-sqlite3 ships a native addon. Prebuilds cover linux/arm64, but the
# build stage carries a toolchain so a miss compiles instead of failing.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Reinstall production-only so the runtime image drops the dev tree but keeps
# the already-compiled native addon.
FROM node:24-bookworm-slim AS prod-deps
WORKDIR /app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
	PORT=3000 \
	HOST=0.0.0.0 \
	DATABASE_PATH=/data/app.db \
	MIGRATIONS_PATH=/app/drizzle

RUN apt-get update \
	&& apt-get install -y --no-install-recommends wget \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
# Migrations are applied at boot, so they ship with the image.
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000

# Probes /login, not /: the root now redirects to it for anonymous requests,
# and a health probe should not depend on redirect-following behaviour.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1

CMD ["node", "build/index.js"]
