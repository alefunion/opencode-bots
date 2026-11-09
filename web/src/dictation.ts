/**
 * Microphone capture for dictation. An AudioWorklet taps the microphone, the
 * samples are cut down to 16 kHz mono 16-bit, and they go to Hex live through
 * `/api/dictation` as they are recorded, so the text is ready the moment the
 * recording stops. The samples are also kept: if Hex can't stream (another
 * stream is live) or the stream breaks, the whole clip is sent as a WAV to
 * `/api/transcribe` instead.
 */

export const MAX_RECORDING_MS = 10 * 60 * 1000
const SAMPLE_RATE = 16_000
/** About a quarter second per request; Hex wants 100 ms to 1 s. */
const CHUNK_SAMPLES = 4_000
/** Hex refuses audio requests over 256 KiB; a backlog is sent in pieces of this many samples. */
const MAX_REQUEST_SAMPLES = 64_000

export type DictationStatus = { available: boolean; installed: boolean; error?: string }

export const canRecord = () =>
  typeof window !== "undefined" &&
  window.isSecureContext &&
  typeof AudioWorkletNode !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia)

export async function dictationStatus(): Promise<DictationStatus> {
  const response = await fetch("/api/transcribe", { headers: { accept: "application/json" } })
  if (!response.ok) return { available: false, installed: false }
  return (await response.json()) as DictationStatus
}

const errorFrom = async (response: Response, fallback: string) => {
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  return new Error(body.error || `${fallback} (${response.status}).`)
}

async function transcribeClip(wav: Blob): Promise<string> {
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "content-type": "audio/wav" },
    body: wav,
  })
  if (!response.ok) throw await errorFrom(response, "Could not transcribe that")
  return ((await response.json()) as { text: string }).text
}

export type Dictation = {
  /** Ends the recording and resolves with the transcript. */
  stop: () => Promise<string>
  /** Ends the recording and drops the audio. */
  cancel: () => void
}

