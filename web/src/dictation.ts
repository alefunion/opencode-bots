/**
 * Microphone capture for dictation. The browser records in whatever codec it
 * has (WebM/Opus, or MP4/AAC on Safari), then the clip is decoded, mixed down
 * to 16 kHz mono, and encoded as 16-bit PCM WAV, the format Hex transcribes.
 */

export const MAX_RECORDING_MS = 10 * 60 * 1000
const SAMPLE_RATE = 16_000

export type DictationStatus = { available: boolean; installed: boolean; error?: string }

export const canRecord = () =>
  typeof window !== "undefined" &&
  window.isSecureContext &&
  typeof MediaRecorder !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia)

export async function dictationStatus(): Promise<DictationStatus> {
  const response = await fetch("/api/transcribe", { headers: { accept: "application/json" } })
  if (!response.ok) return { available: false, installed: false }
  return (await response.json()) as DictationStatus
}

export async function transcribe(wav: Blob): Promise<string> {
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "content-type": "audio/wav" },
    body: wav,
  })
  const body = (await response.json().catch(() => ({}))) as { text?: string; error?: string }
  if (!response.ok || typeof body.text !== "string") {
    throw new Error(body.error || `Could not transcribe that (${response.status}).`)
  }
  return body.text
}

export type Recording = {
  /** Ends the recording and resolves with the WAV clip. */
  stop: () => Promise<Blob>
  /** Ends the recording and drops the audio. */
  cancel: () => void
}

/**
 * Opens the microphone and starts recording. `onLevel` gets a 0–1 loudness
 * about every frame, for a meter.
 */
export async function record(onLevel: (level: number) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  const meter = new AudioContext()
  // Created after an await, so Safari may start it suspended; the meter only.
  void meter.resume().catch(() => undefined)
  const analyser = meter.createAnalyser()
  analyser.fftSize = 512
  meter.createMediaStreamSource(stream).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  let frame = 0
  const tick = () => {
    analyser.getFloatTimeDomainData(samples)
    let sum = 0
    for (const sample of samples) sum += sample * sample
    // Speech RMS sits around 0.02–0.2; a square root spreads it over the range.
    onLevel(Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.6))
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)

  const release = () => {
    cancelAnimationFrame(frame)
    for (const track of stream.getTracks()) track.stop()
    void meter.close().catch(() => undefined)
  }

  recorder.start(1000)

  return {
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          release()
          const clip = new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
          toWav(clip).then(resolve, reject)
        }
        recorder.onerror = () => {
          release()
          reject(new Error("The microphone stopped unexpectedly."))
        }
        if (recorder.state === "inactive") recorder.onstop(new Event("stop"))
        else recorder.stop()
      }),
    cancel: () => {
      recorder.onstop = null
      if (recorder.state !== "inactive") recorder.stop()
      release()
    },
  }
}

async function toWav(clip: Blob): Promise<Blob> {
  const decoder = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await decoder.decodeAudioData(await clip.arrayBuffer())
  } catch {
    throw new Error("The recording couldn't be decoded in this browser.")
  } finally {
    void decoder.close().catch(() => undefined)
  }
  // An offline mono context at 16 kHz downmixes and resamples in one pass.
  const length = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE))
  const offline = new OfflineAudioContext(1, length, SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const mono = (await offline.startRendering()).getChannelData(0)
  return encodeWav(mono, SAMPLE_RATE)
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }
  text(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, "WAVE")
  text(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]!))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return new Blob([buffer], { type: "audio/wav" })
}
