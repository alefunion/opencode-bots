# Development

## Setup

Clone the repository into OpenCode's global plugin directory, where it is
discovered without a `plugins` entry (don't also install it with
`opencode plugin add`):

```sh
git clone https://github.com/alefunion/opencode-bots ~/.config/opencode/plugins/opencode-bots
cd ~/.config/opencode/plugins/opencode-bots
bun install
bun run bundle
```

## Scripts

```sh
bun run typecheck   # plugin and web app
bun run fmt         # Bun's formatter (settings in bunfig.toml); fmt:check for CI
bun run bundle      # dist/web (web app) and dist/gui-experimental.cjs (Desktop page)
bun run watch:gui   # rebuild the Desktop page while editing it
```

## Reloading

The plugin always runs the prebuilt `dist/web`, so run `bun run bundle` after
changing `web/src`, then reload the plugin (`touch plugin/src/index.ts`); it
replaces the running web app when the bundle changed. Changes to `package.json`
need `opencode service restart`.

`bun run dev` serves `web/src` directly with hot reload. Give it its own port
(`PORT=8890 bun run dev`) and set `BOT_NO_AUTH=1` to skip pairing. It also
claims the `bots` tunnel route while running.

## Committing `dist/`

`dist/` is committed so that installing from Git needs no build step: run
`bun run bundle` and commit `dist/` with every source change. Git installs never
build, and a `build` script would make npm try to compile the package from
source.

## Logo and icons

The logo and app icons are drawn on the OpenCode logo's stroke grid; see
[`public/logo.md`](../public/logo.md), and run `scripts/build-icons.sh` after
changing them.

## Install script

[`install.sh`](../install.sh) is what the README's one-line install runs. It
finds or installs the OpenCode CLI, adds the plugin, and checks for OpenCode
Desktop. It must run on both macOS and Linux, including when piped from `curl`.
