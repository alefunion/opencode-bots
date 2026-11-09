import { homedir } from "node:os"
import { join } from "node:path"
import { serve } from "bun"
import QRCode from "qrcode"
import { Service } from "@opencode/client/service"
import index from "./index.html"
import { WEB_PORT } from "../../plugin/src/port"
import { remote } from "./remote"
import { HexError, MAX_CLIP_BYTES, hexStatus, transcribe } from "./hex"
import {
  internalAuthorized,
  notify,
  publicKey,
  pushStore,
  subscribe,
  unsubscribe,
  type PushPayload,
} from "./push-store"

const WORKSPACE = process.env.BOT_WORKSPACE ?? join(homedir(), "Bots for OpenCode")
const PORT = Number(process.env.PORT ?? WEB_PORT)
const HOST = process.env.HOST ?? "127.0.0.1"
const FIXED_URL = process.env.OPENCODE_URL
const FIXED_PASSWORD = process.env.OPENCODE_PASSWORD
const EMBEDDED = process.env.BOT_EMBEDDED === "1"
const PARENT_PID = Number(process.env.BOT_PARENT_PID ?? 0)

if (PARENT_PID) {
  const watchdog = setInterval(() => {
    if (process.ppid !== PARENT_PID) process.exit(0)
  }, 5000)
  watchdog.unref()
}

type Endpoint = {
  url: string
  auth?: {
    type: "basic"
    username: string
    password: string
  }
}

let cached: Endpoint | undefined
let cachedAt = 0

async function endpoint(force = false): Promise<Endpoint> {
  if (FIXED_URL) {
    return {
      url: FIXED_URL,
      ...(FIXED_PASSWORD
        ? { auth: { type: "basic" as const, username: "opencode", password: FIXED_PASSWORD } }
        : {}),
    }
  }
  if (!force && cached && Date.now() - cachedAt < 30_000) return cached
  const version = (value: string) => value.startsWith("2.")
  const found = await Service.discover({ version })
  if (found) {
    cached = found
    cachedAt = Date.now()
    return found
  }
  if (EMBEDDED) {
    throw new Error("OpenCode background service is not registered yet")
  }
  const ensured = await Service.ensure({ version })
  cached = ensured
  cachedAt = Date.now()
  return ensured
}

/** Calls the OpenCode service on a path of its own, with its credentials. */
async function upstream(path: string, method = "GET"): Promise<Response> {
  const target = await endpoint()
  const headers = new Headers()
  const auth = Service.headers(target)
  if (auth) headers.set("authorization", auth.authorization)
  return fetch(new URL(path, target.url), { method, headers })
}

/**
 * A pairing code comes from OpenCode's own `POST /api/pair`, so the bot app and
 * OpenCode Desktop share one implementation, one expiry, and one set of codes.
 */
async function redeem(code: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) return false
  try {
    const response = await upstream(`/auth/connect/${encodeURIComponent(code)}`)
    return response.ok
  } catch {
    return false
  }
}

/** Mints a code on the OpenCode server and turns it into a link for this app. */
async function mint(request: Request) {
  const response = await upstream("/api/pair", "POST")
  if (!response.ok) throw new Error(`OpenCode answered ${response.status}`)
  const body = (await response.json()) as { code: string; expires_in: number }
  // The tunnel terminates TLS locally, so `request.url` would say http://.
  const origin = remote.url() ?? new URL(request.url).origin
  const link = `${origin}/pair/${body.code}`
  const qr = await QRCode.toDataURL(link, {
    margin: 1,
    width: 320,
    errorCorrectionLevel: "M",
    color: { dark: "#161616", light: "#ffffff" },
  }).catch(() => null)
  return { code: body.code, link, qr, expiresAt: Date.now() + body.expires_in * 1000 }
}

