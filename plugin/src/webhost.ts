import { spawn, type ChildProcess } from "node:child_process"
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { WEB_PORT } from "./port"

const HOST = "127.0.0.1"

/** `/bots/address` needs no pairing cookie, so it answers 200 whenever a host is up. */
async function healthy() {
  try {
    const response = await fetch(`http://${HOST}:${WEB_PORT}/bots/address`, {
      signal: AbortSignal.timeout(1200),
    })
    return response.ok
  } catch {
    return false
  }
}

type Supervisor = { version: string; users: number; stop: () => void }

// Every plugin instance (one per open location) needs the web host, but the
// process should run one. The registry lives on globalThis so it is shared even
// if the plugin module is loaded more than once. A supervisor from older code or
// an older bundle (after an edit or a plugin update) is replaced, keeping its
// users, instead of running stale code until every instance has reloaded.
const registry = globalThis as { [key: symbol]: Supervisor | undefined }
const KEY = Symbol.for("opencode-bots.webhost")

/**
 * Keeps the prebuilt web host (`dist/web/index.js`) running on OpenCode's own
 * Bun runtime: `process.execPath` is the OpenCode binary, and `BUN_BE_BUN=1`
 * makes it behave as `bun`. Nothing else needs to be installed. Returns a
 * release function; the host stops when the last instance releases it.
 */
export function acquireWebHost(input: {
  appDir: string
  workspace: string
  dataDir: string
}): () => void {
  const entry = join(input.appDir, "dist", "web", "index.js")
  if (!existsSync(entry)) {
    console.warn(`[opencode-bots] web host not started: ${entry} is missing (run bun run build)`)
    return () => {}
  }
  const version = [fileURLToPath(import.meta.url), entry]
    .map((path) => statSync(path).mtimeMs)
    .join(":")

  const existing = registry[KEY]
  if (existing?.version === version) {
    existing.users += 1
    return release
  }
  existing?.stop()

  mkdirSync(input.dataDir, { recursive: true })
  const logPath = join(input.dataDir, "web.log")
  let child: ChildProcess | undefined
  let stopping = false

  const start = async () => {
    if (stopping || child) return
    // Another OpenCode process (or a dev copy) may already serve the port.
    if (await healthy()) return
    if (stopping || child) return
    const log = openSync(logPath, "a")
    child = spawn(process.execPath, [entry], {
      // The bundle resolves its frontend assets relative to the working directory.
      cwd: dirname(entry),
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
        NODE_ENV: "production",
        PORT: String(WEB_PORT),
        HOST,
        BOT_WORKSPACE: input.workspace,
        BOT_DATA_DIR: input.dataDir,
        BOT_EMBEDDED: "1",
        BOT_PARENT_PID: String(process.pid),
      },
      stdio: ["ignore", log, log],
    })
    closeSync(log)
    chmodSync(logPath, 0o600)
    const running = child
    const exited = () => {
      if (child === running) child = undefined
    }
    running.on("error", (error) => {
      console.error("[opencode-bots] web host failed", error)
      exited()
    })
    running.on("exit", exited)
  }

  void start()
  // Restarts the host after a crash, and takes over when another owner stops.
  const timer = setInterval(() => void start(), 5_000)
  timer.unref?.()

  registry[KEY] = {
    version,
    users: (existing?.users ?? 0) + 1,
    stop: () => {
      stopping = true
      clearInterval(timer)
      child?.kill("SIGTERM")
      child = undefined
    },
  }
  return release

  function release() {
    const current = registry[KEY]
    if (!current) return
    current.users -= 1
    if (current.users > 0) return
    current.stop()
    registry[KEY] = undefined
  }
}
