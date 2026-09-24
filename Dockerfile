# syntax=docker/dockerfile:1

# Multi-arch (amd64 + arm64). The builder stage always runs on the build
# machine's own architecture ($BUILDPLATFORM), so installing, testing and
# compiling happen natively even when producing an arm64 image on an amd64
# CI runner -- only the small production-deps stage runs under emulation.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS builder
WORKDIR /app

# python3/make/g++ let better-sqlite3 fall back to a source build if no
# prebuilt binary matches. git is only used below to stamp the build with a
# commit SHA -- it never ends up in the runtime image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

COPY . .
# A failing test stops the image build, so a broken change never replaces
# a working container -- the previous image keeps running.
RUN npm test
RUN npm run build

# Bakes in what was actually built, so it's possible to tell from the
# running app whether an update picked up the latest code.
RUN { \
      echo "{" ; \
      echo "  \"commit\": \"$(git rev-parse --short HEAD 2>/dev/null || echo unknown)\"," ; \
      echo "  \"builtAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"" ; \
      echo "}" ; \
    } > /app/version.json

# Production dependencies for the TARGET architecture (better-sqlite3 is a
# native module, so it can't be copied from the builder). Server deps only:
# the web UI is already compiled to static files.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev --workspace server

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    WEB_DIST=/app/web/dist

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/version.json ./version.json

VOLUME ["/app/data"]
EXPOSE 8080

# Uses Node's built-in fetch rather than curl/wget, which this slim image
# doesn't include.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
