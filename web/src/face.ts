/**
 * Bot faces: a flat body shape with two eyes glancing to one side, drawn on a
 * 100 × 100 grid. A face is stored as an 8-hex-digit seed and redrawn from it,
 * so changing how a seed maps to parts re-rolls every saved face.
 */

export type FaceShape = "circle" | "squircle" | "hexagon" | "pentagon" | "blob"

export type FaceEye = { x: number; y: number; tilt: number }

export type Face = {
  body: { kind: "circle" } | { kind: "path"; d: string; round: boolean }
  eyes: FaceEye[]
}

const SHAPES: FaceShape[] = ["circle", "squircle", "hexagon", "pentagon", "blob"]

// Every eye is the same small upright rectangle with fully rounded corners.
export const EYE = { width: 11, height: 19 }

// Apple's iOS system colours (light appearance), minus the greys.
const PALETTE = [
  "#ff3b30", // red
  "#ff9500", // orange
  "#ffcc00", // yellow
  "#34c759", // green
  "#00c7be", // mint
  "#30b0c7", // teal
  "#32ade6", // cyan
  "#007aff", // blue
  "#5856d6", // indigo
  "#af52de", // purple
  "#ff2d55", // pink
  "#a2845e", // brown
]

export const FACE_PATTERN = /^[0-9a-f]{8}$/

export const randomFace = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")

/** A palette colour other than `current`, so each roll visibly changes. */
export const randomColor = (current?: string) => {
  const options = PALETTE.filter((color) => color !== current)
  return options[Math.floor(Math.random() * options.length)]!
}

/** mulberry32: a tiny deterministic PRNG, so a seed always draws the same face. */
const generator = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const fixed = (value: number) => Math.round(value * 100) / 100

// Corners are rounded by stroking the polygon in its own fill colour, so the
// points sit inside the 46-unit radius the other shapes use.
const polygon = (sides: number, radius: number, start: number) =>
  Array.from({ length: sides }, (_, index) => {
    const angle = start + (index * 2 * Math.PI) / sides
    return `${fixed(50 + radius * Math.cos(angle))} ${fixed(50 + radius * Math.sin(angle))}`
  })
    .map((point, index) => `${index ? "L" : "M"}${point}`)
    .join("") + "Z"

// A closed Catmull-Rom curve through points at slightly uneven radii.
const blob = (random: () => number) => {
  const count = 6
  const offset = random() * Math.PI
  const points = Array.from({ length: count }, (_, index) => {
    const angle = offset + (index * 2 * Math.PI) / count
    const radius = 42 + random() * 5
    return [50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle)] as const
  })
  const at = (index: number) => points[(index + count) % count]!
  let d = `M${fixed(points[0]![0])} ${fixed(points[0]![1])}`
  for (let index = 0; index < count; index++) {
    const [p0, p1, p2, p3] = [at(index - 1), at(index), at(index + 1), at(index + 2)]
    d += `C${fixed(p1[0] + (p2[0] - p0[0]) / 6)} ${fixed(p1[1] + (p2[1] - p0[1]) / 6)} ${fixed(p2[0] - (p3[0] - p1[0]) / 6)} ${fixed(p2[1] - (p3[1] - p1[1]) / 6)} ${fixed(p2[0])} ${fixed(p2[1])}`
  }
  return `${d}Z`
}

export function drawFace(seed: string): Face {
  const random = generator(Number.parseInt(FACE_PATTERN.test(seed) ? seed : "0", 16))
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!
  const shape = pick(SHAPES)
  const body: Face["body"] =
    shape === "circle"
      ? { kind: "circle" }
      : shape === "squircle"
        ? {
            kind: "path",
            d: "M38 6H62C82 6 94 18 94 38V62C94 82 82 94 62 94H38C18 94 6 82 6 62V38C6 18 18 6 38 6Z",
            round: false,
          }
        : shape === "hexagon"
          ? { kind: "path", d: polygon(6, 38, -Math.PI / 2), round: true }
          : shape === "pentagon"
            ? { kind: "path", d: polygon(5, 39, -Math.PI / 2), round: true }
            : { kind: "path", d: blob(random), round: false }

  // Gaze: mostly sideways, sometimes up, never down. Kept within ~36 units of
  // the centre so the eyes stay inside every shape.
  const side = random() < 0.5 ? -1 : 1
  const lift = (-15 + random() * 55) * (Math.PI / 180)
  const reach = 7 + random() * 7
  const centerX = 50 + side * reach * Math.cos(lift)
  const centerY = 48 - reach * Math.sin(lift)
  const gap = 10.5
  const tilt = side * 8
  const eyes = [-1, 1].map((direction) => ({
    x: fixed(centerX + direction * gap),
    y: fixed(centerY),
    tilt,
  }))
  return { body, eyes }
}
