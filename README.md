<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/mark-dark.svg">
  <img alt="Bots for OpenCode" src="public/mark-light.svg" width="80" height="80">
</picture>

# Bots for OpenCode

**Persistent AI teammates for OpenCode, in your pocket.**

Give your agents names, roles, and memory, put them in group chats, and message
them from your phone. It all runs on your own machine.

<a href="https://opencode.ai">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://opencode.ai/brand/badges/opencode-works-with-a-dark-20.svg">
    <img alt="Works with OpenCode" src="https://opencode.ai/brand/badges/opencode-works-with-a-light-20.svg" height="20">
  </picture>
</a>
<img alt="macOS and Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-1f1f1f?style=flat-square" height="20">
<a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-1f1f1f?style=flat-square" height="20"></a>

[Quick start](#quick-start) · [Features](#features) · [Guide](#guide) · [Security](#security) · [Development](#development)

</div>

---

```sh
opencode plugin add github:alefunion/opencode-bots
```

That's the whole install. No server to deploy, no accounts, no API keys, and no
push service. Open **OpenCode Desktop → Settings → Bots**, scan the QR code, and
you're chatting with your first bot.

## Why Bots for OpenCode

OpenCode is a superb coding agent, but each session starts from scratch and stays
on your desk. Bots for OpenCode turns sessions into **teammates that persist**:

- **They remember you.** Each bot keeps its own memory of facts and preferences
  you've stated, across every conversation.
- **They specialize.** Give each one a standing role: a reviewer, a researcher,
  an ops lead. A coordinator bot can create new ones for you.
- **They work together.** Bots message each other with `@handle`, and group chats
  let a host bot route work to its members.
- **They come with you.** A fast, chat-style web app on your phone, with push
  notifications when a job is done, over a private tunnel to your own machine.
- **They get better.** A shared library of commands and skills, with skills bots
  propose themselves after a task that worked, held for your approval.

Every bot is an ordinary OpenCode session with full use of its tools, so nothing
is sandboxed into a toy: open any of them in Desktop at any time.

## Quick start

**Requirements:** OpenCode Desktop 2.2 or later on macOS or Linux (Windows is not
supported), and port `49384` free on `127.0.0.1`. Pairing a device remotely
once (`opencode pair --remote`, or from Desktop) sets up the OpenTunnel identity
the app needs. The web app ships prebuilt and runs on the Bun runtime inside
OpenCode, so there is nothing else to install.

1. **Install the plugin.**

   ```sh
   opencode plugin add github:alefunion/opencode-bots
   ```

   Your first bot, **Chief** (`@chief`), is created as the coordinator.

2. **Pair your phone.** Open **OpenCode Desktop → Settings → Bots**, click
   **Pair device**, and scan the QR code (or open the link on another computer).
   Links work once and expire after five minutes; the pairing itself is permanent.

3. **Start chatting.** Say hi to Chief, or create bots and groups from the app's
   **Settings**. On a phone, add the app to your Home Screen for a full-screen
   window and notifications.

The app lives at `https://bots.<your-opentunnel-hostname>`. Update with
`opencode plugin update opencode-bots`, pin a release with `#<tag>`, and remove
with `opencode plugin remove`.

## Features

|                         |                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| **Persistent bots**     | One long-lived OpenCode session per bot, with a name, `@handle`, role, coloured avatar, and memory. |
| **Private memory**      | Facts and preferences you've stated, injected into the bot's prompt. Bots manage it on request.     |
| **Group chats**         | A host bot replies and routes `@mentions` to members; each member answers in its own bubble.        |
| **Bot-to-bot messages** | Bots reach each other with `@handle`, so one bot can delegate to another.                           |
| **Coordinator**         | One bot can create others, so you can grow a team just by asking.                                   |
| **Slash commands**      | Reusable prompt templates with `$ARGUMENTS` and `$1`…`$9`.                                          |
| **Skills library**      | Full skill directories (references, scripts, assets), scoped to all bots or selected ones.          |
| **Self-improving**      | Bots propose skills from work that verifiably succeeded; you approve them before they're used.      |
| **Mobile web app**      | A polished chat UI with attachments, installable on your phone's Home Screen.                       |
| **Push notifications**  | Standard Web Push from your machine: no developer account, push service, or per-message cost.       |
| **Remote access**       | OpenTunnel with OpenCode's own pairing codes, plus one-click **Sign out all devices**.              |
| **Desktop integration** | A **Settings → Bots** page in OpenCode Desktop with the address, a pairing QR code, and sign-out.   |

## Guide

### Bots

- **Names and handles.** Only the name is editable; the handle is derived from it
  (`Research Lead` → `@research-lead`, with a numeric suffix if taken), so
  renaming changes the handle.
- **Model.** One model for every bot and group, chosen in **Settings → Bots**. A
  session switched to another model elsewhere is switched back on its next
  message.
- **Memory.** Private to each bot. Edit it in **Settings**, or ask the bot to
  remember or forget something (`bots_memory`). Bots save only facts and durable
  preferences you actually stated, never their own guesses, and update an entry
  rather than adding a near-duplicate. Capped at 50 entries and 40,000
  characters.
- **Role.** The bot's standing instructions. Edit it in **Settings**, or ask the
  bot to change it (`bots_role`). Bots change their role only when you ask, and
  only their own; the new role applies from the next model step.
- **Coordinator.** Only the coordinator can create bots (`bots_create`). Choose
  it in **Settings → Bots**; deleting it clears the setting.
- **Attachments.** Use `+` in the composer (or `Cmd`/`Ctrl` + `U`), paste, or
  drag files in: up to 10 files, 10 MB each, 25 MB in total.
- **Deleting a bot** deletes its OpenCode session, as in Desktop. If that fails,
  the bot is kept so no session is orphaned. A bot that hosts a group can't be
  deleted until the group has another host.
- **A session deleted elsewhere** is recreated on the next message. The history
  is gone; the role and memory still apply.

Bot sessions live in `~/Bots for OpenCode`, so you can open them in Desktop too.

### Groups

A group has a host bot, members, and group instructions. The host writes the
replies; mention a member with `@handle` and the host routes the message to it.
Each member's reply appears as its own bubble. Only members can be contacted
from a group.

### Commands and skills

Manage both in the app's **Settings**, or ask a bot to create them.

- **Commands** are prompt templates: type `/name` in a chat. Templates support
  `$ARGUMENTS` and `$1`…`$9`; without a placeholder, the arguments are appended.
- **Skills** are directories in `~/.local/share/opencode/bots/skills/<id>/`: a
  `SKILL.md` plus any references, scripts, or assets. Bots load them with
  OpenCode's skill tool, by description or `@skill-id`. Add files or whole
  folders in **Settings → Skills**; scripts under `scripts/` are made
  executable. Limits: 4 MB per file, 200 files and 40 MB per skill. A skill ID
  can't change after the first save.
- **Scope.** Each item is available to **All bots** or **Selected bots**. Items a
  bot creates are scoped to that bot, but any bot can edit or delete any library
  item, shared ones included.
- **Draft proposals.** After a task whose success something outside the bot
  confirmed (tests passed, you said it worked), a bot can propose a skill with
  `bots_skill` action `propose` and the evidence. Proposals arrive in
  **Settings → Skills** as drafts and can't be used until you approve them. Bots
  prefer a minimal `patch` to an existing skill over a rewrite, and `save` only
  when you ask for a new or changed skill.
- **Pinning.** Pin a skill to lock it: bots can no longer save, patch, delete, or
  edit its files. Unpin it to hand it back.
- **Usage and archiving.** **Settings → Skills** shows how often and when each
  skill was loaded. Bot-authored, unpinned skills unused for 60 days are archived
  automatically; they stay in the Library and can be restored, but bots can't
  load them. Skills you create and pinned skills are never archived.
- **Isolation.** Library items exist only in bot and group sessions. Classic
  OpenCode sessions never see them, and bots still have every global OpenCode
  skill.

### Notifications

In the app, open **Settings → Remote → Notifications** and tap **Enable
notifications**. Each device opts in separately; **Send test** checks delivery.

- You're notified when a bot or group you messaged finishes. Bot-to-bot and
  group-member replies stay quiet, background work is allowed to finish first,
  and failed runs don't notify. Tapping a notification opens the conversation.
- It's standard Web Push with keys generated on your machine: no Apple Developer
  account, APNs certificate, or third-party push service.
- **iPhone and iPad** need iOS 16.4 or later. Add the app to the Home Screen,
  open it from the icon, and pair and enable notifications there; a Safari tab
  can't subscribe. Removing the icon removes its subscription.

### Signing devices out

**OpenCode Desktop → Settings → Bots → Sign out all devices** rotates the pairing
secret. Every paired phone and computer is signed out and stops receiving
notifications; the address stays the same, so new pairing links work at once.
Deleting `~/.local/share/opencode/bots/remote.json` does the same. Revocation is
all-or-nothing: there is no per-device sign-out.

### Data and backups

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
rename keep using `~/OpenCode Bots`, because their bot sessions belong to it.
Conversations themselves are in OpenCode's database,
`~/.local/share/opencode/opencode.db`.

To back up, copy the whole `bots/` directory; `bots.json` alone doesn't include
skill files. Without `remote.json` every device must pair again; without
`push.json` devices resubscribe on their next open. Back up `opencode.db` too
(with `sqlite3 … ".backup …"`) to keep history, since `bots.json` refers to its
sessions.

### How it runs

```text
Phone / browser
  │  https://bots.<hostname>   (OpenTunnel)
  ▼
Web app  127.0.0.1:49384       prebuilt; serves the UI, proxies /api, sends Web Push
  │
  ▼
OpenCode background service    the one Desktop uses
  ├─ plugin, every location:   keeps one web app process running
  ├─ plugin, bot workspace:    bot tools, persona and memory, library, RPC
  └─ Desktop GUI:              Settings → Bots
```

The web app is a child of the OpenCode service and is restarted within seconds
if it exits. It finds the service on its own and needs no password. Plugin
instances in other locations do nothing else, so classic sessions get no bot
persona.

<details>
<summary><strong>Troubleshooting: the app is unreachable</strong></summary>

```sh
lsof -nP -iTCP@127.0.0.1:49384 -sTCP:LISTEN
tail -50 ~/.local/share/opencode/bots/web.log
tail -100 ~/.local/share/opencode/log/opencode.log
```

</details>

## Security

- The web app listens on `127.0.0.1` only; remote access is through OpenTunnel.
- Every request needs a pairing cookie, loopback included: the tunnel forwards
  the visitor's `Host` header, so a local-looking request proves nothing.
- Pairing uses OpenCode's single-use codes. The app checks a code with OpenCode
  and issues its own signed cookie (`HttpOnly`, `SameSite=Strict`, `Secure`,
  400 days); OpenCode's session cookie never reaches the browser.
- Cross-origin writes are rejected.
- `bots.json` holds roles and memory, not provider credentials.

> [!WARNING]
> A paired device has full use of your OpenCode service, as Desktop does:
> sessions, tools, and shell. Pair only devices you control, and use **Sign out
> all devices** if one is lost.

## Development

Clone the repository into OpenCode's global plugin directory, where it is
discovered without a `plugins` entry (don't also install it with
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

`dist/` is committed so that installing from Git needs no build step: run
`bun run bundle` and commit `dist/` with every source change. Git installs never
build, and a `build` script would make npm try to compile the package from
source.

The logo and app icons are drawn on the OpenCode logo's stroke grid; see
[`public/logo.md`](public/logo.md), and run `scripts/build-icons.sh` after
changing them.

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

[MIT](LICENSE)

OpenCode is a trademark of Anomaly. Bots for OpenCode is an independent project,
not made, affiliated with, or endorsed by Anomaly.
