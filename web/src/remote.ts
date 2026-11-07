import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { create, type OpenTunnelConnection } from "@opentunnel/client"

export type RemoteStatus = "connecting" | "connected" | "error"

export type RemoteView = {
  status: RemoteStatus
  url: string | null
  error: string | null
}

export type RemoteSession = {
  authenticated: boolean
  remote: RemoteView
}

/**
 * The tunnel reuses the OpenTunnel identity OpenCode itself pairs with, and
 * publishes the app on its own route, so the address is stable across restarts.
 */
const PROFILE = "default"
const ROUTE = "bots"
const COOKIE = "bots_session"

/**
 * Pairing is permanent: the cookie carries a signature, not an expiry. Browsers
 * cap a persisted cookie at 400 days, so that is the `Max-Age`; the cookie then
 * simply outlives every practical reinstall of the browser. Re-pairing is only
 * needed if a browser drops it or the signing secret rotates.
 */
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60

type Stored = {
  secret: string
  hostname: string | null
}

const dataDir = () =>
  process.env.BOT_DATA_DIR ?? join(homedir(), ".local", "share", "opencode", "bots")

const statePath = () => join(dataDir(), "remote.json")

/** The file's modification time, or 0 when it is gone. */
function modified() {
  try {
    return statSync(statePath()).mtimeMs
  } catch {
    return 0
  }
}

/** The stored state, or null when the file is missing or has no usable secret. */
function read(): Stored | null {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), "utf8")) as Partial<Stored>
    if (typeof parsed.secret !== "string" || parsed.secret.length < 32) return null
    return {
      secret: parsed.secret,
      hostname: typeof parsed.hostname === "string" && parsed.hostname ? parsed.hostname : null,
    }
  } catch {
    return null
  }
}

function persist(value: Stored) {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
  writeFileSync(statePath(), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  chmodSync(statePath(), 0o600)
  stamp = modified()
}

/**
 * A missing or unusable file gets a brand-new secret, written at once so a later
 * restart does not rotate it again and sign out the device that just paired.
 * The known hostname is kept so the address stays the same.
 */
function load(hostname: string | null): Stored {
  const existing = read()
  if (existing) return { ...existing, hostname: existing.hostname ?? hostname }
  const fresh = { secret: randomBytes(32).toString("base64url"), hostname }
  persist(fresh)
  return fresh
}

let stamp = 0
let stored = load(null)
stamp = modified()

/**
 * Revocation rotates the secret in `remote.json` (the plugin's `revokeDevices`,
 * or deleting the file). Every authorization re-reads the file when its
 * timestamp moved, so a running process signs every device out at once.
 */
function sync() {
  if (modified() === stamp) return
  const previous = stored.secret
  stored = load(stored.hostname)
  stamp = modified()
  if (stored.secret !== previous) {
    console.log("[opencode-bots] pairing secret changed; every device is signed out")
  }
}

let status: RemoteStatus = "connecting"
let lastError: string | null = null
let connection: OpenTunnelConnection | undefined
let generation = 0
let controller: AbortController | undefined

const client = create()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : typeof cause === "string" ? cause : JSON.stringify(cause)

const hostOf = (request: Request) => (request.headers.get("host") ?? "").split(":")[0] ?? ""

const loopback = (host: string) =>
  host === "127.0.0.1" || host === "localhost" || host === "::1" || /^127\./.test(host)

/** A pairing cookie is only marked `Secure` where the connection is HTTPS. */
const secure = (host: string) => !loopback(host)

async function loop(gen: number, target: number) {
  while (gen === generation) {
    status = "connecting"
    lastError = null
    controller = new AbortController()
    try {
      const conn = await client.tunnel.connect({
        profile: PROFILE,
        routes: { [ROUTE]: `127.0.0.1:${target}` },
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "connected") {
            status = "connected"
            lastError = null
          }
          if (event.type === "disconnected") status = "connecting"
          if (event.type === "route-conflict") {
            lastError = "Another OpenTunnel client is using the bots route"
          }
        },
      })
      if (gen !== generation) {
        await conn.close()
        return
      }
      connection = conn
      status = "connected"
      lastError = null
      if (stored.hostname !== conn.tunnel.hostname) {
        stored = { ...stored, hostname: conn.tunnel.hostname }
        persist(stored)
      }
      await conn.closed
      if (gen !== generation) return
      status = "error"
      lastError = "Tunnel disconnected"
    } catch (cause) {
      if (gen !== generation) return
      status = "error"
      lastError = message(cause)
    } finally {
      connection = undefined
    }
    if (gen !== generation) return
    await sleep(5000)
  }
}

export const remote = {
  init(target: number) {
    void loop(++generation, target)
  },

  /**
   * Identifies the current pairing. Push subscriptions record it, so rotating
   * the secret also retires every subscription made before the rotation.
   */
  owner() {
    sync()
    return sign(stored.secret, "push")
  },

  /** Pairing is the only way in, so a tunneled request and a local one look the same. */
  required() {
    return process.env.BOT_NO_AUTH !== "1"
  },

  url() {
    return stored.hostname ? `https://${ROUTE}.${stored.hostname}` : null
  },

  view(): RemoteView {
    sync()
    return { status, url: this.url(), error: lastError }
  },

  session(request: Request): RemoteSession {
    return { authenticated: !this.required() || this.authorized(request), remote: this.view() }
  },

  authorized(request: Request) {
    sync()
    const value = cookie(request.headers.get("cookie"), COOKIE)
    if (!value) return false
    return safeEqual(value, token())
  },

  sessionCookie(request: Request) {
    sync()
    const flag = secure(hostOf(request)) ? "; Secure" : ""
    return `${COOKIE}=${token()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}${flag}`
  },

  sameOrigin(request: Request) {
    const origin = request.headers.get("origin")
    if (!origin) return true
    try {
      return new URL(origin).host === request.headers.get("host")
    } catch {
      return false
    }
  },

  async stop() {
    generation += 1
    controller?.abort()
    await connection?.close().catch(() => {})
    connection = undefined
    status = "error"
  },
}

function cookie(header: string | null, name: string) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return rest.join("=")
  }
  return undefined
}

function sign(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("base64url")
}

/**
 * The value every paired device carries. It is derived from the install secret,
 * so deleting `remote.json` rotates it and signs every device out.
 */
function token() {
  return sign(stored.secret, "device")
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
