/**
 * Cron and wake-time helpers shared by the plugin (scheduling) and the web app
 * (previews). Cron expressions are evaluated on the wall clock of a time zone.
 */

const MINUTE = 60_000
const HORIZON_MS = 5 * 366 * 24 * 60 * MINUTE

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

const MACROS: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
}

const FIELDS = [
  { label: "minute", min: 0, max: 59 },
  { label: "hour", min: 0, max: 23 },
  { label: "day of month", min: 1, max: 31 },
  { label: "month", min: 1, max: 12, names: MONTHS, offset: 1 },
  { label: "day of week", min: 0, max: 7, names: WEEKDAYS, offset: 0 },
] as const

export type Cron = {
  readonly source: string
  readonly fields: readonly string[]
  readonly minute: ReadonlySet<number>
  readonly hour: ReadonlySet<number>
  readonly day: ReadonlySet<number>
  readonly month: ReadonlySet<number>
  readonly weekday: ReadonlySet<number>
  readonly anyDay: boolean
  readonly anyWeekday: boolean
}

const fieldValues = (text: string, index: number) => {
  const field = FIELDS[index]!
  const value = (token: string) => {
    let number = /^\d+$/.test(token) ? Number(token) : NaN
    if ("names" in field) {
      const index = field.names.indexOf(token.toLowerCase())
      if (index >= 0) number = index + field.offset
    }
    if (!Number.isInteger(number) || number < field.min || number > field.max) {
      throw new Error(`"${token}" is not a valid ${field.label}.`)
    }
    return number
  }
  const values = new Set<number>()
  for (const part of text.split(",")) {
    const [range = "", step, extra] = part.split("/")
    if (extra !== undefined || !range) throw new Error(`"${part}" is not a valid ${field.label}.`)
    const every = step === undefined ? 1 : /^\d+$/.test(step) ? Number(step) : 0
    if (every < 1) throw new Error(`"${part}" has an invalid step.`)
    let low: number
    let high: number
    if (range === "*") {
      low = field.min
      // Day of week 7 is an alias for Sunday; `*` covers 0–6 only.
      high = index === 4 ? 6 : field.max
    } else if (range.includes("-")) {
      const [from = "", to = ""] = range.split("-")
      low = value(from)
      high = value(to)
      if (low > high) throw new Error(`"${range}" is an empty ${field.label} range.`)
    } else {
      low = value(range)
      high = step === undefined ? low : field.max
    }
    for (let item = low; item <= high; item += every) values.add(index === 4 ? item % 7 : item)
  }
  return values
}

/** Parses a five-field cron expression or a macro such as `@daily`. Throws a readable error. */
export const parseCron = (expression: string): Cron => {
  const trimmed = expression.trim().replace(/\s+/g, " ")
  const source = MACROS[trimmed.toLowerCase()] ?? trimmed
  const fields = source.split(" ")
  if (fields.length !== 5) {
    throw new Error(
      'A cron expression has five fields: minute hour day-of-month month day-of-week (for example "0 9 * * 1-5").',
    )
  }
  return {
    source: trimmed,
    fields,
    minute: fieldValues(fields[0]!, 0),
    hour: fieldValues(fields[1]!, 1),
    day: fieldValues(fields[2]!, 2),
    month: fieldValues(fields[3]!, 3),
    weekday: fieldValues(fields[4]!, 4),
    // As in Vixie cron, a restricted day-of-month and day-of-week match either.
    anyDay: fields[2]!.startsWith("*"),
    anyWeekday: fields[4]!.startsWith("*"),
  }
}

export const validTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

const formatters = new Map<string, Intl.DateTimeFormat>()

/** The wall-clock time in `zone` at instant `time`, encoded as a UTC timestamp (seconds precision). */
const wallClock = (time: number, zone: string) => {
  let format = formatters.get(zone)
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    formatters.set(zone, format)
  }
  const parts: Record<string, number> = {}
  for (const part of format.formatToParts(time)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value)
  }
  return Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour! % 24,
    parts.minute!,
    parts.second!,
  )
}

/**
 * The instant at which `zone` shows the wall-clock time `wall`, or null when
 * that time does not exist there (a daylight-saving gap).
 */
const fromWallClock = (wall: number, zone: string) => {
  const offset = (time: number) => wallClock(time, zone) - (time - (time % 1000))
  let guess = wall - offset(wall)
  guess = wall - offset(guess)
  return wallClock(guess, zone) === wall ? guess : null
}

const dayMatches = (cron: Cron, date: Date) => {
  const day = cron.day.has(date.getUTCDate())
  const weekday = cron.weekday.has(date.getUTCDay())
  if (cron.anyDay && cron.anyWeekday) return true
  if (cron.anyDay) return weekday
  if (cron.anyWeekday) return day
  return day || weekday
}

