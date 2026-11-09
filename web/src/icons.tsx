import type { ReactNode } from "react"

type IconName =
  | "plus"
  | "plus-sm"
  | "settings"
  | "send"
  | "trash"
  | "edit"
  | "back"
  | "search"
  | "close"
  | "bot"
  | "group"
  | "check"
  | "command"
  | "mic"
  | "stop"

/**
 * The Bots for OpenCode mark: a speech bubble robot with two eyes and two feet, on a 5 × 5 grid of
 * OpenCode-logo strokes. Keep `size` a multiple of 5 so every edge lands on a pixel.
 */
export function Mark({ size = 25 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 5 5" width={size} height={size}>
        <path className="brand-mark-shade" d="M1 2H4V3H1Z" />
        <path fillRule="evenodd" d="M0 0H5V5H4V4H1V5H0ZM1 1H2V2H3V1H4V3H1Z" />
      </svg>
    </span>
  )
}

/**
 * Glyphs copied verbatim from the OpenCode desktop icon set — the `icons` map
 * inside `@opencode-ai/ui@1.19.5` `src/components/icon.tsx`, as bundled in
 * OpenCode Desktop 2.2.5 (`app.asar`). Not a package import: that library is
 * SolidJS-only and its icon data is not exported.
 * Most glyphs use a 20px grid; `magnifying-glass` and `subagent` use 16px.
 */
