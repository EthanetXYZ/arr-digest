# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder
WORKDIR /app

# python3/make/g++ let better-sqlite3 fall back to a source build if no
# prebuilt binary matches the target platform (e.g. some Unraid/arm hosts).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm install

COPY . .
RUN npm run build

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

VOLUME ["/app/data"]
EXPOSE 8080

CMD ["node", "server/dist/index.js"]
