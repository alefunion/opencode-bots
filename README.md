# Bots for OpenCode

<a href="https://opencode.ai">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://opencode.ai/brand/badges/opencode-works-with-a-dark-20.svg">
    <img alt="Works with OpenCode" src="https://opencode.ai/brand/badges/opencode-works-with-a-light-20.svg" height="20">
  </picture>
</a>

Persistent bot personas for [OpenCode](https://opencode.ai), with a chat-style web
app you can open from your phone. An independent plugin, not made or endorsed by
Anomaly.

- One persistent OpenCode session per bot, with a role, a coloured avatar, and
  private memory the bot can manage itself.
- `@handle` messages between bots, and group chats with a host bot.
- A shared library of slash commands and skills (full skill directories with
  references, scripts, and assets), scoped to all bots or selected ones.
- A coordinator bot that can create other bots.
- One global model for every bot.
- Remote access through OpenTunnel with OpenCode's own pairing codes, and Web
  Push notifications when a bot finishes a job (including iPhone Home Screen apps).
- A **Settings → Bots** page in OpenCode Desktop with the address, a pairing QR
  code, and **Sign out all devices**.

## Requirements

- OpenCode Desktop 2.2 or later, on macOS or Linux. Windows is not supported.
- An OpenTunnel identity on the `default` profile. OpenCode creates it the first
  time you pair a device remotely (`opencode pair --remote`, or pairing from
  Desktop).
- Port `49384` on `127.0.0.1` free for the web app.

Nothing else: the web app is prebuilt and runs on the Bun runtime inside the
OpenCode binary.

## Install

```sh
opencode plugin add github:alefunion/opencode-bots
```

This adds the plugin to your global `opencode.json(c)`, so OpenCode Desktop also
loads its **Settings → Bots** page. Pin a release with `#<tag>`. Update with
`opencode plugin update opencode-bots`; remove with `opencode plugin remove`.

On first start the plugin creates one bot, **Chief** (`@chief`), as the
coordinator, plus the empty session workspace `~/Bots for OpenCode`.

## Use it

1. Open **OpenCode Desktop → Settings → Bots**.
2. Click **Pair device** and scan the QR code with your phone, or open the link
   on another computer. Links work once and expire after five minutes; the
   pairing itself is permanent.
3. Chat with Chief, or create bots and groups from the app's **Settings**.

The address is `https://bots.<your-opentunnel-hostname>`. On a phone, add it to
the Home Screen for an app-like window and notifications.

Bot sessions are ordinary OpenCode sessions in `~/Bots for OpenCode`, so you can
also open them in Desktop.

## Bots

- **Names and handles.** Only the name is editable; the handle is derived from it
  (`Research Lead` → `@research-lead`, with a numeric suffix if taken). Renaming
  changes the handle.
- **Model.** One model for every bot and group, chosen in **Settings → Bots**. A
  session switched to another model elsewhere is switched back on its next
  message.
- **Memory.** Private to each bot and injected into its prompt. Edit it in
  **Settings**, or ask the bot to remember or forget something (`bots_memory`).
  Capped at 50 entries and 40,000 characters.
- **Coordinator.** Only the coordinator bot can create bots (`bots_create`).
  Choose it in **Settings → Bots**; deleting it clears the setting.
- **Deleting a bot** deletes its OpenCode session, like deleting it in Desktop.
  If that fails, the bot is kept so no session is orphaned. A bot that hosts a
  group cannot be deleted until the group has another host.
- **A session deleted elsewhere** is recreated on the next message. The history
  is gone; the role and memory still apply.
- **Attachments.** Use `+` in the composer (or `Cmd`/`Ctrl` + `U`), paste, or
  drag files in. Up to 10 files, 10 MB each, 25 MB in total.

## Groups

A group has a host bot, members, and group instructions. The host writes the
replies; mention a member with `@handle` and the host routes the message to it.
Each member's reply appears as its own bubble. Only members can be contacted
from a group.

## Commands and skills

Manage both in the app's **Settings**, or ask a bot to create them.

- **Commands** are prompt templates: type `/name` in a chat. Templates support
  `$ARGUMENTS` and `$1`…`$9`; without a placeholder, the arguments are appended.
- **Skills** are directories in `~/.local/share/opencode/bots/skills/<id>/`: a
  `SKILL.md` plus any references, scripts, or assets. Bots load them with
  OpenCode's skill tool, by description or `@skill-id`. Add files or whole
  folders in **Settings → Skills**; scripts under `scripts/` are made executable.
  Limits: 4 MB per file, 200 files and 40 MB per skill. A skill ID cannot change
  after the first save.
- **Scope.** Each item is available to **All bots** or **Selected bots**. Items a
  bot creates are scoped to that bot, but any bot can edit or delete any library
  item, shared ones included.
- Library items exist only in bot and group sessions. Classic OpenCode sessions
  never see them, and bots still have every global OpenCode skill.

## Notifications

In the app, open **Settings → Remote → Notifications** and tap **Enable
notifications**. Each device opts in separately; **Send test** checks delivery.

- A notification arrives when a bot or group you messaged finishes. Bot-to-bot
  and group-member replies stay quiet, and background work is allowed to finish
  first. Failed runs do not notify.
- Tapping it opens that conversation.
- It is standard Web Push with keys generated on your machine: no Apple Developer
  account, APNs certificate, or third-party push service, and no per-message cost.
- **iPhone and iPad** need iOS 16.4 or later. Add the app to the Home Screen,
  open it from the icon, and pair and enable notifications there; a Safari tab
  cannot subscribe. Removing the icon removes its subscription.

## Signing devices out

**OpenCode Desktop → Settings → Bots → Sign out all devices** rotates the pairing
secret. Every paired phone and computer is signed out and stops receiving
notifications; the address stays the same, so new pairing links work at once.
Deleting `~/.local/share/opencode/bots/remote.json` does the same.

Revocation is all-or-nothing: there is no per-device sign-out.

## Data

```text
~/Bots for OpenCode/                    bot and group sessions' location (empty)
~/.local/share/opencode/bots/
├── bots.json      bots, groups, model, memory, commands, skill index, coordinator
├── skills/        skill directories
├── remote.json    tunnel hostname + pairing secret (0600)
├── push.json      Web Push keys, internal notify secret, subscriptions (0600)
└── web.log        web app log (0600)
```

`$XDG_DATA_HOME` replaces `~/.local/share` when set. Installs from before the
rename keep using `~/OpenCode Bots`, because their bot sessions belong to it. Conversations themselves are
in OpenCode's database, `~/.local/share/opencode/opencode.db`.

To back up, copy the whole `bots/` directory; `bots.json` alone does not include
skill files. Without `remote.json` every device must pair again; without
`push.json` devices resubscribe on their next open. Back up `opencode.db` too
(with `sqlite3 … ".backup …"`) to keep history, since `bots.json` refers to its
sessions.

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
  ├─ plugin, bot workspace:   bot tools, persona and memory, library, RPC
  └─ Desktop GUI:              Settings → Bots
```

The web app is a child of the OpenCode service and is restarted within seconds if
it exits. It finds the service on its own and needs no password. Plugin
instances in other locations do nothing else, so classic sessions get no bot
persona.

If the app is unreachable:

```sh
lsof -nP -iTCP@127.0.0.1:49384 -sTCP:LISTEN
tail -50 ~/.local/share/opencode/bots/web.log
tail -100 ~/.local/share/opencode/log/opencode.log
```

## Security

- The web app listens on `127.0.0.1` only; remote access is through OpenTunnel.
- Every request needs a pairing cookie, loopback included: the tunnel forwards
  the visitor's `Host` header, so a local-looking request proves nothing.
- Pairing uses OpenCode's single-use codes. The app checks a code with OpenCode
  and issues its own signed cookie (`HttpOnly`, `SameSite=Strict`, `Secure`,
  400 days); OpenCode's session cookie never reaches the browser.
- Cross-origin writes are rejected.
- **A paired device has full use of your OpenCode service**, as Desktop does:
  sessions, tools, and shell. Pair only devices you control, and use **Sign out
  all devices** if one is lost.
- `bots.json` holds roles and memory, not provider credentials.

## Development

Clone the repository into OpenCode's global plugin directory, where it is
discovered without a `plugins` entry (do not also install it with
`opencode plugin add`):

```sh
git clone https://github.com/alefunion/opencode-bots ~/.config/opencode/plugins/opencode-bots
cd ~/.config/opencode/plugins/opencode-bots
bun install
bun run bundle
```

```sh
bun run typecheck   # plugin and web app
bun run fmt         # Bun's formatter (settings in bunfig.toml); fmt:check for CI
bun run bundle      # dist/web (web app) and dist/gui-experimental.cjs (Desktop page)
bun run watch:gui   # rebuild the Desktop page while editing it
```

The plugin always runs the prebuilt `dist/web`, so run `bun run bundle` after
changing `web/src`, then reload the plugin (`touch plugin/src/index.ts`); it
replaces the running web app when the bundle changed. Changes to `package.json`
need `opencode service restart`.
`bun run dev` serves `web/src` directly with hot reload. Give it its own port
(`PORT=8890 bun run dev`) and set `BOT_NO_AUTH=1` to skip pairing. It also
claims the `bots` tunnel route while running.

`dist/` is committed so that installing from Git needs no build step. Run `bun run bundle`
and commit `dist/` with every source change. Git installs never build: a
`build` script would make npm try to compile the package from source.

```text
plugin/src/index.ts     server plugin: store, hooks, bots_* tools, RPC
plugin/src/rpc.ts       RPC contract shared with the web app and Desktop page
plugin/src/webhost.ts   runs the web app on OpenCode's Bun runtime
plugin/src/gui.tsx      Desktop Settings → Bots page
web/src/index.ts        web app server: pairing, proxy, push, tunnel
web/src/App.tsx         React app
web/src/sw.js           service worker (push, notification clicks)
```

## License

MIT

OpenCode is a trademark of Anomaly. This project is not affiliated with or
endorsed by Anomaly.
