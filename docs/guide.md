# User guide

Everything Bots for OpenCode does, feature by feature. For setup, see the
[README](../README.md).

Requirements: OpenCode Desktop 2.2 or later on macOS or Linux (Windows is not
supported), and port `49384` free on `127.0.0.1`.

## Bots

Each bot is one long-lived OpenCode session with a name, an `@handle`, a role, a
face, and its own memory. Bot sessions live in `~/Bots for OpenCode`,
so you can open them in Desktop too.

- **Names and handles.** Only the name is editable; the handle is derived from it
  (`Research Lead` → `@research-lead`, with a numeric suffix if taken), so
  renaming changes the handle.
- **Face.** A flat shape with two eyes, in a random colour from the iOS system
  palette. In **Settings → Bots**, click **Random face** until you like one, then
  save. Bots created by Chief, and bots from before faces existed, get one
  automatically. Groups keep a coloured square with their initials.
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
- **Questions and permissions.** When a bot asks you something with OpenCode's
  question tool, or needs a permission you set to ask, it waits until you
  answer. The question appears as a card at the end of the chat, and the chat
  shows **Waiting for your answer** in the sidebar. Pick an option or type your
  own answer, then **Send answer**; **Dismiss** lets the bot carry on without
  one. A group member's questions appear in the group too, and a
  [project worker](#project-workers)'s appear in its bot's chat, labelled with
  the worker and its project. You can also answer in Desktop.
- **Attachments.** Use `+` in the composer (or `Cmd`/`Ctrl` + `U`), paste, or
  drag files in: up to 10 files, 10 MB each, 25 MB in total.
- **Dictation.** With [Hex](https://github.com/anomalyco/hex) running on the
  computer that runs OpenCode, the composer shows a microphone. Tap it, speak,
  then tap the red stop button: the words appear where the cursor was, ready to
  edit and send. `×` or `Escape` discards the recording. It works from your
  phone too, because that computer does the transcribing, on the model and
  language Hex dictates with. The audio goes to Hex while you speak, so the text
  is ready as soon as you stop, and what Hex has heard shows above the text box:
  each phrase once you pause, or word by word with a model that streams. While
  Hex is busy with another stream, the recording is sent whole when you stop
  instead, with no live text; clips over 30 seconds then make Hex load a second
  copy of its model for a while. Recordings stop at 10 minutes and are never
  saved. The text is what was heard, without Hex's Output processing
  (corrections, transformations, rewriting). The microphone is hidden if Hex
  has never run on that computer.
- **Deleting a bot** deletes its OpenCode session, as in Desktop. If that fails,
  the bot is kept so no session is orphaned. A bot that hosts a group can't be
  deleted until the group has another host. Its project workers' sessions are
  kept in Desktop; only the bot's list of them goes.
- **A session deleted elsewhere** is recreated on the next message. The history
  is gone; the role and memory still apply.

## Groups

A group has a host bot, members, and group instructions. The host writes the
replies; mention a member with `@handle` and the host routes the message to it.
Each member's reply appears as its own bubble. Only members can be contacted
from a group.

## Tasks and jobs

See every bot's tasks and jobs in the app's **Settings → Tasks** and
**Settings → Jobs**, filter them by bot, and edit them there; changes apply
immediately.

- **Tasks** are each bot's board: **To do**, **In progress**, and **Done**.
  Bots keep it current with `bots_task`, recording follow-ups and work they
  promised to do later. Open tasks appear in the bot's instructions, so it
  always knows what's pending.
- **Wake times.** A task can have a wake time. When it arrives, the bot gets a
  task reminder in its own chat and acts on it, then marks the task done or
  snoozes it with a new wake time. Bots accept `45m`, `2h`, `3d`, a local time
  such as `2026-11-09 09:00` (a bare date means 09:00), or an ISO timestamp.
- **Jobs** post a prompt into a bot's chat on a cron schedule (five fields, such
  as `0 9 * * 1-5`, or a macro such as `@daily`), in a time zone that defaults
  to your machine's. Bots create them with `bots_job` only when you ask for
  something recurring. **Run now** queues a run at once; a job can run at most
  every 5 minutes. Pause a job to keep it without running it.
- **The coordinator** sees every bot's open tasks and can assign tasks and
  schedule jobs for any bot; other bots manage only their own.
- **Automatic messages.** Job runs and task reminders appear in the chat as a
  collapsible note, not as your message. They queue behind a reply in progress,
  and a prompt that mentions `@handle` may delegate to that bot.
- **While OpenCode is off**, nothing runs. A job that was due runs once when the
  service is back, marked late; overdue tasks wake their bots at once.
- **Limits.** 50 open tasks per bot, 300 tasks, and 50 jobs. Done tasks are
  removed after 30 days. Deleting a bot deletes its tasks and jobs.

## Project workers

A bot can open a worker: an ordinary OpenCode session in one of your project
directories, created by the bot with `bots_worker`. Ask a bot to "start a
session in `~/code/app` and fix the failing test", and it does the work there.

- **Visible in Desktop.** A worker is a real top-level session in that project,
  not a subagent. It shows up in the project's session list in Desktop and the
  CLI, where you can read it, answer it, and keep going yourself.
- **The project's own setup.** A worker gets that project's `AGENTS.md`,
  agents, commands, skills, MCP servers, permissions, and default model, just
  like a session you start there. It gets none of the bot's role, memory,
  library skills, model, or bot tools, so the bot briefs it in full.
- **Actions.** `create` opens a worker in an existing directory (absolute or
  `~/…`; not the bot workspace), with an optional title, agent from that
  project, and first message. `send` continues it, `read` returns its latest
  reply, `status` shows its title, location, agent, model, and whether it is
  working, `interrupt` stops its current run, `list` shows the bot's workers,
  and `delete` removes it.
- **Long work.** With a message, the bot waits up to 2 minutes for the reply.
  Longer work keeps running; the bot checks back with `read` or `status`, or
  sends with `wait: false` and moves on. Replies over 12,000 characters are cut
  short in the bot's chat; the full text is in the session.
- **Questions and permissions.** When a worker asks something or needs a
  permission, the card appears in its bot's chat (and any group the bot is in),
  labelled with the worker and its project, and the chat shows **Waiting for
  your answer**. You get a notification that opens the bot's chat, so you can
  answer from your phone.
- **Who manages what.** A bot manages only its own workers; the coordinator
  manages everyone's. In a group, the host's workers belong to the host.
- **Deleting.** Bots delete a worker only when you ask, and `delete` removes the
  session and its history. Deleting a bot keeps its workers' sessions in
  Desktop.
- **Limits.** 25 workers per bot, 100 in total. Titles up to 200 characters,
  messages up to 20,000.

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

- You're notified when a bot or group you messaged finishes, and when a job run
  or task reminder does (each job can turn this off), and when a bot asks you
  a question (including from a job or another bot) or one of its project
  workers asks a question or needs a permission. Bot-to-bot and
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
~/Bots for OpenCode/                    bot and group sessions' location
└── .opencode/opencode.json             keeps the location loaded while idle
~/.local/share/opencode/bots/
├── bots.json      bots, groups, model, memory, commands, skill index, tasks, jobs, worker index, coordinator
├── skills/        skill directories
├── remote.json    tunnel hostname + pairing secret (0600)
├── push.json      Web Push keys, internal notify secret, subscriptions (0600)
└── web.log        web app log (0600)
```

`$XDG_DATA_HOME` replaces `~/.local/share` when set. Installs from before the
rename keep using `~/OpenCode Bots`, because their bot sessions belong to it.
Conversations themselves, project workers' sessions included, are in OpenCode's
database, `~/.local/share/opencode/opencode.db`; `bots.json` only records which
sessions are whose workers.

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

**The app goes unreachable after a while idle.** OpenCode unloads a location
after an hour without session activity, and the web app stops once every
location is unloaded. The plugin sets `experimental.location_idle_timeout` to
`false` in `~/Bots for OpenCode/.opencode/opencode.json` so the bot workspace
stays loaded, which also keeps tasks and jobs firing. It leaves the setting
alone if you already chose a value there; delete the key to get the default
back.

**Dictation says Hex isn't running.** Open Hex on the computer that runs
OpenCode (`hex start`) and finish its setup, so its model is downloaded;
`hex status` should list the model as installed. If the browser says microphone access is blocked, allow it
for the app's address in the browser's site settings.

**The address never appears in Settings → Bots.** On first start the app
creates its tunnel address, which needs a connection to `opentunnel.xyz`. Check
`web.log` for the error.
