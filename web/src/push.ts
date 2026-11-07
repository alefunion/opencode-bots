export type PushStatus = {
  supported: boolean
  permission: NotificationPermission | "unsupported"
  subscribed: boolean
  standalone: boolean
  ios: boolean
}

const supported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

const keyBytes = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (c) =>
    c.charCodeAt(0),
  )
}

const sameKey = (value: BufferSource | null, expected: Uint8Array) => {
  if (!value) return true
  const actual = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value)
  return (
    actual.length === expected.length && actual.every((byte, index) => byte === expected[index])
  )
}

const post = async (path: string, body?: unknown) => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  if (!response.ok) throw new Error(`${path} failed (${response.status}).`)
  return response.json() as Promise<unknown>
}

const current = async () => {
  const registration = await navigator.serviceWorker.getRegistration("/")
  return (await registration?.pushManager.getSubscription()) ?? null
}

/**
 * The browser subscription for the server's current VAPID key, saved for the
 * current pairing. A subscription made for an old key (push.json was recreated)
 * is replaced, because the server can no longer sign for it.
 */
const subscribeAndSave = async () => {
  const registration =
    (await navigator.serviceWorker.getRegistration("/")) ??
    (await navigator.serviceWorker.register("/sw.js", { scope: "/" }))
  await navigator.serviceWorker.ready
  const response = await fetch("/api/push/key")
  if (!response.ok) throw new Error(`Could not read the push key (${response.status}).`)
  const key = keyBytes(((await response.json()) as { publicKey: string }).publicKey)

  let subscription = await registration.pushManager.getSubscription()
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await post("/api/push/unsubscribe", { endpoint: subscription.endpoint }).catch(() => {})
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  })
  await post("/api/push/subscribe", { subscription: subscription.toJSON() })
}

export async function pushStatus(): Promise<PushStatus> {
  const base = { standalone: isStandalone(), ios: isIOS() }
  if (!supported())
    return { ...base, supported: false, permission: "unsupported", subscribed: false }
  // A worker that is still installing reports Off rather than leaving the UI spinning.
  const subscription = await current().catch(() => null)
  return {
    ...base,
    supported: true,
    permission: Notification.permission,
    subscribed: !!subscription,
  }
}

export async function enablePush() {
  if (!supported()) throw new Error("This browser does not support notifications.")
  if (isIOS() && !isStandalone()) {
    throw new Error("On iPhone, add this app to your Home Screen and open it from there first.")
  }
  // Safari requires the permission request to come from the tap that started
  // this call, so ask before any other await.
  if ((await Notification.requestPermission()) !== "granted") {
    throw new Error("Notifications were not allowed for this app.")
  }
  await subscribeAndSave()
}

/**
 * Re-save an existing subscription on app start. This covers re-pairing after
 * a revocation (which retires server-side subscriptions) and a rotated VAPID key.
 */
export async function syncPushSubscription() {
  if (!supported() || Notification.permission !== "granted" || !(await current())) return
  await subscribeAndSave()
}

export const sendTestPush = () =>
  post("/api/push/test") as Promise<{ sent: number; removed: number }>

export async function disablePush() {
  if (!supported()) return
  const subscription = await current()
  if (!subscription) return
  await post("/api/push/unsubscribe", { endpoint: subscription.endpoint }).catch(() => {})
  await subscription.unsubscribe()
}