/** Posts each block of samples to the worklet's port, about every 43 ms at 48 kHz. */
const TAP = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.length = 0 }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      this.buffer.set(channel, this.length)
      this.length += channel.length
      if (this.length + 128 > this.buffer.length) {
        this.port.postMessage(this.buffer.slice(0, this.length))
        this.length = 0
      }
    }
    return true
  }
}
registerProcessor("hex-tap", Tap)
`

/** Box-filtered decimation to 16 kHz, carried across blocks. */
function downsampler(from: number) {
  const ratio = from / SAMPLE_RATE
  let carry = new Float32Array(0)
  let position = 0
  return (input: Float32Array) => {
    const data = new Float32Array(carry.length + input.length)
    data.set(carry)
    data.set(input, carry.length)
    const out = new Int16Array(Math.max(0, Math.floor((data.length - position) / ratio)))
    let count = 0
    while (position + ratio <= data.length && count < out.length) {
      const start = Math.floor(position)
      const end = Math.max(start + 1, Math.floor(position + ratio))
      let sum = 0
      for (let index = start; index < end; index++) sum += data[index]!
      const sample = Math.max(-1, Math.min(1, sum / (end - start)))
      out[count++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      position += ratio
    }
    const keep = Math.floor(position)
    carry = data.slice(keep)
    position -= keep
    return out.subarray(0, count)
  }
}

const join = (parts: Int16Array[]) => {
  const all = new Int16Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    all.set(part, offset)
    offset += part.length
  }
  return all
}

/**
 * Opens the microphone and starts dictating. `onLevel` gets a 0–1 loudness for
 * a meter; `onText` gets the transcript so far while Hex streams it.
 */
export async function dictate(handlers: {
  onLevel: (level: number) => void
  onText: (text: string) => void
}): Promise<Dictation> {
  // Asked for at the same time; Hex not running stops dictation before it starts.
  const opening = fetch("/api/dictation", { method: "POST" }).then(async (response) => {
    if (!response.ok) throw await errorFrom(response, "Could not start dictation")
    return ((await response.json()) as { id: string | null }).id
  })
  const microphone = navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  let stream: MediaStream
  let streamId: string | null
  try {
    ;[stream, streamId] = await Promise.all([microphone, opening])
  } catch (cause) {
    void microphone.then(
      (media) => media.getTracks().forEach((track) => track.stop()),
      () => {},
    )
    void opening.then(
      (id) => id && void post(`/api/dictation/${id}/cancel`),
      () => {},
    )
    throw cause
  }

  const context = new AudioContext()
  // Created after an await, so Safari may start it suspended.
  void context.resume().catch(() => undefined)
  const module = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }))
  try {
    await context.audioWorklet.addModule(module)
  } finally {
    URL.revokeObjectURL(module)
  }
  const tap = new AudioWorkletNode(context, "hex-tap")
  context.createMediaStreamSource(stream).connect(tap)

  const recorded: Int16Array[] = []
  let unsent: Int16Array[] = []
  let unsentLength = 0
  let sending: Promise<void> = Promise.resolve()
  let live = streamId !== null
  let ended = false

  const segments = new Map<number, string>()
  const partial = { segment: -1, text: "" }
  const showText = () => {
    const done = [...segments.entries()].sort(([a], [b]) => a - b).map(([, text]) => text)
    if (partial.segment >= 0 && !segments.has(partial.segment)) done.push(partial.text)
    handlers.onText(done.filter(Boolean).join(" ").trim())
  }
  const events = streamId ? new EventSource(`/api/dictation/${streamId}/events`) : null
  if (events) {
    events.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as {
        type: string
        segment?: number
        text?: string
        stable?: string
        tentative?: string
      }
      if (event.type === "segment" && typeof event.segment === "number") {
        segments.set(event.segment, event.text ?? "")
        showText()
      } else if (event.type === "partial" && typeof event.segment === "number") {
        partial.segment = event.segment
        partial.text = `${event.stable ?? ""}${event.tentative ?? ""}`
        showText()
      } else if (event.type === "final" || event.type === "cancelled") {
        events.close()
      } else if (event.type === "error") {
        // The stream ended on Hex's side (lease, model change); the clip still works.
        live = false
        events.close()
      }
    }
    // EventSource reconnects by itself; once the stream is over that only replays it.
    events.onerror = () => {
      if (ended) events.close()
    }
  }

  const flush = () => {
    if (!live || !streamId || unsentLength === 0) return
    const samples = join(unsent)
    unsent = []
    unsentLength = 0
    const id = streamId
    sending = sending.then(async () => {
      for (let offset = 0; live && offset < samples.length; offset += MAX_REQUEST_SAMPLES) {
        const piece = samples.slice(offset, offset + MAX_REQUEST_SAMPLES)
        const response = await fetch(`/api/dictation/${id}/audio`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: piece.buffer,
        }).catch(() => null)
        if (!response?.ok) live = false
      }
    })
  }

  const downsample = downsampler(context.sampleRate)
  tap.port.onmessage = (message: MessageEvent<Float32Array>) => {
    if (ended) return
    const block = message.data
    let sum = 0
    for (const sample of block) sum += sample * sample
    // Speech RMS sits around 0.02–0.2; a square root spreads it over the range.
    handlers.onLevel(Math.min(1, Math.sqrt(Math.sqrt(sum / block.length)) * 1.6))
    const samples = downsample(block)
    recorded.push(samples)
    unsent.push(samples)
    unsentLength += samples.length
    if (unsentLength >= CHUNK_SAMPLES) flush()
  }

  const release = () => {
    ended = true
    tap.port.onmessage = null
    for (const track of stream.getTracks()) track.stop()
    void context.close().catch(() => undefined)
  }

  return {
    stop: async () => {
      release()
      flush()
      await sending
      if (live && streamId) {
        const response = await post(`/api/dictation/${streamId}/finish`).catch(() => null)
        events?.close()
        if (response?.ok) return ((await response.json()) as { text: string }).text
      } else if (streamId) {
        events?.close()
        void post(`/api/dictation/${streamId}/cancel`).catch(() => undefined)
      }
      return transcribeClip(encodeWav(join(recorded)))
    },
    cancel: () => {
      release()
      events?.close()
      if (streamId) void post(`/api/dictation/${streamId}/cancel`).catch(() => undefined)
    },
  }
}

const post = (url: string) => fetch(url, { method: "POST" })

function encodeWav(samples: Int16Array): Blob {
  const header = new DataView(new ArrayBuffer(44))
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      header.setUint8(offset + index, value.charCodeAt(index))
    }
  }
  text(0, "RIFF")
  header.setUint32(4, 36 + samples.byteLength, true)
  text(8, "WAVE")
  text(12, "fmt ")
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true) // PCM
  header.setUint16(22, 1, true) // mono
  header.setUint32(24, SAMPLE_RATE, true)
  header.setUint32(28, SAMPLE_RATE * 2, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  text(36, "data")
  header.setUint32(40, samples.byteLength, true)
  return new Blob([header.buffer, samples.buffer as ArrayBuffer], { type: "audio/wav" })
}
