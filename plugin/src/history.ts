import { OpenCode, type SessionMessageInfo } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { formatTime, parseWakeTime } from "./schedule"

/**
 * Conversation history for bots_history. OpenCode keeps every message of a
 * session, but the plugin's `session.context` returns only what follows the
 * latest compaction. The full log comes from the service's paged message list,
 * so nothing is copied or indexed outside OpenCode's own database.
 */

/**
 * One message as the bot sees it in history: who spoke, when, and the text.
 * `trigger` marks a message that starts a run: the user's, or a scheduled
 * job's or task's.
 */
export type HistoryEntry = {
  id: string
  sessionID: string
  time: number
  speaker: "user" | "bot" | "other-bot" | "automatic"
  trigger: boolean
  text: string
}

const PAGE = 200
const MAX_HITS = 8
const SNIPPET = 300
const WINDOW = 6
const MAX_READ_MESSAGE = 1_200
const MAX_OUTPUT = 8_000

let endpoint: { client: ReturnType<typeof OpenCode.make>; at: number } | undefined

const service = async () => {
  if (endpoint && Date.now() - endpoint.at < 30_000) return endpoint.client
  const found = await Service.discover({ version: (value) => value.startsWith("2.") })
  if (!found) throw new Error("the OpenCode service is not registered")
  const headers = Service.headers(found)
  const client = OpenCode.make({ baseUrl: found.url, ...(headers ? { headers } : {}) })
  endpoint = { client, at: Date.now() }
  return client
}

/**
 * Only what was said: the user's and the bot's text, other bots' messages
 * (sent with bots_send), and automatic messages. Tool calls are left out.
 */
export const toEntries = (sessionID: string, messages: readonly SessionMessageInfo[]) => {
  const entries: HistoryEntry[] = []
  for (const message of messages) {
    let speaker: HistoryEntry["speaker"]
    let trigger = false
    let text: string
    if (message.type === "user") {
      speaker = typeof message.metadata?.fromBot === "string" ? "other-bot" : "user"
      trigger = true
      text = message.text
    } else if (message.type === "synthetic") {
      speaker = "automatic"
      trigger =
        typeof message.metadata?.botsJob === "string" ||
        typeof message.metadata?.botsTask === "string"
      text = message.text
    } else if (message.type === "assistant") {
      speaker = "bot"
      text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
    } else {
      continue
    }
    text = text.trim()
    if (text) {
      entries.push({
        id: message.id,
        sessionID,
        time: message.time.created,
        speaker,
        trigger,
        text,
      })
    }
  }
  return entries
}

/** Every message of a session, oldest first, read page by page from the service. */
export const fetchHistory = async (sessionID: string) => {
  const client = await service()
  const messages: SessionMessageInfo[] = []
  let cursor: string | undefined
  try {
    do {
      const page = await client.message.list({
        sessionID: sessionID as Parameters<typeof client.message.list>[0]["sessionID"],
        limit: PAGE,
        // The service rejects a cursor combined with an order; the cursor keeps it.
        ...(cursor ? { cursor } : { order: "asc" as const }),
      })
      messages.push(...page.data)
      cursor = page.cursor.next ?? undefined
    } while (cursor)
  } catch (error) {
    // A restarted service has a new address: discover it again next time. A
    // deleted session is an answer from the service, not a reason to.
    const name = (error as { name?: unknown } | undefined)?.name
    if (name !== "SessionNotFoundError") endpoint = undefined
    throw error
  }
  return toEntries(sessionID, messages)
}

const DURATION = /^(?:\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?)$/i
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A bound for after/before: a duration ago ("7d", "2w"), a local date or time,
 * or an ISO timestamp. A bare date covers the whole day, so as an upper bound
 * it means the end of that day.
 */
