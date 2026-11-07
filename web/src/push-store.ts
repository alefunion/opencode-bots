import { randomBytes, timingSafeEqual } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import * as webpush from "web-push"

/**
 * The web host owns push state in `push.json` (mode `0600`):
 *
 * - `vapid` identifies this install to every browser push service.
 * - `internal` lets the OpenCode plugin ask the web host to send a notification
 *   without holding a pairing cookie.
 * - `subscriptions` are the devices that opted in. Each records the pairing
 *   `owner` it was made under; rotating the pairing secret changes the owner,
 *   so subscriptions from before a revocation are never used again.
 */
type Subscription = webpush.PushSubscription & { owner: string }

type PushStore = {
  vapid: { publicKey: string; privateKey: string }
  internal: string
  subscriptions: Subscription[]
}

export type PushPayload = {
  title: string
  body: string
  url: string
  tag: string
}

const MAX_SUBSCRIPTIONS = 20
// Apple rejects `mailto:…@localhost` with 403 BadJwtToken; a real https URL works.
const FALLBACK_SUBJECT = process.env.BOT_VAPID_SUBJECT || "https://opentunnel.xyz"
const BASE64URL = /^[A-Za-z0-9_+/-]+={0,2}$/

const storePath = () =>
  join(
    process.env.BOT_DATA_DIR ?? join(homedir(), ".local", "share", "opencode", "bots"),
    "push.json",
  )

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim().length <= max ? value.trim() : ""

/** A browser `PushSubscription.toJSON()` with an https endpoint, or null. */
const clean = (value: unknown, owner: string): Subscription | null => {
  const record = (value ?? {}) as { endpoint?: unknown; keys?: Record<string, unknown> }
  const endpoint = text(record.endpoint, 2048)
  const p256dh = text(record.keys?.p256dh, 200)
  const auth = text(record.keys?.auth, 100)
  if (p256dh.length < 60 || auth.length < 16) return null
  if (!BASE64URL.test(p256dh) || !BASE64URL.test(auth)) return null
  try {
    const url = new URL(endpoint)
    if (url.protocol !== "https:" || url.username || url.password) return null
  } catch {
    return null
  }
  return { endpoint, keys: { p256dh, auth }, owner }
}

const persist = (value: PushStore) => {
  const path = storePath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp-${process.pid}`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
  chmodSync(path, 0o600)
}

const read = (): PushStore | null => {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as Partial<PushStore>
    const vapid = parsed.vapid
    if (
      typeof vapid?.publicKey !== "string" ||
      typeof vapid.privateKey !== "string" ||
      vapid.publicKey.length < 80 ||
      vapid.privateKey.length < 40 ||
      typeof parsed.internal !== "string" ||
      parsed.internal.length < 32
    ) {
      return null
    }
    const subscriptions = (Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [])
      .map((item) => (typeof item?.owner === "string" ? clean(item, item.owner) : null))
      .filter((item): item is Subscription => !!item)
    return {
      vapid: { publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      internal: parsed.internal,
      subscriptions,
    }
  } catch {
    return null
  }
}

/**
 * Read the install's push state, creating it on first use. Deleting the file
 * rotates the VAPID keys; browsers resubscribe the next time the app opens.
 */
export function pushStore(): PushStore {
  const existing = read()
  if (existing) return existing
  const created: PushStore = {
    vapid: webpush.generateVAPIDKeys(),
    internal: randomBytes(32).toString("base64url"),
    subscriptions: [],
  }
  persist(created)
  return created
}

export const publicKey = () => pushStore().vapid.publicKey

export function internalAuthorized(value: string) {
  const left = Buffer.from(value)
  const right = Buffer.from(pushStore().internal)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Save `value` for the current pairing, dropping subscriptions from older ones. */
export function subscribe(value: unknown, owner: string) {
  const subscription = clean(value, owner)
  if (!subscription) throw new Error("That push subscription is not valid.")
  const store = pushStore()
  const subscriptions = [
    ...store.subscriptions.filter(
      (item) => item.owner === owner && item.endpoint !== subscription.endpoint,
    ),
    subscription,
  ].slice(-MAX_SUBSCRIPTIONS)
  persist({ ...store, subscriptions })
  return { ok: true, count: subscriptions.length }
}

export function unsubscribe(endpoint: string) {
  const store = pushStore()
  const subscriptions = store.subscriptions.filter((item) => item.endpoint !== endpoint)
  persist({ ...store, subscriptions })
  return { ok: true, count: subscriptions.length }
}

/**
 * Send one notification to every device subscribed under the current pairing.
 * 400/404/410 mean the subscription is gone and it is removed. 401/403 usually
 * mean a VAPID or configuration problem, so those subscriptions are kept.
 */
export async function notify(payload: PushPayload, owner: string, subject?: string) {
  const store = read()
  const targets = store?.subscriptions.filter((item) => item.owner === owner) ?? []
  if (!store || targets.length === 0) return { sent: 0, removed: 0 }

  const vapidDetails = {
    subject: subject || FALLBACK_SUBJECT,
    publicKey: store.vapid.publicKey,
    privateKey: store.vapid.privateKey,
  }
  const gone = new Set<string>()
  let sent = 0
  for (const subscription of targets) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), {
        TTL: 3600,
        urgency: "normal",
        vapidDetails,
      })
      sent += 1
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 400 || status === 404 || status === 410) {
        gone.add(subscription.endpoint)
        continue
      }
      console.warn(
        "[opencode-bots] push delivery failed",
        status ?? "",
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  if (gone.size > 0) {
    // Re-read: a device may have subscribed while these sends were in flight.
    const latest = pushStore()
    persist({
      ...latest,
      subscriptions: latest.subscriptions.filter((item) => !gone.has(item.endpoint)),
    })
  }
  return { sent, removed: gone.size }
}
