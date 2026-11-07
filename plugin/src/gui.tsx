import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import qrcode from "qrcode-generator"
import { Plugin, SettingsPage, usePlugin } from "@opencode/plugin/gui"
import { WEB_PORT } from "./port"
import { BotsRpc } from "./rpc"

type Address = {
  url: string | null
  status: "connecting" | "connected" | "error"
  error?: string | null
  workspace?: string | null
}

type Ctx = ReturnType<typeof usePlugin>

/**
 * The bot app knows its tunnel state. If that request is blocked, fall back to
 * deriving the address from OpenCode's own tunnel URL: both use the same
 * OpenTunnel identity, and the bot app always claims the `bots` route.
 */
const readAddress = async (ctx: Pick<Ctx, "client">): Promise<Address> => {
  try {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/bots/address`, { cache: "no-store" })
    if (response.ok) return (await response.json()) as Address
  } catch {
    // Blocked by CSP or the web host is still starting; try the derivation.
  }
  try {
    const info = await ctx.client.server.info()
    for (const value of info.urls) {
      const host = new URL(value).hostname
      if (!host.endsWith(".opentunnel.xyz")) continue
      const index = host.indexOf(".")
      if (index > 0) return { url: `https://bots.${host.slice(index + 1)}`, status: "connected" }
    }
  } catch {
    // The server is unreachable.
  }
  return { url: null, status: "error" }
}

/**
 * The QR code OpenCode's own pairing dialog draws: modules in `currentColor`,
 * a transparent background, and a quiet zone of four modules. On a dark theme
 * the modules come out light on the dialog's own dark surface, as in the
 * built-in pairing dialog.
 */
const qrSvg = (value: string) => {
  const code = qrcode(0, "M")
  code.addData(value)
  code.make()
  const count = code.getModuleCount()
  const border = 4
  const size = count + border * 2
  const path: string[] = []
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (code.isDark(y, x)) path.push(`M${x + border},${y + border}h1v1h-1z`)
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `width="100%" height="100%" shape-rendering="crispEdges">` +
    `<path fill="currentColor" d="${path.join("")}"/></svg>`
  )
}

const countdown = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

const muted: JSX.CSSProperties = {
  "font-size": "13px",
  color: "var(--v2-text-text-muted)",
}

const danger: JSX.CSSProperties = {
  margin: 0,
  "font-size": "12px",
  color: "var(--v2-state-fg-danger)",
}

/** The host's settings row markup; its stylesheet loads with the settings screen. */
function Row(props: { title: string; description: JSX.Element; children: JSX.Element }) {
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <div data-slot="settings-row-description">{props.description}</div>
      </div>
      <div data-slot="settings-row-control">{props.children}</div>
    </div>
  )
}

