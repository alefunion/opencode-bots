import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Dictation through Hex (https://github.com/anomalyco/hex), the local voice
 * dictation app. The running Hex publishes an owner-only local API; this module
 * reads its discovery file and relays the browser's audio to it: live, as a
 * `/streams` stream (docs/streams.md in Hex), or as one finished WAV clip to
 * `POST /transcriptions` when no stream can be had. Either way Hex runs it on
 * the model dictation already holds, so no second copy is loaded. The bearer
 * and stream tokens never leave this process: the browser only ever talks to
 * `/api/dictation` and `/api/transcribe`.
 */

/** Ten minutes of 16 kHz mono 16-bit is about 19 MB; Hex itself stops at 64 MiB. */
export const MAX_CLIP_BYTES = 24 * 1024 * 1024

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
  const { port, token, pid, apiVersion } = (raw ?? {}) as Record<string, unknown>
  if (typeof port !== "number" || typeof token !== "string" || typeof pid !== "number") {
    throw new HexError("Hex's local API file is not readable.", 503)
  }
  if (apiVersion !== "2") {
    throw new HexError(`This Hex speaks local API ${String(apiVersion)}; dictation needs 2.`, 503)
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

/**
 * `process=global` asks Hex for the text after its Global mode's Output
 * processing (replacements, corrections, rewrite, transformations), behind
 * Labs › Process API transcripts. Hex refuses it before reading the audio or
 * finishing the stream, so on these codes the request is sent again without it
 * and the raw text is used.
 */
const PROCESSING_REFUSALS = new Set(["processing-disabled", "processing-unavailable", "queue-full"])

type HexBody = Record<string, unknown> & { code?: unknown }

async function processed(
  send: (process: boolean) => Promise<Response>,
): Promise<{ response: Response; body: HexBody }> {
  let response = await send(true)
  let body = (await response.json().catch(() => ({}))) as HexBody
  if (!response.ok && typeof body.code === "string" && PROCESSING_REFUSALS.has(body.code)) {
    response = await send(false)
    body = (await response.json().catch(() => ({}))) as HexBody
  }
  return { response, body }
}

/** Hex's processed text when it sent one, else the raw transcript. */
const finalText = (body: HexBody, raw: string) =>
  (typeof body.processed === "string" ? body.processed : raw).trim()

export async function transcribe(wav: ArrayBuffer): Promise<{ text: string; durationMs: number }> {
  const hex = await discover()
  const model = await dictationModel(hex)
  const { response, body } = await processed((process) => {
    const query = new URLSearchParams({ model: model.id, language: model.language })
    if (process) query.set("process", "global")
    return call(hex, `/transcriptions?${query}`, {
      method: "POST",
      headers: { "content-type": "audio/wav" },
      body: wav,
    })
  })
  if (!response.ok || typeof body.transcript !== "string") {
    const code = typeof body.code === "string" ? body.code : ""
    throw new HexError(
      REFUSALS[code] ?? `Hex couldn't transcribe that (${code || response.status}).`,
      response.status >= 400 && response.status < 500 ? 422 : 502,
    )
  }
  return {
    text: finalText(body, body.transcript),
    durationMs: typeof body.durationMs === "number" ? body.durationMs : 0,
  }
}

/** Hex refuses bigger audio requests on a stream. */
export const MAX_STREAM_CHUNK_BYTES = 256 * 1024

type Stream = { hex: Discovery; path: string; owner: string; touched: number }

/** Live streams by this app's own id; Hex's id and owner token stay here. */
const streams = new Map<string, Stream>()

// A browser that vanished leaves its entry behind; Hex ends the stream itself
// after 10 s without audio, so an hour-old entry is long dead.
setInterval(() => {
  for (const [id, stream] of streams) {
    if (Date.now() - stream.touched > 60 * 60 * 1000) streams.delete(id)
  }
}, 60_000).unref()

/**
 * Opens a stream of 16 kHz mono s16le audio. `id` is null when Hex is running
 * but can't stream now (another stream is live, or dictation holds no GGUF
 * model); the browser then sends the whole clip to `transcribe` instead.
 */
export async function openStream(): Promise<{ id: string | null; partials: boolean }> {
  const hex = await discover()
  const response = await call(hex, "/streams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sampleFormat: "s16le", sampleRate: 16_000 }),
  })
  const body = (await response.json().catch(() => ({}))) as {
    id?: unknown
    ownerToken?: unknown
    partials?: unknown
  }
  if (!response.ok || typeof body.id !== "number" || typeof body.ownerToken !== "string") {
    return { id: null, partials: false }
  }
  const id = crypto.randomUUID()
  streams.set(id, {
    hex,
    path: `/streams/${body.id}`,
    owner: body.ownerToken,
    touched: Date.now(),
  })
  return { id, partials: body.partials === true }
}

async function streamCall(id: string, action: string, init: RequestInit = {}) {
  const stream = streams.get(id)
  if (!stream) throw new HexError("That dictation has ended.", 404)
  stream.touched = Date.now()
  const headers = new Headers(init.headers)
  headers.set("x-hex-stream-token", stream.owner)
  return call(stream.hex, `${stream.path}/${action}`, { ...init, headers })
}

const streamError = (status: number, body: { code?: unknown }) =>
  new HexError(
    `Hex stopped the live dictation (${typeof body.code === "string" ? body.code : status}).`,
    409,
  )

const streamFailure = async (response: Response) =>
  streamError(response.status, (await response.json().catch(() => ({}))) as { code?: unknown })

export async function streamAudio(id: string, samples: ArrayBuffer) {
  const response = await streamCall(id, "audio", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: samples,
  })
  if (response.status !== 204) throw await streamFailure(response)
}

/** Hex's server-sent events for the stream, passed through as they come. */
export async function streamEvents(id: string, signal: AbortSignal): Promise<Response> {
  const response = await streamCall(id, "events", { signal })
  if (!response.ok || !response.body) throw await streamFailure(response)
  return new Response(response.body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
  })
}

export async function finishStream(id: string): Promise<{ text: string; durationMs: number }> {
  try {
    const { response, body } = await processed((process) =>
      streamCall(id, process ? "finish?process=global" : "finish", { method: "POST" }),
    )
    if (!response.ok || typeof body.text !== "string") throw streamError(response.status, body)
    return {
      text: finalText(body, body.text),
      durationMs: typeof body.durationMs === "number" ? body.durationMs : 0,
    }
  } finally {
    streams.delete(id)
  }
}

export async function cancelStream(id: string) {
  try {
    await streamCall(id, "cancel", { method: "POST" })
  } finally {
    streams.delete(id)
  }
}
