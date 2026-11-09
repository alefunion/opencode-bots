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

Dictation borrows the running Hex app instead of loading a speech model of its
own. The browser records with `MediaRecorder`, decodes the clip, and posts it
as 16 kHz mono 16-bit WAV to the web app's `/api/transcribe`. The web app reads
Hex's owner-only discovery file (`~/Library/Application Support/hex/local-api.json`,
`~/.local/share/hex` on Linux, `HEX_APPLICATION_SUPPORT_DIR` overrides), asks
`POST /control` for the dictation model and language, and sends the clip to
Hex's `POST /transcriptions` with them, so Hex runs it on its warm model. A
`GET /api/transcribe` reports whether Hex is installed and answering, which
decides whether the composer shows the microphone.

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
plugin/src/webhost.ts   runs the web app on OpenCode's Bun runtime
plugin/src/gui.tsx      Desktop Settings → Bots page
web/src/index.ts        web app server: pairing, proxy, push, tunnel
web/src/remote.ts       tunnel connection and pairing cookies
web/src/hex.ts          dictation: sends clips to the running Hex's local API
web/src/dictation.ts    browser microphone capture and WAV encoding
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
- Hex's bearer token is read per request and stays in the web app; the browser
  only reaches `/api/transcribe`, behind the pairing cookie and origin check
  like every `/api` route. Clips are held in memory, capped at 60 MB, and never
  written to disk.

> [!WARNING]
> A paired device has full use of your OpenCode service, as Desktop does:
> sessions, tools, and shell. Pair only devices you control, and use **Sign out
> all devices** if one is lost.