const ICONS: Record<IconName, { viewBox: string; body: ReactNode }> = {
  plus: {
    viewBox: "0 0 20 20",
    body: (
      <path
        d="M9.9987 2.20703V9.9987M9.9987 9.9987V17.7904M9.9987 9.9987H2.20703M9.9987 9.9987H17.7904"
        stroke="currentColor"
        strokeLinecap="square"
      />
    ),
  },
  "plus-sm": {
    viewBox: "0 0 16 16",
    body: (
      <>
        <path d="M8 2.88867V13.1109" stroke="currentColor" strokeLinejoin="round" />
        <path d="M2.88867 8H13.1109" stroke="currentColor" strokeLinejoin="round" />
      </>
    ),
  },
  settings: {
    viewBox: "0 0 20 20",
    body: (
      <>
        <path
          d="M7.62516 4.46094L5.05225 3.86719L3.86475 5.05469L4.4585 7.6276L2.0835 9.21094V10.7943L4.4585 12.3776L3.86475 14.9505L5.05225 16.138L7.62516 15.5443L9.2085 17.9193H10.7918L12.3752 15.5443L14.9481 16.138L16.1356 14.9505L15.5418 12.3776L17.9168 10.7943V9.21094L15.5418 7.6276L16.1356 5.05469L14.9481 3.86719L12.3752 4.46094L10.7918 2.08594H9.2085L7.62516 4.46094Z"
          stroke="currentColor"
        />
        <path
          d="M12.5002 10.0026C12.5002 11.3833 11.3809 12.5026 10.0002 12.5026C8.61945 12.5026 7.50016 11.3833 7.50016 10.0026C7.50016 8.62189 8.61945 7.5026 10.0002 7.5026C11.3809 7.5026 12.5002 8.62189 12.5002 10.0026Z"
          stroke="currentColor"
        />
      </>
    ),
  },
  send: {
    viewBox: "0 0 20 20",
    body: (
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.99991 2.24121L16.0921 8.33343L15.2083 9.21731L10.6249 4.63397V17.5001H9.37492V4.63398L4.7916 9.21731L3.90771 8.33343L9.99991 2.24121Z"
        fill="currentColor"
      />
    ),
  },
  trash: {
    viewBox: "0 0 20 20",
    body: (
      <path
        d="M4.58342 17.9134L4.58369 17.4134L4.22787 17.5384L4.22766 18.0384H4.58342V17.9134ZM15.4167 17.9134V18.0384H15.7725L15.7723 17.5384L15.4167 17.9134ZM2.08342 3.95508V3.45508H1.58342V3.95508H2.08342V4.45508V3.95508ZM17.9167 4.45508V4.95508H18.4167V4.45508H17.9167V3.95508V4.45508ZM4.16677 4.58008L3.66701 4.5996L4.22816 17.5379L4.72792 17.4934L5.22767 17.4489L4.66652 4.54055L4.16677 4.58008ZM4.58342 18.0384V17.9134H15.4167V18.0384V18.5384H4.58342V18.0384ZM15.4167 17.9134L15.8332 17.5379L16.2498 4.5996L15.7501 4.58008L15.2503 4.56055L14.8337 17.4989L15.4167 17.9134ZM15.8334 4.58008V4.08008H4.16677V4.58008V5.08008H15.8334V4.58008ZM2.08342 4.45508V4.95508H4.16677V4.58008V4.08008H2.08342V4.45508ZM15.8334 4.58008V5.08008H17.9167V4.45508V3.95508H15.8334V4.58008ZM6.83951 4.35149L7.432 4.55047C7.79251 3.47701 8.80699 2.70508 10.0001 2.70508V2.20508V1.70508C8.25392 1.70508 6.77335 2.83539 6.24702 4.15251L6.83951 4.35149ZM10.0001 2.20508V2.70508C11.1932 2.70508 12.2077 3.47701 12.5682 4.55047L13.1607 4.35149L13.7532 4.15251C13.2269 2.83539 11.7463 1.70508 10.0001 1.70508V2.20508Z"
        fill="currentColor"
      />
    ),
  },
  edit: {
    viewBox: "0 0 20 20",
    body: (
      <path
        d="M9.58301 17.9166H17.9163M17.9163 5.83325L14.1663 2.08325L2.08301 14.1666V17.9166H5.83301L17.9163 5.83325Z"
        stroke="currentColor"
        strokeLinecap="square"
      />
    ),
  },
  back: {
    viewBox: "0 0 20 20",
    body: (
      <path
        d="M8.33464 4.58398L2.91797 10.0007L8.33464 15.4173M3.33464 10.0007H17.0846"
        stroke="currentColor"
        strokeLinecap="square"
      />
    ),
  },
  search: {
    viewBox: "0 0 16 16",
    body: (
      <path
        d="M13 13L10.6418 10.6418M11.9552 7.47761C11.9552 9.95053 9.95053 11.9552 7.47761 11.9552C5.0047 11.9552 3 9.95053 3 7.47761C3 5.0047 5.0047 3 7.47761 3C9.95053 3 11.9552 5.0047 11.9552 7.47761Z"
        stroke="currentColor"
        strokeLinecap="square"
        vectorEffect="non-scaling-stroke"
      />
    ),
  },
  close: {
    viewBox: "0 0 20 20",
    body: (
      <path
        d="M3.75 3.75L16.25 16.25M16.25 3.75L3.75 16.25"
        stroke="currentColor"
        strokeLinecap="square"
      />
    ),
  },
  bot: {
    viewBox: "0 0 16 16",
    body: (
      <>
        <path
          d="M4.5 5C4.5 4.72386 4.72386 4.5 5 4.5H11C11.2761 4.5 11.5 4.72386 11.5 5V11C11.5 11.2761 11.2761 11.5 11 11.5H5C4.72386 11.5 4.5 11.2761 4.5 11V5Z"
          fill="currentColor"
        />
        <path
          d="M13.5 2C13.7761 2 14 2.22386 14 2.5V13.5C14 13.7761 13.7761 14 13.5 14H2.5C2.22386 14 2 13.7761 2 13.5V2.5C2 2.22386 2.22386 2 2.5 2H13.5ZM3 13H13V3H3V13Z"
          fill="currentColor"
        />
      </>
    ),
  },
  group: {
    viewBox: "0 0 20 20",
    body: (
      <path
        d="M18.3327 9.99935C18.3327 5.57227 15.0919 2.91602 9.99935 2.91602C4.90676 2.91602 1.66602 5.57227 1.66602 9.99935C1.66602 11.1487 2.45505 13.1006 2.57637 13.3939C2.58707 13.4197 2.59766 13.4434 2.60729 13.4697C2.69121 13.6987 3.04209 14.9354 1.66602 16.7674C3.51787 17.6528 5.48453 16.1973 5.48453 16.1973C6.84518 16.9193 8.46417 17.0827 9.99935 17.0827C15.0919 17.0827 18.3327 14.4264 18.3327 9.99935Z"
        stroke="currentColor"
        strokeLinecap="square"
      />
    ),
  },
  check: {
    viewBox: "0 0 20 20",
    body: (
      <path
        d="M5 11.9657L8.37838 14.7529L15 5.83398"
        stroke="currentColor"
        strokeLinecap="square"
      />
    ),
  },
  command: {
    viewBox: "0 0 20 20",
    body: (
      <path
        d="M14.5841 12.0807H17.9193V2.91406H5.6276V6.2474M14.5859 6.2474H2.08594V15.4141H5.0026V17.4974L8.7526 15.4141H14.5859V6.2474Z"
        stroke="currentColor"
        strokeLinecap="square"
      />
    ),
  },
  // Not in the OpenCode set: drawn here on its 20px grid with the same square strokes.
  mic: {
    viewBox: "0 0 20 20",
    body: (
      <path
        d="M7.08 2.5H12.92V10.42C12.92 12.03 11.61 13.33 10 13.33C8.39 13.33 7.08 12.03 7.08 10.42V2.5ZM4.17 9.58V10.42C4.17 13.64 6.78 16.25 10 16.25C13.22 16.25 15.83 13.64 15.83 10.42V9.58M10 16.25V18.33"
        stroke="currentColor"
        strokeLinecap="square"
      />
    ),
  },
  stop: {
    viewBox: "0 0 20 20",
    body: <rect x="4" y="4" width="12" height="12" rx="1.5" fill="currentColor" />,
  },
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const icon = ICONS[name]
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill="none"
      aria-hidden="true"
      style={{ flex: "none", display: "block" }}
    >
      {icon.body}
    </svg>
  )
}
