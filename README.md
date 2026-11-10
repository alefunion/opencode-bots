<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/mark-dark.svg">
  <img alt="Bots for OpenCode" src="public/mark-light.svg" width="64" height="80">
</picture>

# Bots for OpenCode

**AI teammates that remember you, and live in your pocket.**

<a href="https://opencode.ai">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://opencode.ai/brand/badges/opencode-works-with-a-dark-20.svg">
    <img alt="Works with OpenCode" src="https://opencode.ai/brand/badges/opencode-works-with-a-light-20.svg" height="20">
  </picture>
</a>

</div>

---

Create bots with names, roles, and memory. Put them in group chats. Message them
from your phone, and get a notification when the work is done.

Everything runs on your own computer. No server, no account, no extra bill.

## What you get

- **Bots that remember.** Each bot keeps what you've told it, across every chat.
  Ask what you talked about weeks ago, and it looks it up.
- **Bots with a job.** A reviewer, a researcher, an ops lead. You set the role.
- **Bots that team up.** Mention `@someone` and bots pass work to each other.
- **Group chats.** One bot hosts, the others jump in when called.
- **Bots that follow up.** Each bot keeps a to-do list and sets itself reminders.
  Ask for a morning briefing and it shows up every morning.
- **Bots that open projects.** A bot can start a real OpenCode session in any of
  your projects, with that project's own agents and skills. It stays in Desktop,
  so you can check it and pick up where the bot left off.
- **Your phone.** A fast chat app, with push notifications.
- **Bots that learn.** They suggest new skills after a job well done. You approve.
- **Real power.** Every bot is a full OpenCode agent. It can read, write, and run
  code on your machine.

## New to OpenCode?

[OpenCode](https://opencode.ai) is a free, open source AI agent. It runs on your
computer and can work on your files.

It comes with free models, so you can start without an API key. You can also
connect OpenAI, Anthropic, GitHub Copilot, and many others.

Bots for OpenCode is a plugin. It turns OpenCode into a team you can chat with.

## Install

You need a Mac or a Linux computer.

**1. Get OpenCode Desktop.** Download it from
[opencode.ai/download](https://opencode.ai/download) and open it once.

**2. Install the plugin.** Paste this into a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/alefunion/opencode-bots/main/install.sh | bash
```

It installs the OpenCode command line if you don't have it, then adds the plugin.

Already use OpenCode? This does the same thing:

```sh
opencode plugin add github:alefunion/opencode-bots
```

**3. Pair your phone.** In OpenCode Desktop, open **Settings → Bots**. Click
**Pair device** and scan the QR code.

**4. Say hi.** Your first bot is **Chief**. Ask it to create more bots for you.

> [!TIP]
> On your phone, use **Add to Home Screen**. The app opens full screen, and
> notifications work there.

## Safe by design

The app only listens on your own computer. Your phone reaches it through an
encrypted private tunnel.

Only devices you pair can get in. Lost your phone? Click **Sign out all
devices** in **Settings → Bots**.

A paired device can do anything OpenCode can, so pair only devices you own.

## Learn more

- [User guide](docs/guide.md): every feature, backups, and troubleshooting.
- [Architecture and security](docs/architecture.md): how it works under the hood.
- [Development](docs/development.md): build and hack on the plugin.

## License

[MIT](LICENSE)

OpenCode is a trademark of Anomaly. Bots for OpenCode is an independent project,
not made, affiliated with, or endorsed by Anomaly.