export const parseBound = (text: string, edge: "after" | "before", now: number, zone: string) => {
  const value = text.trim().replace(/\s+ago$/i, "")
  try {
    if (DURATION.test(value)) return now - (parseWakeTime(value, now, zone) - now)
    if (BARE_DATE.test(value)) {
      const start = parseWakeTime(`${value} 00:00`, now, zone)
      return edge === "after" ? start : parseWakeTime(`${value} 23:59:59`, now, zone) + 999
    }
    return parseWakeTime(value, now, zone)
  } catch {
    throw new Error(
      `"${text}" is not a valid ${edge} value. Use a duration ago such as "7d" or "2w" (for "last week", use "1w"), a local date or time such as "2026-11-01" or "2026-11-01 14:00", or an ISO timestamp.`,
    )
  }
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()

/** Quoted phrases stay whole; other words of two or more characters are terms. */
export const parseQuery = (query: string) => {
  const terms: string[] = []
  const folded = fold(query)
  const rest = folded.replace(/"([^"]+)"/g, (_, phrase: string) => {
    const clean = phrase.trim().replace(/\s+/g, " ")
    if (clean) terms.push(clean)
    return " "
  })
  for (const word of rest.split(/[^\p{L}\p{N}_@.#/-]+/u)) {
    const clean = word.replace(/^[.\-/]+|[.\-/]+$/g, "")
    if (clean.length >= 2 && !terms.includes(clean)) terms.push(clean)
  }
  return terms
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

/** About SNIPPET characters of the message, centred on the first matching term. */
const snippet = (text: string, terms: readonly string[]) => {
  const flat = oneLine(text)
  if (flat.length <= SNIPPET) return flat
  // Folding can change the length (decomposed accents, some scripts), and then
  // its positions no longer line up with the text: fall back to plain lowercase.
  const folded = fold(flat)
  const haystack = folded.length === flat.length ? folded : flat.toLowerCase()
  const positions = terms.map((term) => haystack.indexOf(term)).filter((index) => index >= 0)
  const hit = positions.length ? Math.min(...positions) : 0
  const start = Math.max(0, Math.min(hit - Math.floor(SNIPPET / 3), flat.length - SNIPPET))
  const end = start + SNIPPET
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`
}

export type Speakers = { bot: string }

const SPEAKER_LABEL = {
  user: "User",
  "other-bot": "Another bot",
  automatic: "Automatic message",
} as const

const speakerLabel = (entry: HistoryEntry, speakers: Speakers) =>
  entry.speaker === "bot" ? speakers.bot : SPEAKER_LABEL[entry.speaker]

/**
 * Ranks messages by how many terms they contain, then by recency. With several
 * terms, messages that match only some of them still count, below full matches.
 */
export const searchHistory = (
  entries: readonly HistoryEntry[],
  input: { query: string; after?: number; before?: number },
  speakers: Speakers,
  zone: string,
) => {
  const terms = parseQuery(input.query)
  if (!terms.length) return "Error: query needs at least one word of two or more characters."
  if (input.after !== undefined && input.before !== undefined && input.after > input.before) {
    return "Error: after is later than before, so no message can match."
  }
  const scored: Array<{ entry: HistoryEntry; score: number }> = []
  for (const entry of entries) {
    if (input.after !== undefined && entry.time < input.after) continue
    if (input.before !== undefined && entry.time > input.before) continue
    const folded = fold(oneLine(entry.text))
    const score = terms.filter((term) => folded.includes(term)).length
    if (score > 0) scored.push({ entry, score })
  }
  if (!scored.length) {
    return `No earlier messages match ${terms.map((term) => `"${term}"`).join(", ")}. Try other words, synonyms, or a wider date range; do not guess what was said.`
  }
  scored.sort((a, b) => b.score - a.score || b.entry.time - a.entry.time)
  const lines = scored
    .slice(0, MAX_HITS)
    .map(
      ({ entry }) =>
        `- [${entry.id}] ${formatTime(entry.time, zone)} · ${speakerLabel(entry, speakers)}: ${snippet(entry.text, terms)}`,
    )
  return [
    `${scored.length} matching message${scored.length === 1 ? "" : "s"}${scored.length > MAX_HITS ? `, best ${MAX_HITS} shown` : ""} (most terms first, then newest):`,
    ...lines,
    "",
    'Use action "read" with a message id to see the conversation around it.',
  ].join("\n")
}

/** The messages around one message, each shortened, within an overall cap. */
export const readHistory = (
  entries: readonly HistoryEntry[],
  messageID: string,
  speakers: Speakers,
  zone: string,
) => {
  const index = entries.findIndex((entry) => entry.id === messageID)
  if (index < 0) return `Error: no message with id "${messageID}" in this history.`
  const from = Math.max(0, index - WINDOW)
  const to = Math.min(entries.length, index + WINDOW + 1)
  const blocks = entries.slice(from, to).map((entry) => {
    const text =
      entry.text.length > MAX_READ_MESSAGE
        ? `${entry.text.slice(0, MAX_READ_MESSAGE)}…`
        : entry.text
    const mark = entry.id === messageID ? " (match)" : ""
    return `[${entry.id}] ${formatTime(entry.time, zone)} · ${speakerLabel(entry, speakers)}${mark}:\n${text}`
  })
  // Trim from both ends until the window fits, keeping the matched message.
  let start = 0
  let end = blocks.length
  const target = index - from
  const size = () => blocks.slice(start, end).join("\n\n").length
  while (size() > MAX_OUTPUT && end - start > 1) {
    if (target - start > end - 1 - target) start += 1
    else end -= 1
  }
  const earlier = from + start > 0
  const later = from + end < entries.length
  return [
    ...(earlier ? ["(earlier messages exist: read the first id shown to scroll back)", ""] : []),
    blocks.slice(start, end).join("\n\n"),
    ...(later ? ["", "(later messages exist: read the last id shown to scroll forward)"] : []),
  ].join("\n")
}
