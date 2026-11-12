# Architecture and security

How Bots for OpenCode runs, and how it keeps your machine private.

## How it runs

```text
Phone / browser
  │  https://bots.<hostname>   (OpenTunnel)
  ▼
Web app  127.0.0.1:49384       prebuilt; serves the UI, proxies /api, sends Web Push
  │
  ▼
OpenCode background service    the one Desktop uses
  ├─ plugin, every location:   keeps one web app process running
  ├─ plugin, bot workspace:    bot tools, persona and memory, library, scheduler, RPC
  └─ Desktop GUI:              Settings → Bots
```

The web app ships prebuilt and runs on the Bun runtime inside OpenCode, so there
is nothing else to install. It is a child of the OpenCode service and is
restarted within seconds if it exits. It finds the service on its own and needs
no password. Plugin instances in other locations do nothing else, so classic
sessions get no bot persona.

OpenCode unloads a location after an hour without session activity, disposing
its plugin instance; the web app stops when the last instance releases it. So
every instance makes sure the bot workspace's `.opencode/opencode.json` sets
`experimental.location_idle_timeout: false` (unless the user set a value), and
the bot workspace, its scheduler, and the web app stay up while idle.

The bot-workspace plugin runs the task and job schedule itself, checking every
20 seconds; OpenCode's native schedules are off by default and not exposed to
plugins. A due job or task wakes its bot with a synthetic message in the bot's
own session (`delivery: "queue"`, `resume: true`), tagged `botsJob` or
`botsTask` in its metadata. That tag is how the app draws the collapsible note,
how notifications are titled, and how `bots_send` treats the scheduled prompt
as the current message. Each run is saved to `bots.json` before the bot is
woken, so a restart can't fire it twice.

Project workers are ordinary top-level sessions, not child sessions. `bots_worker`
calls `session.create` with only a title, `location: { directory }`, and an
optional agent: no `parentID`, model, or permissions. The session therefore
belongs to the target location, which loads that project's own config,
`AGENTS.md`, agents, skills, and MCP servers. The bot-workspace plugin instance
only knows the session by ID: it prompts it (`delivery: "queue"`), waits on it,
reads its context, and interrupts or removes it, and its persona and library
hooks never match it. The plugin instance in the worker's location does nothing
beyond the web host, as in any other location. `bots.json` keeps only the index
(`workers`: ID, owner bot, session ID, directory, title); deleting a bot drops
its entries but leaves the sessions.

`bots_history` reads conversations from OpenCode's own database and keeps no
copy or index. The plugin's `session.context` returns only what follows the
latest compaction, so the plugin finds the background service the way the web
app does (`Service.discover`, with its credentials) and pages through the
service's `message.list` (200 per page, oldest first). Only user, bot, and
synthetic text is kept; a user message with `fromBot` metadata is labelled as
another bot's. Search is a case- and accent-insensitive term match in memory,
ranked by terms matched, then recency. Output is capped: 8 excerpts of about
300 characters per search, and 13 messages of up to 1,200 characters (8,000 in
all) per read. If the service can't be reached, the tool falls back to
`session.context` and says so.

A search from the bot's current chat stops before the message that started the
run, so the question can't match itself. That message is the first user,
bot-to-bot, job, or task message from one second before the session turned
busy on: the service stores it a few milliseconds after `time.busy`, and a bot
message queued later must not move the cut.

**Clear conversation** interrupts the session and archives it
(`session.update`, `archived: true`), retitled and tagged
`botsClearedBot: <bot id>` in its metadata. The tool lists the bot workspace's
sessions, archived and not (a user may unarchive one), and keeps those with the
bot's tag. Their messages are cached for the process, keyed by the session's
last update, least recently used first, up to 20 million characters; a session
that is busy when read is not cached, so a half-written reply never sticks.
Deleting a bot removes those sessions and their cache entries. Nothing new goes
into `bots.json`. Unlike deleting, archiving may leave the old session's
background shells or subagents running, and one that finishes can wake that
session.

Questions and permission prompts are listed per location, so the web app asks
the bot workspace and every unique worker directory (`form.list`,
`permission.request.list`, settled independently and deduplicated by ID and
session), then shows a worker's requests in its owner bot's chat. Answers go by
session ID, which works from any location. For notifications the bot-workspace
plugin subscribes to the global `form.created` and `permission.asked` events and
pushes those whose session is a worker to `/?bot=<owner>`; bot and group
questions are left to the `question` tool hook, so nothing is sent twice.

