# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder
WORKDIR /app

# python3/make/g++ let better-sqlite3 fall back to a source build if no
# prebuilt binary matches the target platform (e.g. some Unraid/arm hosts).
# git is only used below to stamp the build with a commit SHA -- it never
# ends up in the runtime image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm install

COPY . .
# A failing test stops the image build, so a broken change never replaces
# a working container -- the previous image keeps running.
RUN npm test
RUN npm run build

# Bakes in what was actually built, so it's possible to tell from the
# running app whether an Unraid rebuild picked up the latest code -- a
# mismatch here (checked against `git log` on GitHub) means the rebuild
# didn't actually happen or pulled the wrong commit.
RUN { \
      echo "{" ; \
      echo "  \"commit\": \"$(git rev-parse --short HEAD 2>/dev/null || echo unknown)\"," ; \
      echo "  \"builtAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"" ; \
      echo "}" ; \
    } > /app/version.json

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    WEB_DIST=/app/web/dist

COPY --from=builder /app/node_modules ./node_modules
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
