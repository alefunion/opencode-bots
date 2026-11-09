import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Dictation through Hex (https://github.com/anomalyco/hex), the local voice
 * dictation app. The running Hex publishes an owner-only local API; this module
 * reads its discovery file and sends finished WAV clips to its
 * `POST /transcriptions`. Hex runs them on the model dictation already holds,
 * so no second copy of the model is loaded. The bearer token never leaves this
 * process: the browser only ever talks to `/api/transcribe`.
 */

/** Hex rejects bigger uploads at 64 MiB; ten minutes of 48 kHz mono 16-bit is about 55 MiB. */
export const MAX_CLIP_BYTES = 60 * 1024 * 1024

const HEX_DIR =
  process.env.HEX_APPLICATION_SUPPORT_DIR ??
  (process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "hex")
    : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "hex"))

type Discovery = { url: string; token: string }

export class HexError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function discover(): Promise<Discovery> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(HEX_DIR, "local-api.json"), "utf8"))
  } catch {
    throw new HexError("Hex isn't running. Open Hex on your computer to dictate.", 503)
  }
  const { port, token, pid } = (raw ?? {}) as { port?: unknown; token?: unknown; pid?: unknown }
  if (typeof port !== "number" || typeof token !== "string" || typeof pid !== "number") {
    throw new HexError("Hex's local API file is not readable.", 503)
  }
  try {
    process.kill(pid, 0)
  } catch {
    // The file outlives a Hex that quit or crashed.
    throw new HexError("Hex isn't running. Open Hex on your computer to dictate.", 503)
  }
  return { url: `http://127.0.0.1:${port}`, token }
}

async function call(hex: Discovery, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${hex.token}`)
  try {
    return await fetch(new URL(path, hex.url), { ...init, headers })
  } catch {
    throw new HexError("Hex isn't answering. Try again, or restart Hex.", 503)
  }
}

/** The model and language Hex dictates with, so the clip runs on the warm model. */
async function dictationModel(hex: Discovery) {
  const response = await call(hex, "/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 4, command: "status" }),
  })
  // Linux and Windows Hex answer `/control` with 404 for now; take the first
  // installed model there instead.
  if (response.status === 404) return firstInstalledModel(hex)
  const body = (await response.json().catch(() => ({}))) as {
    model?: { id?: unknown; name?: unknown; language?: unknown; installed?: unknown }
  }
  const model = body.model
  if (!response.ok || typeof model?.id !== "string") {
    throw new HexError("Hex didn't say which model it uses. Update Hex and try again.", 502)
  }
  if (model.installed === false) {
    throw new HexError("Hex's model isn't downloaded yet. Finish setup in Hex.", 409)
  }
  return {
    id: model.id,
    name: typeof model.name === "string" ? model.name : model.id,
    language: typeof model.language === "string" ? model.language : "en",
  }
}

async function firstInstalledModel(hex: Discovery) {
  const response = await call(hex, "/models")
  const models = (await response.json().catch(() => [])) as {
    id?: unknown
    name?: unknown
    installed?: unknown
    languages?: unknown
  }[]
  const model = Array.isArray(models)
    ? models.find((item) => item.installed === true && typeof item.id === "string")
    : undefined
  if (!response.ok || !model) {
    throw new HexError("Hex has no model downloaded yet. Finish setup in Hex.", 409)
  }
  const languages = Array.isArray(model.languages) ? model.languages : []
  return {
    id: model.id as string,
    name: typeof model.name === "string" ? model.name : (model.id as string),
    language: languages.includes("en") || languages.length === 0 ? "en" : String(languages[0]),
  }
}

/**
 * Whether dictation can work right now, for the composer's microphone button.
 * `installed` hides the button for people who have never run Hex.
 */
export async function hexStatus() {
  const installed = existsSync(HEX_DIR)
  try {
    const model = await dictationModel(await discover())
    return { available: true as const, installed, model: model.name }
  } catch (cause) {
    return {
      available: false as const,
      installed,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

const REFUSALS: Record<string, string> = {
  "invalid-audio": "That recording couldn't be read.",
  "model-not-ready": "Hex's model isn't ready. Open Hex and try again.",
}

export async function transcribe(wav: ArrayBuffer): Promise<{ text: string; durationMs: number }> {
  const hex = await discover()
  const model = await dictationModel(hex)
  const query = new URLSearchParams({ model: model.id, language: model.language })
  const response = await call(hex, `/transcriptions?${query}`, {
    method: "POST",
    headers: { "content-type": "audio/wav" },
    body: wav,
  })
  const body = (await response.json().catch(() => ({}))) as {
    transcript?: unknown
    durationMs?: unknown
    code?: unknown
  }
  if (!response.ok || typeof body.transcript !== "string") {
    const code = typeof body.code === "string" ? body.code : ""
    throw new HexError(
      REFUSALS[code] ?? `Hex couldn't transcribe that (${code || response.status}).`,
      response.status >= 400 && response.status < 500 ? 422 : 502,
    )
  }
  return {
    text: body.transcript.trim(),
    durationMs: typeof body.durationMs === "number" ? body.durationMs : 0,
  }
}