const fail = (message: string, status: number, cause?: unknown) =>
  Response.json(
    {
      error:
        cause === undefined
          ? message
          : `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
    },
    { status },
  )

/** Forwards a paired request to the OpenCode service with the service's own credentials. */
async function proxy(request: Request): Promise<Response> {
  const source = new URL(request.url)
  const headers = new Headers(request.headers)
  for (const name of ["host", "authorization", "origin", "referer", "connection", "cookie"]) {
    headers.delete(name)
  }
  // Buffered so the request can be replayed once if the cached endpoint is stale.
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()

  for (const retried of [false, true]) {
    let target: Endpoint
    try {
      target = await endpoint(retried)
    } catch (cause) {
      return fail("OpenCode Desktop service is not reachable", 503, cause)
    }
    const auth = Service.headers(target)
    if (auth) headers.set("authorization", auth.authorization)
    let response: Response
    try {
      response = await fetch(new URL(source.pathname + source.search, target.url), {
        method: request.method,
        headers,
        body,
        redirect: "manual",
      })
    } catch (cause) {
      // The service restarted on a new port; rediscover it and try once more.
      if (!retried) continue
      return fail("OpenCode request failed", 502, cause)
    }

    const output = new Headers(response.headers)
    output.delete("content-encoding")
    output.delete("content-length")
    output.delete("transfer-encoding")
    // The browser only ever holds this app's pairing cookie.
    output.delete("set-cookie")

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: output,
    })
  }
  return fail("OpenCode request failed", 502)
}

const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const expiredPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pairing link expired</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fafafa;color:#161616;
    font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}
  main{max-width:380px;text-align:center}
  h1{font-size:17px;font-weight:560;margin:0 0 8px}
  p{margin:0;color:#6b6b6b}
</style></head>
<body><main><h1>This pairing link is no longer valid</h1>
<p>Links work once and expire after five minutes. In OpenCode Desktop, open Settings &rarr; Bots and create a new one.</p>
</main></body></html>`

const codeFrom = (value: string) => {
  const text = value.trim()
  if (!text) return ""
  if (text.includes("/pair/")) return (text.split("/pair/").pop() ?? "").split(/[?#]/)[0] ?? ""
  return text
}

async function api(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname

  if (path === "/api/session" && request.method === "GET") {
    return Response.json(remote.session(request), {
      headers: { "cache-control": "no-store" },
    })
  }

  // Codes are 128-bit, single-use, and expire after five minutes, so guessing is
  // not a practical attack. A global lockout would only let strangers block the
  // owner from pairing.
  if (path === "/api/pair" && request.method === "POST") {
    const body = await readJson(request)
    if (!(await redeem(codeFrom(typeof body.link === "string" ? body.link : "")))) {
      return fail("That pairing link is not valid.", 401)
    }
    return Response.json({ ok: true }, { headers: { "set-cookie": remote.sessionCookie(request) } })
  }

  if (remote.required() && !remote.authorized(request)) return fail("unauthorized", 401)

  if (request.method !== "GET" && request.method !== "HEAD" && !remote.sameOrigin(request)) {
    return fail("bad origin", 403)
  }

  if (path === "/api/push/key" && request.method === "GET") {
    return Response.json({ publicKey: publicKey() }, { headers: { "cache-control": "no-store" } })
  }

  if (path === "/api/push/subscribe" && request.method === "POST") {
    try {
      return Response.json(subscribe((await readJson(request)).subscription, remote.owner()))
    } catch (cause) {
      return fail("Could not save that subscription", 400, cause)
    }
  }

  if (path === "/api/push/unsubscribe" && request.method === "POST") {
    const endpoint = (await readJson(request)).endpoint
    if (typeof endpoint !== "string" || !endpoint) return fail("endpoint is required", 400)
    return Response.json(unsubscribe(endpoint))
  }

  if (path === "/api/push/test" && request.method === "POST") {
    return send({
      title: "Bots for OpenCode",
      body: "Notifications are working on this device.",
      url: "/",
      tag: "opencode-bots:test",
    })
  }

  if (path === "/api/transcribe" && request.method === "GET") {
    return Response.json(await hexStatus(), { headers: { "cache-control": "no-store" } })
  }

  if (path === "/api/transcribe" && request.method === "POST") {
    const length = Number(request.headers.get("content-length") ?? 0)
    if (length > MAX_CLIP_BYTES) return fail("That recording is too long.", 413)
    const wav = await request.arrayBuffer()
    if (wav.byteLength > MAX_CLIP_BYTES) return fail("That recording is too long.", 413)
    try {
      return Response.json(await transcribe(wav))
    } catch (cause) {
      if (cause instanceof HexError) return fail(cause.message, cause.status)
      return fail("Could not transcribe that", 502, cause)
    }
  }

  if (path === "/api/pair/code" && request.method === "POST") {
    try {
      return Response.json(await mint(request))
    } catch (cause) {
      return fail("Could not create a pairing link", 502, cause)
    }
  }

  return proxy(request)
}

async function send(payload: PushPayload) {
  try {
    return Response.json(await notify(payload, remote.owner(), remote.url() ?? undefined))
  } catch (cause) {
    return fail("Could not send the notification", 500, cause)
  }
}

/** A same-app path such as `/?bot=<id>`; anything else becomes the app root. */
const appPath = (value: unknown) =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value.slice(0, 500)
    : "/"

const clip = (value: unknown, max: number, fallback: string) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback

const ICONS = new URL("./icons/", import.meta.url)
const ICON_NAMES = [
  "icon-192.png",
  "icon-512.png",
  "maskable-192.png",
  "maskable-512.png",
  "apple-touch-icon.png",
]

const iconResponse = (name: string) =>
  new Response(Bun.file(new URL(name, ICONS)), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
    },
  })

const iconRoutes = Object.fromEntries(
  ICON_NAMES.map((name) => [`/icons/${name}`, () => iconResponse(name)]),
)

remote.init(PORT)
pushStore()

const server = serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 0,
  routes: {
    ...iconRoutes,
    "/sw.js": () =>
      new Response(Bun.file(new URL("./sw.js", import.meta.url)), {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "service-worker-allowed": "/",
          "cache-control": "no-cache",
        },
      }),
    // The plugin's notify request. The tunnel forwards the visitor's own Host
    // header, so a "local only" check would be spoofable; the 256-bit internal
    // secret in push.json (mode 0600) is what authorizes it.
    "/bots/notify": {
      async POST(request) {
        if (!internalAuthorized(request.headers.get("x-bots-internal") ?? "")) {
          return fail("unauthorized", 401)
        }
        const body = await readJson(request)
        return send({
          title: clip(body.title, 120, "Bots for OpenCode"),
          body: clip(body.body, 300, ""),
          url: appPath(body.url),
          tag: clip(body.tag, 120, "opencode-bots"),
        })
      },
    },
    "/bots/address": {
      GET() {
        // The public address is not a secret: the pairing link is. The desktop
        // settings page reads it to show the QR code, and the workspace path so
        // it can reach the bot RPC (registered in that location only).
        const view = remote.view()
        return Response.json(
          { url: view.url, status: view.status, error: view.error, workspace: WORKSPACE },
          { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } },
        )
      },
    },
    "/bots/config": {
      GET(request) {
        if (remote.required() && !remote.authorized(request)) return fail("unauthorized", 401)
        return Response.json({ workspace: WORKSPACE })
      },
    },
    "/pair/:code": {
      async GET(request) {
        const code = new URL(request.url).pathname.split("/").pop() ?? ""
        if (!(await redeem(code))) {
          return new Response(expiredPage, {
            status: 410,
            headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
          })
        }
        return new Response(null, {
          status: 302,
          headers: {
            location: "/",
            "set-cookie": remote.sessionCookie(request),
            "cache-control": "no-store",
          },
        })
      },
    },
    "/api/*": (request) => api(request),
    "/*": index,
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
})

console.log(`Bots web app: ${server.url}`)
console.log(`Bot workspace: ${WORKSPACE}`)
console.log(`Bots tunnel: ${remote.url() ?? "connecting"}`)
