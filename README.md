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
  the queued events are grouped into Discord embeds and sent to one or more
  Discord webhooks ("destinations"), each receiving only the event types it's
  subscribed to. You can also trigger a send immediately from the Live Feed
  page.

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

Run the tests with `npm test`. They cover webhook normalization (including
upgrade-delete suppression), message building and season grouping, and
delivery routing/failure handling against a throwaway database and a mock
Discord endpoint — they never touch `server/data` or real Discord. The
Docker build runs them too, so a failing test stops the image from being
built.

## Running in Docker

```bash
docker compose up -d --build
```

This builds the image and starts it on port `8080`, persisting the SQLite
database in `./data`.

This isn't published to a registry (Docker Hub, GHCR, etc.) — it's built
locally wherever you run it, including on Unraid itself (below).

## Running on Unraid

The image is built directly on the Unraid box; nothing is pulled from a
registry.

1. **Build the image on Unraid.** Open a terminal on Unraid (SSH or the
   built-in Web Terminal) and run:

   ```bash
   cd /mnt/user/appdata
   git clone https://github.com/EthanetXYZ/arr-digest.git
   cd arr-digest
   docker build -t arr-digest:latest .
   ```

   Re-run the `git pull` + `docker build` there whenever you want to update.

2. **Add the template.** Copy [my-arr-digest.xml](my-arr-digest.xml) to
   `/boot/config/plugins/dockerMan/templates-user/` on the flash share (via
   the `flash` share or the same terminal). The `my-` prefix matters — it's
   the naming convention Unraid's template scanner expects; a file without
   it won't show up in the dropdown. It then appears next time you open
   **Docker tab → Add Container → Template**.
3. Check the **Data** path (defaults to `/mnt/user/appdata/arr-digest`) and
   **WebUI Port** (defaults to `8080`), then **Apply**. Since the image only
   exists locally, leave auto-update checking off for this container —
   there's nothing to pull.
4. Open the container's WebUI and continue with **Setup** below. Use your
   Unraid server's LAN IP as the **Public URL** in Settings so the webhook
   URLs Sonarr/Radarr get are correct (see below).

Environment variables (all optional):

| Variable   | Default          | Purpose                                  |
|------------|------------------|-------------------------------------------|
| `PORT`     | `8080`           | HTTP port                                 |
| `HOST`     | `0.0.0.0`        | Bind address                              |
| `DATA_DIR` | `/app/data`       | Where the SQLite file is stored           |
| `TZ`       | container default | Host timezone (digest scheduling uses the timezone you set in-app, not this) |

All other configuration — Discord destinations, digest schedule, display
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

### 3. Add Discord destinations

In Discord: **Server Settings → Integrations → Webhooks → New Webhook**,
pick the channel, and copy the webhook URL. In this app's Settings page,
under **Discord destinations**, click **Add destination** and paste it in.

Each destination picks which events it receives (Added / Upgraded /
Removed) and which media (Movies / TV), plus an optional mention. To send
upgrades to one channel and removals to another, create one destination
per channel. Event types no enabled destination picks up aren't sent at
all, which is also how you turn a type off entirely. Use **Send test** on
a destination to post sample data to that channel.

Each destination's **Delivery** is either **Scheduled digest** (sent at the
digest times) or **Instant** (pushed as events arrive). Instant waits until
events have been quiet for 20 seconds (2 minutes at most) before sending,
because a season import arrives as one webhook per episode — this way it
still lands as a single "S01E01–E10" message rather than ten. An event that
only instant destinations want leaves the Live Feed once pushed, since it
won't be in the next digest.

If one destination fails during a digest but others succeed, the items
still count as sent (so working channels don't get duplicates on the next
run) and the failure shows as a banner on the Live Feed. If every
destination fails, the items stay queued and are retried next time.

### 4. Configure the schedule and display options

Also on the Settings page: send times (you can add more than one per day),
timezone, whether to group Movies/TV separately, compact vs. one-embed-per-item
display, and whether to skip sending when there's nothing to report.

## Live Feed

The home page shows events as they arrive from Sonarr/Radarr in real time,
with a running count of what's queued for the next digest, and a "Send
digest now" button to trigger an out-of-schedule send.
