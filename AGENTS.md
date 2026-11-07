# AGENTS.md

## Documentation

The docs are split by audience. Keep each fact in one place.

- `README.md` is for people trying the plugin for the first time. It covers what
  the plugin is, why to use it, and how to install it from scratch. Use short
  sentences and short paragraphs. No limits, file paths, tool names, or
  internals: link to `docs/` instead.
- `docs/guide.md` is the user reference: every feature, its limits, data
  locations, backups, and troubleshooting.
- `docs/architecture.md` covers how the plugin, web app, tunnel, and Desktop
  page fit together, the source layout, and the security model.
- `docs/development.md` covers setup, scripts, reloading, and release rules.

Update the docs in the same change as the code:

- A new or changed feature, limit, setting, or UI label: update
  `docs/guide.md`. Touch `README.md` only if the headline features or the
  install steps change.
- A new file under `plugin/src` or `web/src`, or a changed process, port,
  route, cookie, or secret: update `docs/architecture.md`.
- A new or changed `package.json` script or build step: update
  `docs/development.md`.
- A change to the install steps or requirements: update `install.sh`,
  `README.md`, and `docs/guide.md` together.

## Releases

`dist/` is committed. Run `bun run bundle` and commit `dist/` with every source
change.
