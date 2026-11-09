import { useMemo } from "react"
import { drawFace, EYE } from "../face"

/** Group swatches and default bot colours; the plugin assigns from the same palette. */
export const COLORS = [
  "#ee7330",
  "#e7af36",
  "#0096b8",
  "#2eaf5a",
  "#d92e3c",
  "#e4429e",
  "#3250df",
  "#623be2",
  "#5c5c5c",
]

export function Avatar({
  name,
  color,
  face,
  size = 40,
}: {
  name: string
  color: string
  /** A bot's face seed; groups have none and show initials. */
  face?: string
  size?: number
}) {
  if (face) return <FaceAvatar seed={face} color={color} size={size} />

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        minWidth: size,
        backgroundColor: color,
        color: readableText(color),
        fontSize: Math.max(9, Math.round(size * 0.4)),
      }}
      aria-hidden="true"
    >
      {initials || "?"}
    </span>
  )
}

function FaceAvatar({ seed, color, size }: { seed: string; color: string; size: number }) {
  const { body, eyes } = useMemo(() => drawFace(seed), [seed])
  return (
    <svg
      className="avatar-face"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      style={{ minWidth: size }}
      aria-hidden="true"
    >
      {body.kind === "circle" ? (
        <circle cx="50" cy="50" r="46" fill={color} />
      ) : (
        <path
          d={body.d}
          fill={color}
          stroke={body.round ? color : undefined}
          strokeWidth={body.round ? 16 : undefined}
          strokeLinejoin="round"
        />
      )}
      {eyes.map((eye, index) => (
        <rect
          key={index}
          x={eye.x - EYE.width / 2}
          y={eye.y - EYE.height / 2}
          width={EYE.width}
          height={EYE.height}
          rx={EYE.width / 2}
          transform={`rotate(${eye.tilt} ${eye.x} ${eye.y})`}
          fill="#ffffff"
        />
      ))}
    </svg>
  )
}

function readableText(color: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  if (!match) return "#fff"
  const value = match[1]!
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? "#131010" : "#ffffff"
}
