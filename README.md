# Arr Digest

A self-hosted digest bot for Sonarr and Radarr. It listens for their webhook
notifications, tracks additions/upgrades/removals as they happen, shows them
live in a web UI, and posts a scheduled summary to Discord.

Removals caused by an upgrade (the old file being replaced by a better one)
are automatically suppressed so they don't also show up as a "removed" item —
only genuine deletions (manual, missing from disk, etc.) are reported as
removals.

## How it works

- Sonarr/Radarr are configured with a **Webhook** connection pointing at this
  app. On import, delete, or upgrade, they POST an event here in real time.
- Events are normalized, stored in SQLite, pushed to any open **Live Feed**
  page over WebSocket, and queued for the next digest.
- On a schedule you configure (one or more times a day, in your timezone),
  the queued events are grouped into Discord embeds and sent to a Discord
  webhook. You can also trigger a send immediately from the Live Feed page.

## Stack

- Backend: Node.js + TypeScript, Fastify, better-sqlite3 via Drizzle ORM,
  `croner` for scheduling.
- Frontend: React + TypeScript + Vite + Tailwind.
- Single Docker image serves the built frontend and the API together.

## Local development

Requires Node 22+.

```bash
npm install
npm run dev
```

This runs the Fastify API on `:8080` and the Vite dev server (with API/WS
proxying) on `:5173`. Open `http://localhost:5173`.

The SQLite database is created at `server/data/digest.sqlite` on first run.

## Running in Docker (e.g. Unraid)

```bash
docker compose up -d --build
```

This builds the image and starts it on port `8080`, persisting the SQLite
database in `./data`. On Unraid, point the container's `/app/data` mapping
at an appdata share and expose port 8080 like any other container.

Environment variables (all optional):

| Variable   | Default          | Purpose                                  |
|------------|------------------|-------------------------------------------|
| `PORT`     | `8080`           | HTTP port                                 |
| `HOST`     | `0.0.0.0`        | Bind address                              |
| `DATA_DIR` | `/app/data`       | Where the SQLite file is stored           |
| `TZ`       | container default | Host timezone (digest scheduling uses the timezone you set in-app, not this) |

All other configuration — Discord webhook URL, digest schedule, display
options — is done through the web UI, not environment variables, so it can
be changed without restarting the container.

## Setup

### 1. Open the web UI and go to Settings

It's at `http://<host>:8080` (or `:5173` in dev). The **Settings** page shows
two webhook URLs, one for Sonarr and one for Radarr, each with a unique
token baked in — no login is required for the app itself, so this token is
what keeps random requests on your network from injecting fake events.

> Copy these URLs using the address your Sonarr/Radarr containers can
> actually reach (e.g. the Docker host's LAN IP), not `localhost`, if they
> run in separate containers.

### 2. Add the webhook to Sonarr and Radarr

In each app: **Settings → Connect → Add → Webhook**

- **URL**: paste the corresponding URL from this app's Settings page
- **Method**: `POST`
- **Triggers**: enable **On Import**, **On Upgrade**, and **On File Delete**
  - `On Upgrade` is a separate trigger from `On Import`, not implied by it —
    without it, Sonarr/Radarr never sends the event at all when a file is
    replaced by a better one, so upgrades silently vanish.
  - `On File Delete for Upgrade` is *not* needed. This app already learns
    about the replaced file from the paired Upgrade event, and deliberately
    ignores the delete-for-upgrade event so it isn't double-counted as a
    removal.
  - Other triggers (On Grab, On Rename, etc.) are ignored by this app —
    fine to leave them off.

Use the **Test** button in Sonarr/Radarr to confirm connectivity — it should
return success immediately without creating any events.

### 3. Add a Discord webhook

In Discord: **Server Settings → Integrations → Webhooks → New Webhook**,
pick the channel, copy the webhook URL, and paste it into this app's
Settings page.

### 4. Configure the schedule and display options

Also on the Settings page: send times (you can add more than one per day),
timezone, whether to group Movies/TV separately, compact vs. one-embed-per-item
display, and whether to skip sending when there's nothing to report.

## Live Feed

The home page shows events as they arrive from Sonarr/Radarr in real time,
with a running count of what's queued for the next digest, and a "Send
digest now" button to trigger an out-of-schedule send.
