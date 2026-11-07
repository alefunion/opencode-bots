/* Bots for OpenCode service worker: Web Push and notification clicks. */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("push", (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : "" }
  }

  const title = typeof payload.title === "string" ? payload.title : "Bots for OpenCode"
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: typeof payload.tag === "string" ? payload.tag : "opencode-bots",
    renotify: true,
    data: { url: typeof payload.url === "string" ? payload.url : "/" },
  }

  // Safari revokes web-push permission when a push does not produce a visible
  // notification, so this must run for every push.
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  // Only ever open this app: a path such as `//elsewhere.example` would
  // otherwise resolve to another origin.
  let target = new URL("/", self.location.origin).href
  try {
    const url = new URL(event.notification.data?.url ?? "/", self.location.origin)
    if (url.origin === self.location.origin) target = url.href
  } catch {
    // Keep the app root.
  }

  event.waitUntil(
    (async () => {
      const [client] = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      if (!client) return self.clients.openWindow(target)
      await client.focus()
      // An uncontrolled client cannot be navigated; focusing it is enough.
      await client.navigate(target).catch(() => {})
      return client
    })(),
  )
})