function PairDialog(props: { address: string }) {
  const ctx = usePlugin()
  const [link, setLink] = createSignal<string | null>(null)
  const [expiresAt, setExpiresAt] = createSignal(0)
  const [now, setNow] = createSignal(Date.now())
  const [busy, setBusy] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  const mint = async () => {
    if (busy()) return
    setBusy(true)
    setError(null)
    try {
      const pairing = await ctx.client.server.pair()
      setLink(`${props.address}/pair/${pairing.code}`)
      setExpiresAt(Date.now() + pairing.expires_in * 1000)
      setNow(Date.now())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    const value = link()
    if (!value) return
    try {
      await ctx.system.copy(value)
      setCopied(true)
      clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(ctx.t("copy.error"))
    }
  }

  const remaining = () => Math.max(0, Math.ceil((expiresAt() - now()) / 1000))
  const expired = () => !!link() && remaining() <= 0

  onMount(() => {
    void mint()
    const clock = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => {
      clearInterval(clock)
      clearTimeout(copiedTimer)
    })
  })

  return (
    <ctx.ui.Dialog
      size="fit"
      title={ctx.t("pair.title")}
      description={ctx.t("dialog.description")}
      footer={
        <div
          style={{
            display: "flex",
            width: "100%",
            "flex-wrap": "wrap",
            "align-items": "center",
            gap: "8px",
          }}
        >
          <span
            style={{
              "margin-inline-end": "auto",
              "font-size": "12px",
              "font-variant-numeric": "tabular-nums",
              color: "var(--v2-text-text-muted)",
            }}
            role="timer"
            aria-live="off"
          >
            <Show when={link()} fallback={ctx.t("generating")}>
              {expired() ? ctx.t("expired") : `${ctx.t("expires")} ${countdown(remaining())}`}
            </Show>
          </span>
          <div style={{ "margin-inline-start": "auto", display: "flex", gap: "8px" }}>
            <ctx.ui.Button variant="ghost" busy={busy()} onClick={() => void mint()}>
              {ctx.t("refresh")}
            </ctx.ui.Button>
            <ctx.ui.Button
              variant="neutral"
              icon={copied() ? "check" : "copy"}
              disabled={!link() || busy()}
              onClick={() => void copy()}
            >
              {copied() ? ctx.t("copied") : ctx.t("copy.link")}
            </ctx.ui.Button>
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
        <Show
          when={link()}
          fallback={
            <div
              role="status"
              style={{
                display: "flex",
                "flex-direction": "column",
                "align-items": "center",
                "justify-content": "center",
                gap: "8px",
                width: "100%",
                "aspect-ratio": "1",
                padding: "24px",
                "box-sizing": "border-box",
                "border-radius": "6px",
                background: "var(--v2-background-bg-layer-01)",
                "text-align": "center",
              }}
            >
              <ctx.ui.Loader size="small" />
              <Show when={error()}>{(message) => <p style={danger}>{message()}</p>}</Show>
            </div>
          }
        >
          {(value) => (
            <div
              role="img"
              aria-label={ctx.t("qr")}
              style={{
                width: "100%",
                "aspect-ratio": "1",
                padding: "24px",
                "box-sizing": "border-box",
                "border-radius": "6px",
                background: "var(--v2-background-bg-base)",
                color: "var(--v2-text-text-base)",
              }}
              innerHTML={qrSvg(value())}
            />
          )}
        </Show>
        <Show when={error() && link()}>{(message) => <p style={danger}>{message()}</p>}</Show>
      </div>
    </ctx.ui.Dialog>
  )
}

function BotsSettings() {
  const ctx = usePlugin()
  const [address, setAddress] = createSignal<Address | null>(null)
  const [copied, setCopied] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  const refresh = async () => {
    setAddress(await readAddress(ctx))
  }

  onMount(() => {
    void refresh()
    const poll = setInterval(() => void refresh(), 4000)
    onCleanup(() => {
      clearInterval(poll)
      clearTimeout(copiedTimer)
    })
  })

  const copy = async () => {
    const value = address()?.url
    if (!value) return
    try {
      await ctx.system.copy(value)
      setCopied(true)
      clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => setCopied(false), 2000)
    } catch {
      // The address is on the page, so a failed copy needs no alert.
    }
  }

  const pair = () => {
    const url = address()?.url
    if (!url) return
    ctx.dialogs.open(() => <PairDialog address={url} />)
  }

  const status = () => {
    const value = address()
    if (!value) return ctx.t("checking")
    if (value.status === "connected") return ctx.t("connected")
    if (value.status === "connecting") return ctx.t("connecting")
    return ctx.t("disconnected")
  }

  const revoke = async () => {
    if (busy()) return
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("revoke.title"),
      description: ctx.t("revoke.description"),
      confirm: ctx.t("revoke.confirm"),
      danger: true,
    })
    if (!confirmed) return

    setBusy(true)
    setError(null)
    try {
      // The bot RPC lives in the bot workspace location, not in this window's.
      const directory = address()?.workspace ?? undefined
      await ctx.client
        .rpc(BotsRpc)
        .revokeDevices({}, directory ? { location: { directory } } : undefined)
      ctx.toast.show({ title: ctx.t("revoke.done"), variant: "success" })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
            <h2 class="settings-tab-title">{ctx.t("title")}</h2>
            <span style={muted}>{ctx.t("description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <section class="settings-section" aria-label={ctx.t("title")}>
          <div data-component="settings-list">
            <Row
              title={ctx.t("address.title")}
              description={address()?.url ?? <span style={muted}>{ctx.t("address.starting")}</span>}
            >
              <ctx.ui.Button
                variant="neutral"
                icon={copied() ? "check" : "copy"}
                disabled={!address()?.url}
                onClick={() => void copy()}
              >
                {copied() ? ctx.t("copied") : ctx.t("copy")}
              </ctx.ui.Button>
            </Row>
            <Row title={ctx.t("pair.title")} description={ctx.t("pair.description")}>
              <ctx.ui.Button variant="neutral" disabled={!address()?.url} onClick={pair}>
                {ctx.t("pair.open")}
              </ctx.ui.Button>
            </Row>
            <Row title={ctx.t("connection.title")} description={ctx.t("connection.description")}>
              <span style={muted}>{status()}</span>
            </Row>
            <Row title={ctx.t("revoke.title")} description={ctx.t("revoke.description")}>
              <ctx.ui.Button
                variant="neutral"
                busy={busy()}
                disabled={busy()}
                onClick={() => void revoke()}
              >
                {ctx.t("revoke.confirm")}
              </ctx.ui.Button>
            </Row>
          </div>
          <Show when={error()}>
            {(message) => (
              <p style={danger} role="alert">
                {message()}
              </p>
            )}
          </Show>
          <Show when={address()?.error}>
            {(message) => (
              <p style={danger} role="alert">
                {message()}
              </p>
            )}
          </Show>
        </section>
      </div>
    </>
  )
}

export default Plugin.define({
  i18n: {
    en: {
      title: "Bots",
      description: "Persistent bot personas, published through OpenTunnel.",
      "address.title": "Address",
      "address.starting": "The tunnel is starting. This address appears once it is connected.",
      "pair.title": "Pair a device",
      "pair.description":
        "Connect a phone or another computer from anywhere through the same tunnel OpenCode uses. A device pairs once and stays signed in.",
      "pair.open": "Pair device",
      "connection.title": "Connection",
      "connection.description":
        "Bots for OpenCode runs beside OpenCode and reconnects on its own. Every device pairs before it can open a conversation.",
      "revoke.title": "Paired devices",
      "revoke.description":
        "Signs out every phone and computer that paired with the bot app and stops its notifications. They pair again with a new link. The tunnel stays connected.",
      "revoke.confirm": "Sign out all devices",
      "revoke.done": "Every device was signed out",
      "dialog.description": "Scan the code with a phone or another computer, or copy the link.",
      qr: "Pairing QR code",
      expires: "Expires in",
      expired: "Expired",
      generating: "Generating a code…",
      refresh: "Refresh code",
      copy: "Copy",
      "copy.link": "Copy link",
      copied: "Copied",
      "copy.error": "Could not copy to the clipboard.",
      checking: "Checking…",
      connected: "Connected",
      connecting: "Connecting…",
      disconnected: "Not connected",
    },
  },
  setup(ctx) {
    ctx.add(SettingsPage, {
      id: "bots",
      // `server` is already taken by Settings → Servers and Settings → Pairing.
      icon: "bubble-5",
      get title() {
        return ctx.t("title")
      },
      get entries() {
        return [
          {
            id: "address",
            title: ctx.t("title"),
            description: ctx.t("description"),
            keywords: "bots pairing tunnel qr remote phone address",
          },
        ]
      },
      render: () => <BotsSettings />,
    })
  },
})
