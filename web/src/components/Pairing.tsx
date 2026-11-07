import { useState } from "react"
import { remoteApi } from "../api"
import { Mark } from "../icons"

export function Pairing({ onPaired }: { onPaired: () => Promise<void> }) {
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await remoteApi.pair(value.trim())
      await onPaired()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="boot pairing">
      <Mark size={36} />
      <h1>Pair this device</h1>
      <p>
        Bots for OpenCode lives on a private address. Paste the pairing link from OpenCode Desktop,
        or scan its QR code with this device's camera.
      </p>
      <form className="pairing-form" onSubmit={submit}>
        <label className="field">
          <span>Pairing link</span>
          <input
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            placeholder="https://bots…/pair/…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
          />
        </label>
        {error ? <p className="pairing-error">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={busy || !value.trim()}>
          {busy ? "Checking…" : "Connect"}
        </button>
      </form>
      <p className="muted pairing-hint">
        In OpenCode Desktop, open Settings → Bots to show the link and its QR code. Links work once
        and expire after five minutes.
      </p>
    </div>
  )
}
