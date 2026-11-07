# User guide

Everything Bots for OpenCode does, feature by feature. For setup, see the
[README](../README.md).

Requirements: OpenCode Desktop 2.2 or later on macOS or Linux (Windows is not
supported), and port `49384` free on `127.0.0.1`.

## Bots

Each bot is one long-lived OpenCode session with a name, an `@handle`, a role, a
coloured avatar, and its own memory. Bot sessions live in `~/Bots for OpenCode`,
so you can open them in Desktop too.

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
- **Coordinator.** Only the coordinator can create bots (`bots_create`). The
  first bot, **Chief** (`@chief`), starts as the coordinator. Choose another in
  **Settings → Bots**; deleting it clears the setting.
- **Bot-to-bot messages.** Bots reach each other with `@handle`, so one bot can
  delegate to another.
- **Attachments.** Use `+` in the composer (or `Cmd`/`Ctrl` + `U`), paste, or
  drag files in: up to 10 files, 10 MB each, 25 MB in total.
- **Deleting a bot** deletes its OpenCode session, as in Desktop. If that fails,
  the bot is kept so no session is orphaned. A bot that hosts a group can't be
  deleted until the group has another host.
- **A session deleted elsewhere** is recreated on the next message. The history
  is gone; the role and memory still apply.

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

## Pairing devices

Open **OpenCode Desktop → Settings → Bots**, click **Pair device**, and scan the
QR code (or open the link on another computer). Links work once and expire after
five minutes; the pairing itself is permanent.

The app lives at `https://bots.<your-opentunnel-hostname>`, shown on the same
settings page.

## Notifications

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

## Signing devices out

**OpenCode Desktop → Settings → Bots → Sign out all devices** rotates the pairing
secret. Every paired phone and computer is signed out and stops receiving
notifications; the address stays the same, so new pairing links work at once.
Deleting `~/.local/share/opencode/bots/remote.json` does the same. Revocation is
all-or-nothing: there is no per-device sign-out.

## Updating and removing

```sh
opencode plugin update opencode-bots
opencode plugin add github:alefunion/opencode-bots#<tag>   # pin a release
opencode plugin remove opencode-bots
```

## Data and backups

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

## Troubleshooting

**The app is unreachable.** Check that the web app is listening, then read its
log and OpenCode's:

```sh
lsof -nP -iTCP@127.0.0.1:49384 -sTCP:LISTEN
tail -50 ~/.local/share/opencode/bots/web.log
tail -100 ~/.local/share/opencode/log/opencode.log
```

The web app needs port `49384` free on `127.0.0.1`.

**The address never appears in Settings → Bots.** On first start the app
creates its tunnel address, which needs a connection to `opentunnel.xyz`. Check
`web.log` for the error.