Dictation borrows the running Hex app instead of loading a speech model of its
own. The web app reads Hex's owner-only discovery file
(`~/Library/Application Support/hex/local-api.json`, `~/.local/share/hex` on
Linux, `HEX_APPLICATION_SUPPORT_DIR` overrides; local API version 2 only) and
relays the browser's audio to Hex's local API:

```text
browser (AudioWorklet → 16 kHz s16le)       web app                 Hex
POST /api/dictation                    →    POST /streams           opens a stream on dictation's model
POST /api/dictation/:id/audio  (¼ s)   →    /streams/{id}/audio
GET  /api/dictation/:id/events (SSE)   ←    /streams/{id}/events    segments and partials, shown live
POST /api/dictation/:id/finish         →    /streams/{id}/finish    final text
POST /api/transcribe  (whole WAV)      →    POST /transcriptions    fallback, model from POST /control
```

The `:id` is the web app's own random id; Hex's stream id and owner token stay
in the web app. The browser keeps every sample, so when Hex can't stream (one
stream at a time) or a stream breaks, it sends the whole clip as a WAV instead.
`GET /api/transcribe` reports whether Hex is installed and answering, which
decides whether the composer shows the microphone.

Both `/streams/{id}/finish` and `/transcriptions` are sent with
`process=global`, which asks for Hex's Global-mode Output processing (Labs ›
Process API transcripts); its `processed` field is used when present. Hex
refuses the parameter before reading the audio or finishing the stream
(`403 processing-disabled`, `409 processing-unavailable`, `429 queue-full`), so
on those codes the web app sends the request again without it and uses the
raw text.

The tunnel reuses the OpenTunnel identity OpenCode itself pairs with (profile
`default`) and claims its own `bots` route, so the address is stable across
restarts. If the profile has no identity yet, the first connect creates one
(`tunnel.ensure`), so nobody has to run `opencode pair --remote` first. OpenCode
then uses the same identity if remote pairing is turned on later.

Requirements: OpenCode Desktop 2.2 or later on macOS or Linux (Windows is not
supported), and port `49384` free on `127.0.0.1`.

## Source layout

```text
plugin/src/index.ts     server plugin: store, hooks, bots_* tools, scheduler, RPC
plugin/src/rpc.ts       RPC contract shared with the web app and Desktop page
plugin/src/schedule.ts  cron and wake-time parsing, shared with the web app
plugin/src/history.ts   bots_history: full session history from the service, search, read
plugin/src/webhost.ts   runs the web app on OpenCode's Bun runtime
plugin/src/gui.tsx      Desktop Settings → Bots page
web/src/index.ts        web app server: pairing, proxy, push, tunnel
web/src/remote.ts       tunnel connection and pairing cookies
web/src/hex.ts          dictation: relays audio to the running Hex's local API
web/src/dictation.ts    browser microphone capture, live streaming, WAV fallback
web/src/face.ts         bot faces drawn as SVG from a saved 8-hex-digit seed
web/src/App.tsx         React app
web/src/components/     chat, sidebar, and Settings tabs (Planner.tsx: Tasks and Jobs;
                        Requests.tsx: question and permission cards)
web/src/sw.js           service worker (push, notification clicks)
```

## Security

- The web app listens on `127.0.0.1` only; remote access is through OpenTunnel.
- Every request needs a pairing cookie, loopback included: the tunnel forwards
  the visitor's `Host` header, so a local-looking request proves nothing.
- Pairing uses OpenCode's single-use codes. The app checks a code with OpenCode
  and issues its own signed cookie (`HttpOnly`, `SameSite=Strict`, `Secure`,
  400 days); OpenCode's session cookie never reaches the browser.
- Cross-origin writes are rejected.
- The plugin's notify requests are authorized by a 256-bit internal secret in
  `push.json` (mode `0600`), not by a local-only check.
- `bots.json` holds roles and memory, not provider credentials.
- `bots_history` answers only for the calling bot's own chat and cleared
  conversations; only the coordinator can name another bot. Group chats are
  never searched.
- Hex's bearer token and stream owner tokens stay in the web app; the browser
  only reaches `/api/dictation` and `/api/transcribe`, behind the pairing cookie
  and origin check like every `/api` route. Audio is held in memory (whole
  clips capped at 24 MB, stream chunks at 256 KiB) and never written to disk.

> [!WARNING]
> A paired device has full use of your OpenCode service, as Desktop does:
> sessions, tools, and shell. Pair only devices you control, and use **Sign out
> all devices** if one is lost.
