import { useEffect, useState } from "react"
import { remoteApi } from "../api"
import { disablePush, enablePush, pushStatus, sendTestPush, type PushStatus } from "../push"
import type { PairingLink, RemoteInfo } from "../types"

const statusLabel = (info: RemoteInfo) => {
  if (info.status === "connected") return "Connected"
  if (info.status === "connecting") return "Connecting…"
  return "Not connected"
}

const remaining = (expiresAt: number, now: number) => {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

export function RemotePanel({
  info,
  onToast,
}: {
  info: RemoteInfo
  onToast: (message: string, variant?: "success" | "error") => void
}) {
  const [remote, setRemote] = useState<RemoteInfo>(info)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<PairingLink | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)
  const [push, setPush] = useState<PushStatus | null>(null)
  const [pushBusy, setPushBusy] = useState(false)

  useEffect(() => {
    setRemote(info)
  }, [info])

  useEffect(() => {
    let stopped = false
    void pushStatus().then((status) => {
      if (!stopped) setPush(status)
    })
    return () => {
      stopped = true
    }
  }, [])

  useEffect(() => {
    let stopped = false
    const tick = async () => {
      try {
        const session = await remoteApi.session()
        if (!stopped) setRemote(session.remote)
      } catch {
        // The server restarts with the plugin; the next tick picks it up.
      }
    }
    const poll = setInterval(tick, 3000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      stopped = true
      clearInterval(poll)
      clearInterval(clock)
    }
  }, [])

  const create = async () => {
    if (busy) return
    setBusy(true)
    try {
      const created = await remoteApi.code()
      setLink(created)
      setNow(Date.now())
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : String(cause), "error")
    } finally {
      setBusy(false)
    }
  }

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      onToast("Could not copy to the clipboard", "error")
    }
  }

  const runPush = async (action: () => Promise<string>) => {
    if (pushBusy) return
    setPushBusy(true)
    try {
      onToast(await action(), "success")
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : String(cause), "error")
    } finally {
      setPush(await pushStatus())
      setPushBusy(false)
    }
  }

  const enableNotifications = () =>
    runPush(async () => {
      await enablePush()
      return "Notifications enabled for this device"
    })

  const disableNotifications = () =>
    runPush(async () => {
      await disablePush()
      return "Notifications turned off for this device"
    })

  const testNotification = () =>
    runPush(async () => {
      const result = await sendTestPush()
      if (result.sent === 0) throw new Error("No subscribed devices received the test")
      return `Test notification sent to ${result.sent} device(s)`
    })

  const expired = link ? link.expiresAt <= now : false
  const pushActive = !!push?.subscribed && push.permission === "granted"
  const needsInstall = !!push?.ios && !push.standalone
  const pushAvailable = !!push?.supported && push.permission !== "denied" && !needsInstall
  const pushLabel = !push
    ? "Checking…"
    : !push.supported
      ? "Unsupported"
      : needsInstall
        ? "Add to Home Screen"
        : push.permission === "denied"
          ? "Blocked"
          : pushActive
            ? "On for this device"
            : "Off"

  return (
    <>
      <section className="settings-section">
        <div className="field">
          <span>Address</span>
          <div className="remote-row">
            <span className={`remote-pill remote-pill-${remote.status}`}>
              {statusLabel(remote)}
            </span>
            {remote.url ? (
              <button className="secondary-button" onClick={() => void copy(remote.url ?? "")}>
                {copied ? "Copied" : "Copy address"}
              </button>
            ) : null}
          </div>
        </div>
        {remote.url ? (
          <div className="remote-url">
            <code>{remote.url}</code>
          </div>
        ) : null}
        <p className="hint">
          This app is published through OpenTunnel on the address above. Open it on a phone or
          another computer and pair it once; it stays signed in after that.
        </p>
        {remote.error ? <p className="hint remote-error">{remote.error}</p> : null}
      </section>

      <section className="settings-section">
        <div className="field">
          <span>Notifications</span>
          <div className="remote-row">
            <span
              className={`remote-pill ${pushActive ? "remote-pill-connected" : "remote-pill-off"}`}
            >
              {pushLabel}
            </span>
            <div className="remote-actions">
              {pushActive ? (
                <button
                  className="secondary-button"
                  onClick={() => void testNotification()}
                  disabled={pushBusy}
                >
                  Send test
                </button>
              ) : (
                <button
                  className="primary-button"
                  onClick={() => void enableNotifications()}
                  disabled={pushBusy || !pushAvailable}
                >
                  {pushBusy ? "Working…" : "Enable notifications"}
                </button>
              )}
              {push?.subscribed ? (
                <button
                  className="secondary-button"
                  onClick={() => void disableNotifications()}
                  disabled={pushBusy}
                >
                  Turn off
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <p className="hint">
          Get a notification when a bot or group finishes a job. Notifications are per device and
          continue while the app is closed.
        </p>
        {needsInstall ? (
          <p className="hint remote-error">
            On iPhone and iPad, add this app to your Home Screen, then open it from the icon to
            enable notifications.
          </p>
        ) : null}
        {push?.permission === "denied" ? (
          <p className="hint remote-error">
            Notifications are blocked for this app. Allow them in the system or browser settings for
            this site.
          </p>
        ) : null}
        {push && !push.supported ? (
          <p className="hint remote-error">This browser does not support web push.</p>
        ) : null}
      </section>

      <section className="settings-section">
        <div className="field">
          <span>Add another device</span>
          <button className="primary-button" onClick={() => void create()} disabled={busy}>
            {busy ? "Working…" : link ? "Create a new link" : "Create a pairing link"}
          </button>
        </div>
        <p className="hint">
          Open the link on the other device, or scan the code with its camera. Links work once and
          expire after five minutes.
        </p>
        {link ? (
          <div className="pairing-card">
            {link.qr ? <img className="pairing-qr" src={link.qr} alt="Pairing QR code" /> : null}
            <div className="pairing-details">
              {link.link ? <code className="pairing-link">{link.link}</code> : null}
              <p className="hint">
                {expired
                  ? "This link has expired. Create a new one."
                  : `Expires in ${remaining(link.expiresAt, now)}.`}
              </p>
              {link.link ? (
                <button
                  className="secondary-button"
                  onClick={() => void copy(link.link ?? "")}
                  disabled={expired}
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </>
  )
}