/** The first run strictly after `after`, or null when the expression never matches. */
export const nextRun = (cron: Cron, after: number, zone: string): number | null => {
  let wall = wallClock(after, zone)
  wall = wall - (wall % MINUTE) + MINUTE
  const limit = wall + HORIZON_MS
  while (wall < limit) {
    const date = new Date(wall)
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    const day = date.getUTCDate()
    const hour = date.getUTCHours()
    if (!cron.month.has(month + 1)) {
      wall = Date.UTC(year, month + 1, 1)
      continue
    }
    if (!dayMatches(cron, date)) {
      wall = Date.UTC(year, month, day + 1)
      continue
    }
    if (!cron.hour.has(hour)) {
      wall = Date.UTC(year, month, day, hour + 1)
      continue
    }
    if (!cron.minute.has(date.getUTCMinutes())) {
      wall += MINUTE
      continue
    }
    const instant = fromWallClock(wall, zone)
    if (instant !== null && instant > after) return instant
    wall += MINUTE
  }
  return null
}

/** The shortest gap between consecutive runs over the next `count` runs. */
export const shortestGap = (cron: Cron, from: number, zone: string, count = 24) => {
  let previous = nextRun(cron, from, zone)
  let shortest = Infinity
  for (let index = 0; previous !== null && index < count; index += 1) {
    const next = nextRun(cron, previous, zone)
    if (next === null) break
    shortest = Math.min(shortest, next - previous)
    previous = next
  }
  return shortest
}

const pad = (value: number) => String(value).padStart(2, "0")

const single = (field: string) => (/^\d+$/.test(field) ? Number(field) : null)

/** A short English description of common cron expressions; others are shown as-is. */
export const describeCron = (expression: string) => {
  let cron: Cron
  try {
    cron = parseCron(expression)
  } catch {
    return expression.trim() || "No schedule"
  }
  const [minute = "", hour = "", day = "", month = "", weekday = ""] = cron.fields
  const m = single(minute)
  const h = single(hour)
  const time = m !== null && h !== null ? `${pad(h)}:${pad(m)}` : null
  const everyDay = day === "*" && month === "*"

  if (minute === "*" && hour === "*" && everyDay && weekday === "*") return "Every minute"
  const minuteStep = /^\*\/(\d+)$/.exec(minute)
  if (minuteStep && hour === "*" && everyDay && weekday === "*") {
    return `Every ${minuteStep[1]} minutes`
  }
  if (m !== null && hour === "*" && everyDay && weekday === "*") {
    return m === 0 ? "Every hour" : `Every hour at :${pad(m)}`
  }
  const hourStep = /^\*\/(\d+)$/.exec(hour)
  if (m !== null && hourStep && everyDay && weekday === "*") {
    return `Every ${hourStep[1]} hours${m ? ` at :${pad(m)}` : ""}`
  }
  if (time && everyDay) {
    if (weekday === "*") return `Every day at ${time}`
    const days = [...cron.weekday].sort()
    const key = days.join(",")
    if (key === "1,2,3,4,5") return `Weekdays at ${time}`
    if (key === "0,6") return `Weekends at ${time}`
    if (days.length <= 3) {
      return `Every ${days.map((item) => WEEKDAY_NAMES[item]).join(", ")} at ${time}`
    }
  }
  const dayNumber = single(day)
  if (time && dayNumber !== null && month === "*" && weekday === "*") {
    return `Monthly on day ${dayNumber} at ${time}`
  }
  return `Cron ${cron.source}`
}

const UNITS: Record<string, number> = {
  m: MINUTE,
  h: 60 * MINUTE,
  d: 24 * 60 * MINUTE,
  w: 7 * 24 * 60 * MINUTE,
}

/**
 * Parses a wake time: a duration from now ("45m", "2h", "in 3 days", "1w"), a
 * local date and time in `zone` ("2026-11-09 09:00"; a bare date means 09:00),
 * or an ISO 8601 timestamp with an offset. Throws a readable error.
 */
export const parseWakeTime = (text: string, now: number, zone: string) => {
  const value = text.trim()
  const relative =
    /^(?:in\s+)?(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?)$/i.exec(
      value,
    )
  if (relative) {
    const unit = UNITS[relative[2]!.toLowerCase()[0]!]!
    return now + Math.round(Number(relative[1]) * unit)
  }
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value)
  let time: number
  if (local) {
    const [, year, month, day, hour = "09", minute = "00", second = "00"] = local
    const wall = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    )
    // A time inside a daylight-saving gap moves forward by an hour.
    time = fromWallClock(wall, zone) ?? fromWallClock(wall + 60 * MINUTE, zone) ?? NaN
  } else if (/(?:z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    time = Date.parse(value)
  } else {
    time = NaN
  }
  if (!Number.isFinite(time)) {
    throw new Error(
      `"${value}" is not a wake time. Use a duration such as "45m", "2h", or "3d", a local time such as "2026-11-09 09:00", or an ISO timestamp with an offset.`,
    )
  }
  return time
}

/** "Mon, 9 Nov 2026 at 09:00" in `zone`. */
export const formatTime = (time: number, zone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(time)

/** "Sunday, 8 November 2026" in `zone`. */
export const formatDay = (time: number, zone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(time)
