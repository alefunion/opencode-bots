import { Plugin, Skill } from "@opencode/plugin"
import {
  mkdir,
  chmod,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto"
import { WEB_PORT } from "./port"
import { acquireWebHost } from "./webhost"
import {
  BotsRpc,
  type BotInput,
  type BotPatch,
  type BotsState,
  type BotView,
  type CommandInput,
  type CommandView,
  type GroupInput,
  type GroupPatch,
  type GroupView,
  type JobInput,
  type JobView,
  type LibraryScope,
  type ModelRef,
  type SkillFileContent,
  type SkillFileView,
  type SkillInput,
  type SkillStatus,
  type SkillView,
  type TaskInput,
  type TaskStatus,
  type TaskView,
  type WorkerView,
} from "./rpc"
import {
  describeCron,
  formatDay,
  formatTime,
  localTimeZone,
  nextRun,
  parseCron,
  parseWakeTime,
  shortestGap,
  validTimeZone,
} from "./schedule"

const DATA_HOME = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
// Installs from before the rename keep their folder: bot sessions are tied to it.
const LEGACY_WORKSPACE = join(homedir(), "OpenCode Bots")
const DEFAULT_WORKSPACE =
  existsSync(LEGACY_WORKSPACE) && !existsSync(join(homedir(), "Bots for OpenCode"))
    ? LEGACY_WORKSPACE
    : join(homedir(), "Bots for OpenCode")
const DEFAULT_DATA = join(DATA_HOME, "opencode", "bots")
// The package root: plugin/src/index.ts → ../..
const APP_DIR = fileURLToPath(new URL("../..", import.meta.url))

// The same swatches the web app's settings offer.
const DEFAULT_COLORS = [
  "#ee7330",
  "#e7af36",
  "#0096b8",
  "#2eaf5a",
  "#d92e3c",
  "#e4429e",
  "#3250df",
  "#623be2",
  "#5c5c5c",
] as const
// New bots get a random colour from the same iOS palette as the web app's
// "Random face" button (web/src/face.ts).
const FACE_COLORS = [
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#00c7be",
  "#30b0c7",
  "#32ade6",
  "#007aff",
  "#5856d6",
  "#af52de",
  "#ff2d55",
  "#a2845e",
] as const
const MAX_NAME = 64
const MAX_HANDLE = 32
const MAX_ROLE = 20_000
const MAX_GROUP_DESCRIPTION = 20_000
const MAX_MEMORY_TITLE = 120
const MAX_MEMORY_CONTENT = 8_000
const MAX_MEMORY_ENTRIES = 50
const MAX_MEMORY_TOTAL = 40_000
const MAX_COMMAND_NAME = 32
const MAX_SKILL_ID = 64
const MAX_LIBRARY_DESCRIPTION = 2_000
const MAX_SKILL_EVIDENCE = 500
const MAX_PENDING_DRAFTS = 10
const MAX_COMMAND_TEMPLATE = 20_000
const STALE_SKILL_MS = 60 * 24 * 60 * 60 * 1000
const SKILL_SWEEP_MS = 6 * 60 * 60 * 1000
const MAX_SKILL_CONTENT = 100_000
const MAX_SKILL_FILE_BYTES = 4 * 1024 * 1024
const MAX_SKILL_FILES = 200
const MAX_SKILL_TOTAL_BYTES = 40 * 1024 * 1024
const TARGET_TIMEOUT_MS = 120_000
const MAX_TASK_TITLE = 200
const MAX_TASK_NOTES = 4_000
const MAX_TASKS = 300
const MAX_OPEN_TASKS_PER_BOT = 50
const MAX_JOBS = 50
const MAX_JOB_NAME = 80
const MAX_JOB_PROMPT = 8_000
const MIN_JOB_GAP_MS = 5 * 60 * 1000
const DONE_TASK_TTL_MS = 30 * 24 * 60 * 60 * 1000
const PROMPT_TASKS = 30
const SCHEDULE_TICK_MS = 20_000
const LATE_RUN_MS = 2 * 60 * 1000
const PRUNE_MS = 60 * 60 * 1000
const MAX_WORKERS = 100
const MAX_WORKERS_PER_BOT = 25
const MAX_WORKER_TITLE = 200
const MAX_WORKER_MESSAGE = 20_000
const MAX_WORKER_READ = 12_000

type StoredMemory = {
  id: string
  title: string
  content: string
}

type StoredBot = {
  id: string
  name: string
  handle: string
  color: string
  /** Seed for the face the web app draws (web/src/face.ts). */
  face: string
  role: string
  sessionID: string
  memory: StoredMemory[]
  /** When the role last changed after creation; drives the mid-conversation notice. */
  roleChangedAt?: number
  createdAt: number
  updatedAt: number
}

type StoredGroup = {
  id: string
  name: string
  color: string
  hostID: string
  memberIDs: string[]
  description: string
  sessionID: string
  createdAt: number
  updatedAt: number
}

type StoredCommand = {
  id: string
  name: string
  description: string
  template: string
  scope: LibraryScope
  botIDs: string[]
}

type StoredSkill = {
  id: string
  name: string
  description: string
  autoinvoke: boolean
  scope: LibraryScope
  botIDs: string[]
  status: SkillStatus
  pinned: boolean
  /** The bot that created the skill, or "" when the user created it in the Library. */
  author: string
  /** For bot proposals: what confirmed the approach worked. */
  evidence: string
  createdAt: number
  uses: number
  /** When a bot last loaded the skill; 0 means never. */
  lastUsedAt: number
}

type StoredTask = {
  id: string
  botID: string
  title: string
  notes: string
  status: TaskStatus
  /** When the task wakes its bot; 0 means no wake time. Cleared once it fires. */
  wakeAt: number
  /** The bot that created the task, or "" when the user created it. */
  author: string
  createdAt: number
  updatedAt: number
  doneAt: number
}

type StoredJob = {
  id: string
  botID: string
  name: string
  prompt: string
  cron: string
  timeZone: string
  enabled: boolean
  notify: boolean
  /** The bot that created the job, or "" when the user created it. */
  author: string
  createdAt: number
  updatedAt: number
  /** 0 when paused or when the expression never matches again. */
  nextRunAt: number
  lastRunAt: number
  runs: number
}

/**
 * A top-level OpenCode session a bot opened in a project directory. The session
 * itself lives in OpenCode's database; this is only the bot's index of it.
 */
type StoredWorker = {
  id: string
  botID: string
  sessionID: string
  directory: string
  /** The title given at creation; "" lets OpenCode title the session. */
  title: string
  createdAt: number
  updatedAt: number
}

type Store = {
  version: 1
  model: ModelRef | null
  bots: StoredBot[]
  groups: StoredGroup[]
  commands: StoredCommand[]
  skills: StoredSkill[]
  tasks: StoredTask[]
  jobs: StoredJob[]
  workers: StoredWorker[]
  coordinatorID: string
}

/**
 * True when OpenCode reports that a session no longer exists. In-process calls
 * raise `Session.NotFoundError`; the HTTP client's form is `SessionNotFoundError`.
 */
const isMissing = (error: unknown) => {
  const value = (error ?? {}) as { _tag?: unknown; name?: unknown; message?: unknown }
  return (
    [value._tag, value.name].some(
      (tag) => typeof tag === "string" && /^Session\.?NotFoundError$/.test(tag),
    ) ||
    (typeof value.message === "string" && /session not found/i.test(value.message))
  )
}

const optionPath = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return undefined
  const text = value.trim()
  return resolve(text.startsWith("~/") ? join(homedir(), text.slice(2)) : text)
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_HANDLE - 3) || "bot"

const cleanName = (value: unknown) => {
  const text = typeof value === "string" ? value.trim() : ""
  return (text || "Bot").slice(0, MAX_NAME)
}

const cleanGroupName = (value: unknown) => {
  const text = typeof value === "string" ? value.trim() : ""
  return (text || "Group").slice(0, MAX_NAME)
}

const cleanColor = (value: unknown) => {
  const text = typeof value === "string" ? value.trim() : ""
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : DEFAULT_COLORS[0]
}

const cleanFace = (value: unknown) =>
  typeof value === "string" && /^[0-9a-f]{8}$/.test(value) ? value : null

const randomFace = () => randomBytes(4).toString("hex")

const randomColor = () => FACE_COLORS[randomInt(FACE_COLORS.length)]!

const cleanRole = (value: unknown) => (typeof value === "string" ? value.slice(0, MAX_ROLE) : "")

const cleanDescription = (value: unknown) =>
  typeof value === "string" ? value.slice(0, MAX_GROUP_DESCRIPTION) : ""

const cleanModel = (value: unknown): ModelRef | null => {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const providerID = typeof record.providerID === "string" ? record.providerID.trim() : ""
  const id = typeof record.id === "string" ? record.id.trim() : ""
  if (!providerID || !id) return null
  const variant =
    typeof record.variant === "string" && record.variant.trim() ? record.variant.trim() : undefined
  return { providerID, id, ...(variant ? { variant } : {}) }
}

const cleanMemory = (value: unknown): StoredMemory[] => {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const title =
        typeof item.title === "string" ? item.title.trim().slice(0, MAX_MEMORY_TITLE) : ""
      const content =
        typeof item.content === "string" ? item.content.trim().slice(0, MAX_MEMORY_CONTENT) : ""
      const id =
        typeof item.id === "string" && /^[a-zA-Z0-9._-]+$/.test(item.id) ? item.id : randomUUID()
      return { id, title: title || "Memory", content }
    })
    .filter((item) => item.content.length > 0)
}

const cleanScope = (value: unknown): LibraryScope => (value === "selected" ? "selected" : "all")

const cleanCommandName = (value: unknown) => {
  const text = typeof value === "string" ? value.trim().replace(/^\/+/, "").toLowerCase() : ""
  return text
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_COMMAND_NAME)
}

const cleanSkillID = (value: unknown) => {
  const text = typeof value === "string" ? value.trim().toLowerCase() : ""
  return text
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SKILL_ID)
}

const cleanLibraryText = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : ""

const cleanSkillStatus = (value: unknown): SkillStatus =>
  value === "draft" || value === "archived" ? value : "active"

const cleanCount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0

const cleanBotIDs = (value: unknown, scope: LibraryScope, valid: (id: string) => boolean) => {
  if (scope === "all" || !Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === "string" && valid(id)))]
}

const cleanCommands = (value: unknown, validBot: (id: string) => boolean): StoredCommand[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const output: StoredCommand[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const name = cleanCommandName(record.name)
    if (!name || seen.has(name)) continue
    const template = cleanLibraryText(record.template, MAX_COMMAND_TEMPLATE)
    if (!template) continue
    seen.add(name)
    const scope = cleanScope(record.scope)
    output.push({
      id:
        typeof record.id === "string" && /^[a-zA-Z0-9._-]+$/.test(record.id)
          ? record.id
          : randomUUID(),
      name,
      description: cleanLibraryText(record.description, MAX_LIBRARY_DESCRIPTION),
      template,
      scope,
      botIDs: cleanBotIDs(record.botIDs, scope, validBot),
    })
  }
  return output
}

const cleanSkills = (value: unknown, validBot: (id: string) => boolean): StoredSkill[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const output: StoredSkill[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const id = cleanSkillID(record.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const scope = cleanScope(record.scope)
    const name = cleanLibraryText(record.name, MAX_NAME) || id
    output.push({
      id,
      name,
      description: cleanLibraryText(record.description, MAX_LIBRARY_DESCRIPTION),
      autoinvoke: record.autoinvoke !== false,
      scope,
      botIDs: cleanBotIDs(record.botIDs, scope, validBot),
      status: cleanSkillStatus(record.status),
      pinned: record.pinned === true,
      author: cleanLibraryText(record.author, MAX_SKILL_ID),
      evidence: cleanLibraryText(record.evidence, MAX_SKILL_EVIDENCE),
      createdAt: cleanCount(record.createdAt) || Date.now(),
      uses: cleanCount(record.uses),
      lastUsedAt: cleanCount(record.lastUsedAt),
    })
  }
  return output
}

const cleanTaskStatus = (value: unknown): TaskStatus =>
  value === "doing" || value === "done" ? value : "todo"

const cleanItemID = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9._-]{1,64}$/.test(value) ? value : ""

/** Short IDs: bots quote them in tool calls, and they appear in every prompt. */
const shortID = (taken: (id: string) => boolean) => {
  let id = randomBytes(4).toString("hex")
  while (taken(id)) id = randomBytes(4).toString("hex")
  return id
}

const cleanTasks = (value: unknown, validBot: (id: string) => boolean): StoredTask[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const output: StoredTask[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const botID = typeof record.botID === "string" ? record.botID : ""
    const title = cleanLibraryText(record.title, MAX_TASK_TITLE)
    if (!validBot(botID) || !title) continue
    const id = cleanItemID(record.id) || shortID((taken) => seen.has(taken))
    if (seen.has(id)) continue
    seen.add(id)
    const status = cleanTaskStatus(record.status)
    const createdAt = cleanCount(record.createdAt) || Date.now()
    output.push({
      id,
      botID,
      title,
      notes: cleanLibraryText(record.notes, MAX_TASK_NOTES),
      status,
      wakeAt: status === "done" ? 0 : cleanCount(record.wakeAt),
      author: cleanLibraryText(record.author, MAX_SKILL_ID),
      createdAt,
      updatedAt: cleanCount(record.updatedAt) || createdAt,
      doneAt: status === "done" ? cleanCount(record.doneAt) || createdAt : 0,
    })
  }
  return output
}

const cleanJobs = (
  value: unknown,
  validBot: (id: string) => boolean,
  timeZone: string,
): StoredJob[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const output: StoredJob[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const botID = typeof record.botID === "string" ? record.botID : ""
    const prompt = cleanLibraryText(record.prompt, MAX_JOB_PROMPT)
    const cron = typeof record.cron === "string" ? record.cron.trim() : ""
    if (!validBot(botID) || !prompt || !cron) continue
    const id = cleanItemID(record.id) || shortID((taken) => seen.has(taken))
    if (seen.has(id)) continue
    seen.add(id)
    const zone = typeof record.timeZone === "string" ? record.timeZone.trim() : ""
    const createdAt = cleanCount(record.createdAt) || Date.now()
    const enabled = record.enabled !== false
    output.push({
      id,
      botID,
      name: cleanLibraryText(record.name, MAX_JOB_NAME) || "Scheduled job",
      prompt,
      cron,
      timeZone: zone && validTimeZone(zone) ? zone : timeZone,
      enabled,
      notify: record.notify !== false,
      author: cleanLibraryText(record.author, MAX_SKILL_ID),
      createdAt,
      updatedAt: cleanCount(record.updatedAt) || createdAt,
      nextRunAt: enabled ? cleanCount(record.nextRunAt) : 0,
      lastRunAt: cleanCount(record.lastRunAt),
      runs: cleanCount(record.runs),
    })
  }
  return output
}

const cleanWorkers = (value: unknown, validBot: (id: string) => boolean): StoredWorker[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const sessions = new Set<string>()
  const perBot = new Map<string, number>()
  const output: StoredWorker[] = []
  for (const item of value) {
    if (output.length >= MAX_WORKERS) break
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const botID = typeof record.botID === "string" ? record.botID : ""
    const sessionID = typeof record.sessionID === "string" ? record.sessionID.trim() : ""
    const directory = typeof record.directory === "string" ? record.directory.trim() : ""
    if (!validBot(botID) || !sessionID || !isAbsolute(directory) || sessions.has(sessionID))
      continue
    const count = perBot.get(botID) ?? 0
    if (count >= MAX_WORKERS_PER_BOT) continue
    const id = cleanItemID(record.id) || shortID((taken) => seen.has(taken))
    if (seen.has(id)) continue
    seen.add(id)
    sessions.add(sessionID)
    perBot.set(botID, count + 1)
    const createdAt = cleanCount(record.createdAt) || Date.now()
    output.push({
      id,
      botID,
      sessionID,
      directory: resolve(directory),
      title: cleanLibraryText(record.title, MAX_WORKER_TITLE),
      createdAt,
      updatedAt: cleanCount(record.updatedAt) || createdAt,
    })
  }
  return output
}

/** The next run after `after`, or 0 when the job is paused or never runs again. */
const jobNextRun = (job: Pick<StoredJob, "cron" | "timeZone" | "enabled">, after: number) => {
  if (!job.enabled) return 0
  try {
    return nextRun(parseCron(job.cron), after, job.timeZone) ?? 0
  } catch {
    return 0
  }
}

/** Throws a readable error unless the expression runs, and no more often than every 5 minutes. */
const validateSchedule = (cron: string, timeZone: string) => {
  if (!validTimeZone(timeZone)) {
    throw new Error(`"${timeZone}" is not a time zone. Use an IANA name such as "Europe/Paris".`)
  }
  const parsed = parseCron(cron)
  const now = Date.now()
  if (nextRun(parsed, now, timeZone) === null) {
    throw new Error(`"${cron}" never runs. Check the day and month fields.`)
  }
  if (shortestGap(parsed, now, timeZone) < MIN_JOB_GAP_MS) {
    throw new Error("A job can run at most once every 5 minutes.")
  }
}

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  doing: "In progress",
  done: "Done",
}

/** In progress first, then by wake time (soonest first), then most recently updated. */
const taskOrder = (a: StoredTask, b: StoredTask) =>
  (a.status === "doing" ? 0 : 1) - (b.status === "doing" ? 0 : 1) ||
  (a.wakeAt || Infinity) - (b.wakeAt || Infinity) ||
  b.updatedAt - a.updatedAt

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const parseArguments = (value: string) => {
  const output: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const match of value.matchAll(pattern)) {
    output.push(match[1] ?? match[2] ?? match[3] ?? "")
  }
  return output
}

const expandCommand = (template: string, argumentsText: string) => {
  const args = argumentsText.trim()
  const positional = parseArguments(args)
  const indexes = [...template.matchAll(/\$([1-9])/g)].map((match) => Number(match[1]))
  const highest = indexes.length ? Math.max(...indexes) : 0
  let result = template.replaceAll("$ARGUMENTS", args)
  result = result.replace(/\$([1-9])/g, (_match, value: string) => {
    const index = Number(value) - 1
    if (index === highest - 1) return positional.slice(index).join(" ")
    return positional[index] ?? ""
  })
  if (!template.includes("$ARGUMENTS") && highest === 0 && args) {
    result = `${result.trimEnd()}\n\n${args}`
  }
  return result.trim()
}

const escapeXML = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const skillEntry = (skill: { id: string; name: string; description: string }) =>
  [
    "  <skill>",
    `    <id>${escapeXML(skill.id)}</id>`,
    `    <name>${escapeXML(skill.name)}</name>`,
    `    <description>${escapeXML(skill.description)}</description>`,
    "  </skill>",
  ].join("\n")

const stripFrontmatter = (text: string) => {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  return (match ? text.slice(match[0].length) : text).trim()
}

const skillMarkdown = (skill: StoredSkill, content: string) => {
  const front = ["---", `name: ${JSON.stringify(skill.name)}`]
  if (skill.description) front.push(`description: ${JSON.stringify(skill.description)}`)
  if (!skill.autoinvoke) front.push("metadata:", "  opencode/autoinvoke: false")
  front.push("---", "", content, "")
  return front.join("\n")
}

const toView = (bot: StoredBot): BotView => ({
  id: bot.id,
  name: bot.name,
  handle: bot.handle,
  color: bot.color,
  face: bot.face,
  role: bot.role,
  sessionID: bot.sessionID,
  memory: bot.memory.map((entry) => ({ ...entry })),
  createdAt: bot.createdAt,
  updatedAt: bot.updatedAt,
})

const toGroupView = (group: StoredGroup): GroupView => ({
  id: group.id,
  name: group.name,
  color: group.color,
  hostID: group.hostID,
  memberIDs: [...group.memberIDs],
  description: group.description,
  sessionID: group.sessionID,
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
})

const toTaskView = (task: StoredTask): TaskView => ({ ...task })

const toJobView = (job: StoredJob): JobView => ({ ...job })

const toWorkerView = (worker: StoredWorker): WorkerView => ({ ...worker })

const storedBot = (raw: Record<string, unknown>): StoredBot => {
  const name = cleanName(raw.name)
  const created = typeof raw.createdAt === "number" ? raw.createdAt : Date.now()
  return {
    id: String(raw.id),
    name,
    handle: typeof raw.handle === "string" && raw.handle ? raw.handle : slugify(name),
    color: cleanColor(raw.color),
    // Bots saved before faces existed get a stable one derived from their ID.
    face:
      cleanFace(raw.face) ?? createHash("sha1").update(String(raw.id)).digest("hex").slice(0, 8),
    role: cleanRole(raw.role),
    sessionID: typeof raw.sessionID === "string" ? raw.sessionID : "",
    memory: cleanMemory(raw.memory),
    ...(typeof raw.roleChangedAt === "number" ? { roleChangedAt: raw.roleChangedAt } : {}),
    createdAt: created,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : created,
  }
}

const storedGroup = (raw: Record<string, unknown>): StoredGroup => {
  const members = Array.isArray(raw.memberIDs)
    ? raw.memberIDs.filter((id): id is string => typeof id === "string")
    : []
  const created = typeof raw.createdAt === "number" ? raw.createdAt : Date.now()
  return {
    id: String(raw.id),
    name: cleanGroupName(raw.name),
    color: cleanColor(raw.color),
    hostID: typeof raw.hostID === "string" ? raw.hostID : "",
    memberIDs: [...new Set(members)],
    description: cleanDescription(raw.description),
    sessionID: typeof raw.sessionID === "string" ? raw.sessionID : "",
    createdAt: created,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : created,
  }
}

const memorySection = (bot: StoredBot, owner: string) => [
  "Memory:",
  bot.memory.length
    ? bot.memory.map((entry) => `- [${entry.id}] ${entry.title}: ${entry.content}`).join("\n")
    : "- No memory entries yet.",
  "",
  `Manage this memory with the bots_memory tool. Save only facts and durable preferences the user actually stated; never save your own guesses, inferences about the user, or lessons you judged yourself. Keep entries short, and update an existing entry instead of adding a near-duplicate. Use action "save" with title/content to add or update an entry, or action "delete" with the entry's id to forget it. Memory is private to ${owner}.`,
]

// With Code Mode on, plugin tools are not direct tool calls: they live in the
// `execute` tool's catalog (for example `tools.bots.memory`). Bots that are only told
// "call bots_memory" look for a direct tool, find none, and give up.
const TOOL_NOTE = [
  "Bot tools: bots_send, bots_memory, bots_role, bots_skill, bots_command, bots_task, bots_job, bots_worker, and bots_create (coordinator only).",
  "If they are not listed as direct tools, they are in the execute tool's catalog (for example `await tools.bots.memory({...})` inside execute). Search the catalog for them before concluding a tool is missing.",
]

const FROM_BOT_RULES = [
  "- A message prefixed [From @handle] comes from another bot. Answer it directly and do not call bots_send for that message.",
  "- The other bot replies in its own session, and you receive its reply as the tool result.",
]

const LEARNING_RULES = [
  "Learning:",
  '- After a multi-step task whose success something outside you confirmed (tests or checks passed, the user confirmed it worked), you may propose a reusable skill with bots_skill action "propose", stating that evidence.',
  '- Do not propose when success rests only on your own judgement, for one-off tasks, or when an existing skill covers it; improve that skill with a minimal "patch" instead.',
  '- Use "save" only when the user asks you to create or change a skill.',
  "- Change your role with bots_role only when the user asks.",
]

const PLANNING_RULES = [
  "Tasks and jobs:",
  "- Track work that outlives your current reply with bots_task: follow-ups, multi-step work, and anything you promised to do later. Keep the list current: in progress when you start, done when finished; delete tasks that no longer matter.",
  '- Give a task a wake time to be reminded at that moment (wake: "45m", "2h", "3d", or "2026-11-09 09:00"). When a task reminder arrives, act on it, then mark the task done or snooze it with a new wake time.',
  "- Create a scheduled job with bots_job only when the user asks for something to happen repeatedly. Each run posts the job's prompt into your conversation.",
  '- Messages that start with "Scheduled job" or "Task reminder" are automatic: the user did not just write them and may not be watching. Do the work and reply with a short result.',
]

const WORKER_RULES = [
  "Project workers:",
  "- bots_worker opens an independent, classic OpenCode session in a project directory. It is a real top-level session: the user sees it under that project in Desktop and can open and continue it.",
  "- A worker gets that project's own agents, skills, instructions (AGENTS.md), MCP servers, permissions, and default model. It does not get your role, memory, library skills, or bot tools, so give it everything it needs in the message.",
  '- Use "send" to continue a worker. For long work, send with wait false (or let a wait time out), then check back with "read" or "status".',
  '- Use "delete" only when the user asks: it deletes the session and its history.',
]

const COORDINATOR_PLANNING_RULES = [
  "- As the coordinator you keep the team on track. You see every bot's open tasks below, and you can assign tasks or schedule jobs for any bot by passing its handle as bot. When the user hands you work with a deadline or a follow-up, record it as a task with a wake time so you come back to it without being asked.",
]

type PlanData = {
  tasks: readonly StoredTask[]
  jobs: readonly StoredJob[]
  bots: readonly StoredBot[]
  coordinator: boolean
  timeZone: string
}

const taskLine = (task: StoredTask, timeZone: string, owner = "") =>
  [
    `- [${task.id}] ${owner}${TASK_STATUS_LABEL[task.status]}: ${task.title}`,
    task.wakeAt ? ` (wakes ${formatTime(task.wakeAt, timeZone)})` : "",
    task.notes ? ` — ${oneLine(task.notes, 200)}` : "",
  ].join("")

const jobLine = (job: StoredJob) =>
  [
    `- [${job.id}] ${job.name}: ${describeCron(job.cron)} (${job.timeZone})`,
    !job.enabled
      ? ", paused"
      : job.nextRunAt
        ? `, next ${formatTime(job.nextRunAt, job.timeZone)}`
        : ", never runs again",
    ` — ${oneLine(job.prompt, 160)}`,
  ].join("")

/**
 * The bot's own board and jobs, plus the whole team's open tasks for the
 * coordinator. The date has day precision so the prompt stays cacheable.
 */
const planSection = (bot: StoredBot, plan: PlanData) => {
  const open = plan.tasks
    .filter((task) => task.botID === bot.id && task.status !== "done")
    .sort(taskOrder)
  const jobs = plan.jobs.filter((job) => job.botID === bot.id)
  const more = (count: number) =>
    count > PROMPT_TASKS ? [`- …and ${count - PROMPT_TASKS} more (bots_task action "list").`] : []
  const lines = [
    `Today is ${formatDay(Date.now(), plan.timeZone)} (time zone ${plan.timeZone}). Scheduled messages and bots_task results carry the exact time.`,
    "",
    "Your tasks:",
    ...(open.length
      ? [
          ...open.slice(0, PROMPT_TASKS).map((task) => taskLine(task, plan.timeZone)),
          ...more(open.length),
        ]
      : ["- No open tasks."]),
    "",
    "Your scheduled jobs:",
    ...(jobs.length ? jobs.map(jobLine) : ["- No scheduled jobs."]),
    "",
    ...PLANNING_RULES,
    ...(plan.coordinator ? COORDINATOR_PLANNING_RULES : []),
  ]
  if (plan.coordinator) {
    const handles = new Map(plan.bots.map((item) => [item.id, item.handle]))
    const team = plan.tasks
      .filter((task) => task.botID !== bot.id && task.status !== "done" && handles.has(task.botID))
      .sort(taskOrder)
    lines.push(
      "",
      "Team board (other bots' open tasks):",
      ...(team.length
        ? [
            ...team
              .slice(0, PROMPT_TASKS)
              .map((task) => taskLine(task, plan.timeZone, `@${handles.get(task.botID)} · `)),
            ...more(team.length),
          ]
        : ["- No open tasks."]),
    )
  }
  return lines
}

// System parts are joined with a single newline, so the leading blank line
// keeps this block separate from the instructions part OpenCode writes above.
const buildSystemPrompt = (bot: StoredBot, plan: PlanData) =>
  [
    "",
    "# Bot",
    `You are "${bot.name}" (@${bot.handle}), a bot in Bots for OpenCode. OpenCode is the harness you run in; the role below defines your job.`,
    "",
    "## Role",
    bot.role.trim() || "Be a helpful, concise assistant.",
    "",
    "You have your own persistent OpenCode session. Treat this conversation as continuous.",
    "",
    ...TOOL_NOTE,
    "",
    "Bot mentions:",
    "- When the user's current message mentions another bot with @handle, call the bots_send tool with the target handle and the message to send.",
    "- Only call bots_send when the user's current message includes a bot mention. Never call it on your own.",
    "- A scheduled job or task reminder counts as the current message: when its text mentions a bot with @handle, you may contact that bot.",
    ...FROM_BOT_RULES,
    "",
    ...LEARNING_RULES,
    "",
    ...WORKER_RULES,
    "",
    ...planSection(bot, plan),
    "",
    ...memorySection(bot, "you"),
  ].join("\n")

/**
 * OpenCode unloads a location after an hour without session activity, which
 * disposes this plugin: the scheduler stops, and once every location is
 * unloaded the web host stops too, taking the tunnel with it. The bot workspace
 * opts out in its own project config. A value the user already set is kept.
 */
async function keepWorkspaceLoaded(workspace: string) {
  const path = join(workspace, ".opencode", "opencode.json")
  let config: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return
    config = parsed as Record<string, unknown>
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") {
      console.warn(
        `[opencode-bots] left ${path} alone: ${error instanceof Error ? error.message : error}`,
      )
      return
    }
  }
  const experimental = config.experimental
  if (experimental !== undefined && (typeof experimental !== "object" || experimental === null))
    return
  if (experimental && "location_idle_timeout" in experimental) return
  config.$schema ??= "https://opencode.ai/config.json"
  config.experimental = { ...experimental, location_idle_timeout: false }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`)
}

export default Plugin.define({
  id: "opencode-bots",
  async setup(ctx) {
    const workspace = optionPath(ctx.options.workspace) ?? DEFAULT_WORKSPACE
    const dataDir = optionPath(ctx.options.data) ?? DEFAULT_DATA
    const storePath = join(dataDir, "bots.json")
    const skillsDir = join(dataDir, "skills")
    const skillPath = (id: string) => join(skillsDir, id, "SKILL.md")
    const isBotWorkspace = resolve(ctx.location.directory) === resolve(workspace)

    // Every location keeps the shared web host alive; only the bot workspace
    // registers the bot tools, hooks, and RPC.
    const releaseWebHost = acquireWebHost({ appDir: APP_DIR, workspace, dataDir })
    // Any location writes it, so it is in place before the bot workspace loads.
    await keepWorkspaceLoaded(workspace).catch((error) =>
      console.warn("[opencode-bots] could not keep the bot workspace loaded", error),
    )
    if (!isBotWorkspace) return async () => releaseWebHost()

    await mkdir(workspace, { recursive: true })

    // Jobs default to the machine's zone, and bare wake times are read in it.
    const timeZone = localTimeZone()

    let store: Store = {
      version: 1,
      model: null,
      bots: [],
      groups: [],
      commands: [],
      skills: [],
      tasks: [],
      jobs: [],
      workers: [],
      coordinatorID: "",
    }
    let storeStamp = ""
    let freshInstall = false
    let writeChain: Promise<void> = Promise.resolve()

    const stampOf = async () => {
      const info = await stat(storePath)
      return `${info.mtimeMs}:${info.size}`
    }

    // Writes are serialized, and each records the file's stamp so refreshStore
    // only re-reads after an outside edit, not after this instance's own write.
    const save = () => {
      const next = writeChain
        .catch(() => {})
        .then(async () => {
          await mkdir(dirname(storePath), { recursive: true })
          const temp = `${storePath}.tmp`
          await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8")
          await rename(temp, storePath)
          storeStamp = await stampOf()
        })
      writeChain = next
      return next
    }

    const readStore = async () => {
      const raw = await readFile(storePath, "utf8")
      const parsed = JSON.parse(raw) as {
        version?: number
        model?: unknown
        bots?: Array<Record<string, unknown>>
        groups?: Array<Record<string, unknown>>
        commands?: unknown
        skills?: unknown
        tasks?: unknown
        jobs?: unknown
        workers?: unknown
        coordinatorID?: unknown
      }
      const bots = Array.isArray(parsed.bots)
        ? parsed.bots.filter((bot) => !!bot && typeof bot.id === "string")
        : []
      const groups = Array.isArray(parsed.groups)
        ? parsed.groups.filter((group) => !!group && typeof group.id === "string")
        : []
      const botIDs = new Set(bots.map((bot) => String(bot.id)))
      const validBot = (id: string) => botIDs.has(id)
      // One-time migration from the removed per-bot model field. The first
      // legacy value becomes the single global model; per-bot values are dropped.
      const legacyModel = bots.find((bot) => bot.model)?.model
      const model = cleanModel(parsed.model ?? legacyModel)
      const storedCoordinator =
        typeof parsed.coordinatorID === "string" &&
        parsed.coordinatorID &&
        botIDs.has(parsed.coordinatorID)
          ? parsed.coordinatorID
          : ""
      const coordinatorID =
        storedCoordinator ||
        bots.find((bot) => typeof bot.handle === "string" && bot.handle === "chief")?.id ||
        ""
      const skills = cleanSkills(parsed.skills, validBot)
      let skillsMigrated = false
      if (Array.isArray(parsed.skills)) {
        const rawSkills = parsed.skills.filter(
          (item): item is Record<string, unknown> => !!item && typeof item === "object",
        )
        for (const skill of skills) {
          const rawSkill = rawSkills.find((item) => cleanSkillID(item.id) === skill.id)
          const content = typeof rawSkill?.content === "string" ? rawSkill.content.trim() : ""
          if (!content) continue
          const file = skillPath(skill.id)
          if (!(await stat(file).catch(() => null))) {
            await mkdir(dirname(file), { recursive: true })
            await writeFile(file, skillMarkdown(skill, content), "utf8")
          }
          skillsMigrated = true
        }
      }
      store = {
        version: 1,
        model,
        bots: bots.map(storedBot),
        groups: groups.map(storedGroup),
        commands: cleanCommands(parsed.commands, validBot),
        skills,
        tasks: cleanTasks(parsed.tasks, validBot),
        jobs: cleanJobs(parsed.jobs, validBot, timeZone),
        workers: cleanWorkers(parsed.workers, validBot),
        coordinatorID: String(coordinatorID),
      }
      return (
        parsed.version !== 1 ||
        !("model" in parsed) ||
        !("groups" in parsed) ||
        !("commands" in parsed) ||
        !("skills" in parsed) ||
        !("tasks" in parsed) ||
        !("jobs" in parsed) ||
        !("workers" in parsed) ||
        !("coordinatorID" in parsed) ||
        bots.some((bot) => "model" in bot) ||
        parsed.coordinatorID !== coordinatorID ||
        skillsMigrated ||
        // Persist the createdAt default once, or a skill's age resets on every load.
        (Array.isArray(parsed.skills) &&
          parsed.skills.some(
            (item) => !!item && typeof item === "object" && !("createdAt" in item),
          ))
      )
    }

    const load = async () => {
      try {
        const migrated = await readStore()
        storeStamp = await stampOf()
        if (migrated) await save()
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error
        freshInstall = true
        await save()
      }
    }

    /** Picks up hand edits to bots.json. */
    const refreshStore = async () => {
      try {
        await writeChain.catch(() => {})
        const stamp = await stampOf()
        if (stamp === storeStamp) return
        const migrated = await readStore()
        storeStamp = stamp
        if (migrated) await save()
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") {
          console.error("[opencode-bots] could not refresh bot store", error)
        }
      }
    }

    await load()

    const findBot = (id: string) => store.bots.find((bot) => bot.id === id)
    const findBotBySession = (sessionID: string) =>
      store.bots.find((bot) => bot.sessionID === sessionID)
    const findGroup = (id: string) => store.groups.find((group) => group.id === id)
    const findGroupBySession = (sessionID: string) =>
      store.groups.find((group) => group.sessionID === sessionID)
    const findBotByHandle = (handle: string) => {
      const clean = handle.trim().replace(/^@+/, "").toLowerCase()
      return store.bots.find((bot) => bot.handle === clean)
    }

    const planFor = (bot: StoredBot): PlanData => ({
      tasks: store.tasks,
      jobs: store.jobs,
      bots: store.bots,
      coordinator: bot.id === store.coordinatorID,
      timeZone,
    })

    type Messages = Awaited<ReturnType<typeof ctx.session.context>>

    /** The last non-empty assistant text created at or after `since`. */
    const replyText = (messages: Messages, since: number) =>
      messages
        .filter((item) => item.type === "assistant" && item.time.created >= since)
        .map((item) =>
          item.type === "assistant"
            ? item.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n")
                .trim()
            : "",
        )
        .filter(Boolean)
        .at(-1) ?? ""

    type Trigger = Extract<Messages[number], { type: "user" | "synthetic" }>

    /** The message that started the current run: the user's, or a scheduled job's or task's. */
    const triggerOf = (messages: Messages) =>
      messages.findLast(
        (item): item is Trigger =>
          item.type === "user" ||
          (item.type === "synthetic" &&
            (typeof item.metadata?.botsJob === "string" ||
              typeof item.metadata?.botsTask === "string")),
      )

    const scheduledBy = (trigger: Trigger) => {
      const { botsJob, botsTask } = trigger.metadata ?? {}
      return {
        job: store.jobs.find((item) => item.id === botsJob),
        task: store.tasks.find((item) => item.id === botsTask),
      }
    }

    /** The bot speaking in a session: the bot itself, or a group's host. */
    const sourceFor = (sessionID: string) => {
      const bot = findBotBySession(sessionID)
      const group = bot ? undefined : findGroupBySession(sessionID)
      return { bot, group, source: bot ?? (group ? findBot(group.hostID) : undefined) }
    }

    const skillRoot = (id: string) => join(skillsDir, id)

    const readSkillContent = async (id: string) => {
      const text = await readFile(skillPath(id), "utf8").catch(() => "")
      return stripFrontmatter(text)
    }

    /**
     * The web host owns VAPID keys and subscriptions. The plugin only asks it to
     * send, authenticating with the internal secret from push.json. With no
     * subscribed device the web host sends nothing.
     */
    const sendPush = async (payload: { title: string; body: string; url: string; tag: string }) => {
      try {
        const { internal } = JSON.parse(await readFile(join(dataDir, "push.json"), "utf8")) as {
          internal?: unknown
        }
        if (typeof internal !== "string") return
        const response = await fetch(`http://127.0.0.1:${WEB_PORT}/bots/notify`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-bots-internal": internal },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(4000),
        })
        if (!response.ok)
          console.warn(`[opencode-bots] notification request failed: ${response.status}`)
      } catch {
        // The web host may be restarting, or push state does not exist yet.
      }
    }

    const writeSkillDocument = async (skill: StoredSkill, content: string) => {
      const file = skillPath(skill.id)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, skillMarkdown(skill, content), "utf8")
    }

    const writeSkillFiles = async () => {
      const contents = new Map<string, string>()
      await mkdir(skillsDir, { recursive: true })
      for (const skill of store.skills) {
        const content = await readSkillContent(skill.id)
        await writeSkillDocument(skill, content)
        contents.set(skill.id, content)
      }
      return contents
    }

    const removeSkillDir = async (id: string) => {
      await rm(join(skillsDir, id), { recursive: true, force: true })
    }

    const scanSkillFiles = async (dir: string, prefix = ""): Promise<SkillFileView[]> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      const files: SkillFileView[] = []
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git") continue
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          files.push(...(await scanSkillFiles(join(dir, entry.name), relative)))
          continue
        }
        if (!entry.isFile() || entry.name === "SKILL.md") continue
        const info = await stat(join(dir, entry.name)).catch(() => null)
        if (info) files.push({ path: relative, size: info.size })
      }
      return files
    }

    const listSkillFiles = async (id: string) =>
      (await scanSkillFiles(skillRoot(id))).sort((a, b) => a.path.localeCompare(b.path))

    const resolveSkillFile = (id: string, relative: unknown) => {
      const text =
        typeof relative === "string"
          ? relative
              .replaceAll("\\", "/")
              .trim()
              .replace(/^\.\/+/, "")
          : ""
      if (!text) throw new Error("A file path is required.")
      if (text.length > 240) throw new Error("That file path is too long.")
      if (text.includes("\0")) throw new Error("That file path is invalid.")
      if (text === "SKILL.md" || text.startsWith("/") || /^[a-zA-Z]:/.test(text)) {
        throw new Error("Use a relative path other than SKILL.md.")
      }
      const parts = text.split("/")
      if (parts.some((part) => !part || part === "." || part === "..")) {
        throw new Error("Use a relative path without empty, . or .. segments.")
      }
      if (parts.at(-1) === "SKILL.md") {
        throw new Error("SKILL.md is the entry file, not a supporting file.")
      }
      const root = skillRoot(id)
      const full = join(root, ...parts)
      if (full !== root && !full.startsWith(`${root}/`)) {
        throw new Error("That file path leaves the skill directory.")
      }
      return { path: parts.join("/"), full }
    }

    const readSkillFile = async (id: string, path: unknown): Promise<SkillFileContent> => {
      const target = resolveSkillFile(id, path)
      const buffer = await readFile(target.full)
      const text = buffer.toString("utf8")
      const utf8 = !text.includes("\u0000") && Buffer.from(text, "utf8").equals(buffer)
      return {
        path: target.path,
        encoding: utf8 ? "utf8" : "base64",
        content: utf8 ? text : buffer.toString("base64"),
      }
    }

    const writeSkillFile = async (
      id: string,
      path: unknown,
      content: unknown,
      encoding?: unknown,
    ) => {
      if (!store.skills.some((skill) => skill.id === id)) {
        throw new Error(`No skill with id "${id}".`)
      }
      const target = resolveSkillFile(id, path)
      if (typeof content !== "string") throw new Error("File content must be a string.")
      const buffer = Buffer.from(content, encoding === "base64" ? "base64" : "utf8")
      if (buffer.byteLength > MAX_SKILL_FILE_BYTES) {
        throw new Error(
          `That file is larger than ${Math.round(MAX_SKILL_FILE_BYTES / 1024 / 1024)} MB.`,
        )
      }
      const current = await listSkillFiles(id)
      const previous = current.find((file) => file.path === target.path)
      const count = current.length + (previous ? 0 : 1)
      if (count > MAX_SKILL_FILES) {
        throw new Error(`A skill can have at most ${MAX_SKILL_FILES} supporting files.`)
      }
      const total =
        current.reduce((sum, file) => sum + file.size, 0) -
        (previous?.size ?? 0) +
        buffer.byteLength
      if (total > MAX_SKILL_TOTAL_BYTES) {
        throw new Error(
          `A skill's supporting files can total at most ${Math.round(MAX_SKILL_TOTAL_BYTES / 1024 / 1024)} MB.`,
        )
      }
      await mkdir(dirname(target.full), { recursive: true })
      await writeFile(target.full, buffer)
      if (target.path.startsWith("scripts/") || /\.(sh|bash|zsh)$/.test(target.path)) {
        await chmod(target.full, 0o755).catch(() => {})
      }
      return { ok: true as const, files: await listSkillFiles(id) }
    }

    const deleteSkillFile = async (id: string, path: unknown) => {
      if (!store.skills.some((skill) => skill.id === id)) {
        throw new Error(`No skill with id "${id}".`)
      }
      const target = resolveSkillFile(id, path)
      const info = await stat(target.full).catch(() => null)
      if (!info?.isFile()) throw new Error("That skill file does not exist.")
      await rm(target.full, { force: true })
      let current = dirname(target.full)
      const root = skillRoot(id)
      while (current !== root && current.startsWith(root)) {
        try {
          await rmdir(current)
        } catch {
          break
        }
        current = dirname(current)
      }
      return { ok: true as const, files: await listSkillFiles(id) }
    }

    const toState = async (): Promise<BotsState> => ({
      model: store.model,
      bots: store.bots.map(toView),
      groups: store.groups.map(toGroupView),
      commands: store.commands.map((command) => ({
        ...command,
        botIDs: [...command.botIDs],
      })),
      skills: await Promise.all(
        store.skills.map(async (skill) => ({
          ...skill,
          botIDs: [...skill.botIDs],
          content: await readSkillContent(skill.id),
          files: await listSkillFiles(skill.id),
        })),
      ),
      tasks: store.tasks.map(toTaskView),
      jobs: store.jobs.map(toJobView),
      workers: store.workers.map(toWorkerView),
      coordinatorID: store.coordinatorID,
      timeZone,
    })

    const appliesTo = (item: { scope: LibraryScope; botIDs: string[] }, botID: string) =>
      item.scope === "all" || item.botIDs.includes(botID)

    const skillsFor = (botID: string) =>
      store.skills.filter((skill) => skill.status === "active" && appliesTo(skill, botID))

    const librarySkillIDs = () => new Set(store.skills.map((skill) => skill.id))

    const validateScope = (scope: LibraryScope, botIDs: readonly string[], label: string) => {
      if (scope !== "selected") return
      for (const id of botIDs) {
        if (!findBot(id)) throw new Error(`${label} is assigned to a bot that no longer exists.`)
      }
    }

    const validateLibrary = async (data: { commands: CommandInput[]; skills: SkillInput[] }) => {
      const names = new Set<string>()
      for (const command of data.commands) {
        const name = cleanCommandName(command.name)
        if (!name) throw new Error("Every command needs a name.")
        if (names.has(name)) throw new Error(`Duplicate command /${name}.`)
        names.add(name)
        if (!command.template.trim()) throw new Error(`/${name} needs a prompt template.`)
        validateScope(command.scope, command.botIDs, `/${name}`)
      }

      const ids = new Set<string>()
      for (const skill of data.skills) {
        const id = cleanSkillID(skill.id)
        if (!id) throw new Error("Every skill needs an ID.")
        if (ids.has(id)) throw new Error(`Duplicate skill ID "${id}".`)
        ids.add(id)
        if (!skill.content.trim()) throw new Error(`Skill "${id}" needs instructions.`)
        validateScope(skill.scope, skill.botIDs, `Skill "${id}"`)
      }

      const current = librarySkillIDs()
      const existing = new Set(
        (await ctx.skill.list()).data.map((skill) => skill.id).filter((id) => !current.has(id)),
      )
      for (const id of ids) {
        if (existing.has(id)) throw new Error(`Skill ID "${id}" already exists in this workspace.`)
      }
    }

    type CommandRegistration = Awaited<ReturnType<typeof ctx.command.transform>>
    type SkillRegistration = Awaited<ReturnType<typeof ctx.skill.transform>>
    let commandRegistration: CommandRegistration | undefined
    let skillRegistration: SkillRegistration | undefined

    const registerCommands = async () => {
      await commandRegistration?.dispose()
      commandRegistration = await ctx.command.transform((editor) => {
        for (const command of store.commands) {
          editor.add({
            name: command.name,
            description: command.description || undefined,
            execute: async ({ sessionID, prompt, delivery }) => {
              await refreshStore()
              const current = store.commands.find((item) => item.name === command.name)
              if (!current) throw new Error(`The /${command.name} command is no longer available.`)
              const { source } = sourceFor(sessionID)
              if (!source)
                throw new Error("Bot commands are only available in bot or group sessions.")
              if (!appliesTo(current, source.id)) {
                throw new Error(`/${current.name} is not available to ${source.name}.`)
              }
              const text = expandCommand(current.template, prompt.text)
              if (!text) throw new Error(`/${current.name} produced an empty prompt.`)
              await ctx.session.prompt({ ...prompt, sessionID, text, delivery })
            },
          })
        }
      })
    }

    const registerSkills = async () => {
      await skillRegistration?.dispose()
      const contents = await writeSkillFiles()
      skillRegistration = await ctx.skill.transform((editor) => {
        for (const skill of store.skills) {
          if (skill.status !== "active") continue
          editor.add({
            id: Skill.ID.make(skill.id),
            name: Skill.Name.make(skill.name),
            description: skill.description || undefined,
            autoinvoke: skill.autoinvoke,
            path: Skill.Info.fields.path.make(skillPath(skill.id)),
            content: contents.get(skill.id) ?? "",
          })
        }
      })
    }

    /** Archives bot-authored, unpinned skills that have gone unused for 60 days. */
    let lastSkillSweep = 0
    const archiveStaleSkills = async (force = false) => {
      const now = Date.now()
      if (!force && now - lastSkillSweep < SKILL_SWEEP_MS) return
      lastSkillSweep = now
      const stale = store.skills.filter(
        (skill) =>
          skill.status === "active" &&
          skill.author !== "" &&
          !skill.pinned &&
          now - Math.max(skill.lastUsedAt, skill.createdAt) > STALE_SKILL_MS,
      )
      if (stale.length === 0) return
      for (const skill of stale) skill.status = "archived"
      await save()
      await registerSkills()
      await emitChanged("skills")
      console.log(
        `[opencode-bots] archived ${stale.length} stale skill(s): ${stale.map((skill) => skill.id).join(", ")}`,
      )
    }

    let guidanceWarning = false
    const skillCache = new Map<string, string[]>()
    const skillGuidanceIntro = [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      "The user may also invoke a skill directly. When that happens, its instructions appear in the conversation as a <skill_content> block, the same shape the skill tool returns. A skill that is already present this way does not need to be invoked again.",
    ].join("\n")
    const skillEntries = (text: string) =>
      [...text.matchAll(/<skill>[\s\S]*?<\/skill>/g)].map((entry) => entry[0])
    const skillEntryID = (entry: string) => /<id>([\s\S]*?)<\/id>/.exec(entry)?.[1]?.trim()
    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const scrubSkillMentions = (
      messages: Array<{ content: ReadonlyArray<unknown> }>,
      ids: string[],
    ) => {
      if (ids.length === 0) return
      const patterns = ids.map((id) => ({
        line: new RegExp(`^\\s*@?${escapeRegExp(id)}\\s*$`, "gm"),
        inline: new RegExp(`@?(?<![a-z0-9-])${escapeRegExp(id)}(?![a-z0-9-])`, "g"),
      }))
      for (const message of messages) {
        for (const raw of message.content) {
          const part = raw as { type?: string; text?: string }
          if (part.type !== "text" || typeof part.text !== "string") continue
          let text = part.text
          for (const pattern of patterns) {
            text = text.replace(pattern.line, "").replace(pattern.inline, "[unavailable skill]")
          }
          part.text = text.replace(/\n{3,}/g, "\n\n").trim()
        }
      }
    }

    const applySkillGuidance = async (
      system: Array<{ type: string; text?: string }>,
      allowedSkills: StoredSkill[],
      sessionID = "",
    ) => {
      const parts = system.filter(
        (part) =>
          part.type === "text" &&
          typeof part.text === "string" &&
          part.text.includes("Skills provide specialized instructions"),
      )
      if (parts.length === 0) {
        if (!guidanceWarning) {
          guidanceWarning = true
          console.warn(
            "[opencode-bots] skill guidance block not found; bot skill scoping is inactive",
          )
        }
        return
      }

      const library = librarySkillIDs()
      const allowed = new Set(allowedSkills.map((skill) => skill.id))
      const allowedEntries = allowedSkills
        .filter((skill) => skill.description && skill.autoinvoke)
        .map(skillEntry)

      for (const guidance of parts) {
        if (typeof guidance.text !== "string") continue
        const index = guidance.text.indexOf("Skills provide specialized instructions")
        if (index < 0) continue
        const prefix = guidance.text.slice(0, index)
        const original = guidance.text.slice(index)
        const match = original.match(/<available_skills>[\s\S]*?<\/available_skills>/)
        const current = skillEntries(match ? match[0] : original)
        const currentNonLibrary = current.filter((entry) => {
          const id = skillEntryID(entry)
          return !id || !library.has(id)
        })

        const removedMatch =
          /The following skill IDs are no longer available and must not be used: ([^\n]+?)\.(?:\s|$)/.exec(
            original,
          )
        const removedIDs = new Set(
          removedMatch
            ? removedMatch[1]!
                .split(/,\s*/)
                .map((id) => id.trim())
                .filter(Boolean)
            : [],
        )

        let base = match
          ? currentNonLibrary
          : (skillCache.get(sessionID) ?? []).filter((entry) => {
              const id = skillEntryID(entry)
              return !id || !removedIDs.has(id)
            })

        if (base.length === 0 && !match) {
          base = (await ctx.skill.list()).data
            .filter(
              (skill) =>
                !library.has(skill.id) &&
                skill.description !== undefined &&
                skill.autoinvoke !== false,
            )
            .map((skill) =>
              skillEntry({
                id: skill.id,
                name: skill.name,
                description: skill.description ?? "",
              }),
            )
        }

        const merged = new Map<string, string>()
        for (const entry of [...base, ...currentNonLibrary, ...allowedEntries]) {
          const id = skillEntryID(entry)
          if (id) merged.set(id, entry)
        }
        const list = [...merged.values()]
        const block = list.length
          ? `<available_skills>\n${list.join("\n")}\n</available_skills>`
          : "No skills are currently available."

        const stale = [...library].some((id) => !allowed.has(id)) || removedIDs.size > 0
        const instruction = stale
          ? "The current <available_skills> list is authoritative. Ignore any skill ID mentioned earlier in this conversation that is not in it."
          : ""
        guidance.text = `${prefix}${[skillGuidanceIntro, block, instruction].filter(Boolean).join("\n")}`

        const nextCache = new Map<string, string>()
        for (const entry of [...base, ...currentNonLibrary]) {
          const id = skillEntryID(entry)
          if (id && !library.has(id)) nextCache.set(id, entry)
        }
        skillCache.set(sessionID, [...nextCache.values()])
      }
    }

    await registerCommands()
    await registerSkills()

    const uniqueHandle = (base: string, exceptID?: string) => {
      let handle = base
      let suffix = 2
      while (store.bots.some((bot) => bot.handle === handle && bot.id !== exceptID)) {
        const tail = `-${suffix++}`
        handle = `${base.slice(0, MAX_HANDLE - tail.length)}${tail}`
      }
      return handle
    }

    const normalizeInput = (
      input: BotInput,
    ): Omit<StoredBot, "id" | "sessionID" | "createdAt" | "updatedAt"> => {
      const name = cleanName(input.name)
      return {
        name,
        handle: uniqueHandle(slugify(name)),
        color: cleanColor(input.color),
        face: cleanFace(input.face) ?? randomFace(),
        role: cleanRole(input.role),
        memory: cleanMemory(input.memory),
      }
    }

    const applyPatch = (bot: StoredBot, patch: BotPatch) => {
      if (patch.name !== undefined) {
        bot.name = cleanName(patch.name)
        bot.handle = uniqueHandle(slugify(bot.name), bot.id)
      }
      if (patch.color !== undefined) bot.color = cleanColor(patch.color)
      if (patch.face !== undefined) bot.face = cleanFace(patch.face) ?? bot.face
      if (patch.role !== undefined) {
        const role = cleanRole(patch.role)
        if (role !== bot.role) bot.roleChangedAt = Date.now()
        bot.role = role
      }
      if (patch.memory !== undefined) bot.memory = cleanMemory(patch.memory)
      bot.updatedAt = Date.now()
    }

    const normalizeGroup = (
      input: GroupInput,
    ): Omit<StoredGroup, "id" | "sessionID" | "createdAt" | "updatedAt"> => {
      const hostID = typeof input.hostID === "string" ? input.hostID : ""
      if (!findBot(hostID)) throw new Error("Host bot not found")
      const requested = Array.isArray(input.memberIDs) ? input.memberIDs : []
      const memberIDs = [...new Set([hostID, ...requested])].filter((id) => !!findBot(id))
      return {
        name: cleanGroupName(input.name),
        color: cleanColor(input.color),
        hostID,
        memberIDs,
        description: cleanDescription(input.description),
      }
    }

    const applyGroupPatch = (group: StoredGroup, patch: GroupPatch) => {
      const next = normalizeGroup({
        name: patch.name ?? group.name,
        color: patch.color ?? group.color,
        hostID: patch.hostID ?? group.hostID,
        memberIDs: patch.memberIDs ?? group.memberIDs,
        description: patch.description ?? group.description,
      })
      Object.assign(group, next)
      group.updatedAt = Date.now()
    }

    // Deletes the OpenCode session and everything attached to it (messages,
    // parts, inbox, subagent children), the same way Desktop's delete does.
    // A missing session is treated as already deleted.
    const removeSession = async (sessionID: string, label: string) => {
      if (!sessionID) return
      try {
        await ctx.session.remove({ sessionID })
      } catch (error) {
        if (isMissing(error)) return
        console.error(`[opencode-bots] could not remove the session for ${label}`, error)
        throw new Error(
          `Could not delete the OpenCode session for ${label}. It was kept so its session is not orphaned.`,
        )
      }
    }

    const enforceModel = async (sessionID: string) => {
      const target = store.model
      if (!target) return
      try {
        const session = await ctx.session.get({ sessionID })
        const current = session.model
        if (
          current &&
          current.providerID === target.providerID &&
          current.id === target.id &&
          (!target.variant || current.variant === target.variant)
        ) {
          return
        }
        await ctx.session.switchModel({ sessionID, model: target })
      } catch (error) {
        console.error(`[opencode-bots] could not apply the global model to ${sessionID}`, error)
      }
    }

    /**
     * Returns the bot's or group's session, creating one only when it has none
     * or OpenCode reports it deleted. Any other error propagates, so a transient
     * failure never replaces a persistent conversation.
     */
    const ensureSession = async (owner: StoredBot | StoredGroup) => {
      if (owner.sessionID) {
        try {
          await ctx.session.get({ sessionID: owner.sessionID })
          await enforceModel(owner.sessionID)
          return owner.sessionID
        } catch (error) {
          if (!isMissing(error)) throw error
        }
      }

      await mkdir(workspace, { recursive: true })
      const session = await ctx.session.create({
        title: owner.name,
        ...(store.model ? { model: store.model } : {}),
        location: { directory: workspace },
      })
      owner.sessionID = session.id
      owner.updatedAt = Date.now()
      await save()
      return session.id
    }

    const buildGroupPrompt = (group: StoredGroup, host: StoredBot) => {
      const members = group.memberIDs
        .map((id) => findBot(id))
        .filter((bot): bot is StoredBot => !!bot)
      const roster = members.length
        ? members.map((bot) => `- ${bot.name} (@${bot.handle})`).join("\n")
        : "- No other members."
      return [
        "",
        "# Bot",
        `You are "${host.name}" (@${host.handle}), the host of the group chat "${group.name}". OpenCode is the harness you run in; the role and group instructions below define your job.`,
        "",
        "## Role",
        host.role.trim() || "Be a helpful, concise assistant.",
        "",
        "## Group instructions",
        group.description.trim() || "Coordinate the group and answer the user.",
        "",
        "## Group members",
        roster,
        "",
        ...TOOL_NOTE,
        "",
        "You are the host and the only bot that routes messages in this group.",
        "- When the user's current message mentions a member with @handle, call the bots_send tool with that member's handle and the message to send.",
        "- Only mention members listed above. Never call bots_send on your own.",
        ...FROM_BOT_RULES,
        "",
        ...LEARNING_RULES,
        "",
        ...WORKER_RULES,
        "",
        ...memorySection(host, "the host bot"),
      ].join("\n")
    }

    /**
     * The system prompt carries the current role on every step, but models trust
     * their own earlier replies over a system prompt that changed silently. When
     * the history predates the latest role change, the end of the request
     * repeats the role and marks the older turns as stale. Nothing is persisted.
     */
    const roleNotice = async (sessionID: string, bot: StoredBot) => {
      if (!bot.roleChangedAt) return ""
      const history = await ctx.session.context({ sessionID })
      const first = history[0]
      if (!first || first.time.created >= bot.roleChangedAt) return ""
      return [
        "Your role was changed during this conversation. Your current role is:",
        "",
        bot.role.trim() || "Be a helpful, concise assistant.",
        "",
        "Earlier messages, tool results, and your own past replies may reflect the previous role. Follow the current role.",
      ].join("\n")
    }

    const contextHook = await ctx.session.hook("context", async (event) => {
      await refreshStore()
      const { bot, group, source } = sourceFor(event.sessionID)
      if (bot) event.system.push({ type: "text", text: buildSystemPrompt(bot, planFor(bot)) })
      if (group && source)
        event.system.push({ type: "text", text: buildGroupPrompt(group, source) })
      if (source) {
        const notice = await roleNotice(event.sessionID, source)
        if (notice)
          event.messages.push({ role: "system", content: [{ type: "text", text: notice }] })
      }

      // Library skills are visible only to the bots they are scoped to.
      const allowed = source ? skillsFor(source.id) : []
      await applySkillGuidance(event.system, allowed, event.sessionID)
      const allowedIDs = new Set(allowed.map((skill) => skill.id))
      scrubSkillMentions(
        event.messages,
        [...librarySkillIDs()].filter((id) => !allowedIDs.has(id)),
      )

      // Hiding tools only works when they are direct tools; under Code Mode they
      // sit in the execute catalog instead. Either way each bots_* tool rejects
      // a session that is not a bot or group, and bots_create a non-coordinator.
      if (!source || source.id !== store.coordinatorID) delete event.tools.bots_create
      if (bot || group) return
      for (const name of [
        "bots_send",
        "bots_skill",
        "bots_memory",
        "bots_role",
        "bots_command",
        "bots_task",
        "bots_job",
        "bots_worker",
      ]) {
        delete event.tools[name]
      }
    })

    const promptHook = await ctx.session.hook("prompt", async (event) => {
      await refreshStore()
      const { bot, group, source } = sourceFor(event.sessionID)
      if (bot || group) await enforceModel(event.sessionID)

      const library = librarySkillIDs()
      if (library.size === 0 || !event.prompt.skills?.length) return
      const allowedSkills = source ? skillsFor(source.id) : []
      const allowed = new Set(allowedSkills.map((skill) => skill.id))
      const loaded = allowedSkills.filter((skill) =>
        event.prompt.skills?.some((entry) => entry.id === skill.id),
      )
      event.prompt.skills = event.prompt.skills.filter(
        (skill) => !library.has(skill.id) || allowed.has(skill.id),
      )
      await recordSkillUses(loaded)
    })

    // Runs only after a successful turn (not after failure or interruption).
    const idleHook = await ctx.session.hook("experimental.idle", async (event) => {
      await refreshStore()
      await archiveStaleSkills()
      const { bot, group } = sourceFor(event.sessionID)
      if (!bot && !group) return
      // Work this session owns wakes it again when done, so wait for that. Work a
      // descendant owns never wakes this session, so it must not hold the
      // notification back.
      if (event.background.some((item) => item.sessionID === event.sessionID)) return

      try {
        const messages = await ctx.session.context({ sessionID: event.sessionID })
        const trigger = triggerOf(messages)
        if (!trigger) return
        let title = `${bot?.name ?? group?.name} finished`
        if (trigger.type === "synthetic") {
          const { job, task } = scheduledBy(trigger)
          if (job && !job.notify) return
          title = `${bot?.name ?? group?.name}: ${job?.name ?? task?.title ?? "Scheduled run"}`
        } else if (trigger.metadata?.fromBot || trigger.metadata?.fromGroup) {
          // Bot-to-bot and group-member turns stay inside the app.
          return
        }
        const text = replyText(messages, trigger.time.created).replace(/\s+/g, " ")
        void sendPush({
          title,
          body: !text
            ? "The job is finished."
            : text.length > 160
              ? `${text.slice(0, 157)}…`
              : text,
          url: bot
            ? `/?bot=${encodeURIComponent(bot.id)}`
            : `/?group=${encodeURIComponent(group!.id)}`,
          tag: `opencode-bots:${event.sessionID}`,
        })
      } catch (error) {
        console.error("[opencode-bots] could not prepare a notification", error)
      }
    })

    let emitChanged = async (_botID: string) => {}

    const createBot = async (input: BotInput) => {
      const now = Date.now()
      const data = normalizeInput(input)
      const bot: StoredBot = {
        id: randomUUID(),
        ...data,
        sessionID: "",
        createdAt: now,
        updatedAt: now,
      }
      store.bots.push(bot)
      await save()
      try {
        await ensureSession(bot)
      } catch (error) {
        console.error("[opencode-bots] could not create session", error)
      }
      await emitChanged(bot.id)
      console.log("[opencode-bots] created bot", bot.handle)
      return bot
    }

    /** Records library skill loads for usage stats and stale-skill archiving. */
    const recordSkillUses = async (skills: StoredSkill[]) => {
      if (skills.length === 0) return
      const now = Date.now()
      for (const skill of skills) {
        skill.uses += 1
        skill.lastUsedAt = now
      }
      await save()
      await emitChanged("skills")
    }

    const saveBotSkill = async (source: StoredBot, input: unknown) => {
      const args = input as {
        action?: unknown
        id?: unknown
        name?: unknown
        description?: unknown
        content?: unknown
        files?: unknown
        path?: unknown
        encoding?: unknown
        evidence?: unknown
        old?: unknown
        new?: unknown
      }
      const action =
        args.action === "propose"
          ? "propose"
          : args.action === "patch"
            ? "patch"
            : args.action === "delete"
              ? "delete"
              : args.action === "write-file"
                ? "write-file"
                : args.action === "delete-file"
                  ? "delete-file"
                  : "save"
      const skillID = () =>
        cleanSkillID(
          typeof args.id === "string" && args.id.trim()
            ? args.id
            : typeof args.name === "string"
              ? args.name
              : "",
        )
      const pinnedError = (id: string) => ({
        content: `Error: skill "${id}" is pinned by the user and cannot be changed by bots.`,
      })

      if (action === "delete") {
        const id = skillID()
        if (!id) {
          return { content: "Error: skill id or name is required to delete a skill." }
        }
        const existing = store.skills.find((skill) => skill.id === id)
        if (!existing) {
          return { content: `Error: no skill with id "${id}".` }
        }
        if (existing.pinned) return pinnedError(id)
        store.skills = store.skills.filter((skill) => skill.id !== id)
        await save()
        await removeSkillDir(id)
        await registerSkills()
        await emitChanged("skills")
        return { content: `Deleted skill "${id}".` }
      }

      if (action === "write-file" || action === "delete-file") {
        const id = skillID()
        if (!id) return { content: "Error: skill id is required." }
        const existing = store.skills.find((skill) => skill.id === id)
        if (!existing) {
          return { content: `Error: no skill with id "${id}".` }
        }
        if (existing.pinned) return pinnedError(id)
        try {
          if (action === "write-file") {
            const result = await writeSkillFile(id, args.path, args.content, args.encoding)
            await emitChanged("skills")
            return {
              content: `Saved ${String(args.path)} in skill "${id}". The skill now has ${result.files.length} supporting file(s).`,
            }
          }
          const result = await deleteSkillFile(id, args.path)
          await emitChanged("skills")
          return {
            content: `Deleted ${String(args.path)} from skill "${id}". The skill now has ${result.files.length} supporting file(s).`,
          }
        } catch (error) {
          return { content: `Error: ${error instanceof Error ? error.message : String(error)}` }
        }
      }

      if (action === "patch") {
        const id = skillID()
        if (!id) {
          return { content: "Error: skill id or name is required to patch a skill." }
        }
        const existing = store.skills.find((skill) => skill.id === id)
        if (!existing) {
          return { content: `Error: no skill with id "${id}".` }
        }
        if (existing.pinned) return pinnedError(id)
        const old = typeof args.old === "string" ? args.old : ""
        const replacement = typeof args.new === "string" ? args.new : ""
        if (!old) return { content: "Error: old text is required to patch a skill." }
        const content = await readSkillContent(id)
        const matches = content.split(old).length - 1
        if (matches !== 1) {
          return {
            content: `Error: old text must match exactly once but matched ${matches} time(s) in skill "${id}".`,
          }
        }
        const updated = content.replace(old, replacement)
        if (updated.length > MAX_SKILL_CONTENT) {
          return {
            content: `Error: the patched instructions would exceed ${MAX_SKILL_CONTENT} characters.`,
          }
        }
        await writeSkillDocument(existing, updated)
        await registerSkills()
        await emitChanged("skills")
        return { content: `Patched skill "${id}".` }
      }

      const name = cleanLibraryText(args.name, MAX_NAME)
      const description = cleanLibraryText(args.description, MAX_LIBRARY_DESCRIPTION)
      const content = cleanLibraryText(args.content, MAX_SKILL_CONTENT)
      if (!name) return { content: "Error: skill name is required." }
      if (!description) {
        return {
          content: "Error: a skill description is required so the skill can be discovered later.",
        }
      }
      if (!content) return { content: "Error: skill instructions are required." }

      const id = cleanSkillID(typeof args.id === "string" && args.id.trim() ? args.id : name)
      if (!id) {
        return { content: "Error: a valid skill ID could not be derived from the name." }
      }

      const existing = store.skills.find((skill) => skill.id === id)
      const globalCollision = async () =>
        (await ctx.skill.list()).data.some((skill) => skill.id === id && !librarySkillIDs().has(id))

      if (action === "propose") {
        const evidence = cleanLibraryText(args.evidence, MAX_SKILL_EVIDENCE)
        if (!evidence) {
          return {
            content:
              'Error: evidence is required to propose a skill. State what confirmed the approach worked, such as "tests passed".',
          }
        }
        if (existing) {
          return {
            content: `Error: skill "${id}" already exists. Use action "patch" to change an existing skill.`,
          }
        }
        const drafts = store.skills.filter(
          (skill) => skill.status === "draft" && skill.author === source.id,
        ).length
        if (drafts >= MAX_PENDING_DRAFTS) {
          return {
            content: `Error: you have ${MAX_PENDING_DRAFTS} draft skills awaiting review. Wait for the user to review them in Library before proposing more.`,
          }
        }
        if (await globalCollision()) {
          return {
            content: `Error: skill ID "${id}" already exists as a global skill. Choose a different ID.`,
          }
        }
        const skill: StoredSkill = {
          id,
          name,
          description,
          autoinvoke: true,
          scope: "selected",
          botIDs: [source.id],
          status: "draft",
          pinned: false,
          author: source.id,
          evidence,
          createdAt: Date.now(),
          uses: 0,
          lastUsedAt: 0,
        }
        store.skills.push(skill)
        await writeSkillDocument(skill, content)
        await save()
      } else if (existing) {
        if (existing.pinned) return pinnedError(id)
        existing.name = name
        existing.description = description
        await writeSkillDocument(existing, content)
        await save()
      } else {
        if (await globalCollision()) {
          return {
            content: `Error: skill ID "${id}" already exists as a global skill. Choose a different ID.`,
          }
        }
        const skill: StoredSkill = {
          id,
          name,
          description,
          autoinvoke: true,
          scope: "selected",
          botIDs: [source.id],
          status: "active",
          pinned: false,
          author: source.id,
          evidence: "",
          createdAt: Date.now(),
          uses: 0,
          lastUsedAt: 0,
        }
        store.skills.push(skill)
        await writeSkillDocument(skill, content)
        await save()
      }

      let fileCount = 0
      if (Array.isArray(args.files)) {
        try {
          for (const item of args.files) {
            if (!item || typeof item !== "object") continue
            const record = item as Record<string, unknown>
            const path = typeof record.path === "string" ? record.path : ""
            const value = typeof record.content === "string" ? record.content : ""
            if (!path) continue
            await writeSkillFile(id, path, value, record.encoding)
            fileCount += 1
          }
        } catch (error) {
          await registerSkills()
          await emitChanged("skills")
          return {
            content: `Skill "${id}" was saved, but a supporting file failed: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }

      await registerSkills()
      await emitChanged("skills")
      const files = fileCount ? ` Added ${fileCount} supporting file(s).` : ""
      if (action === "propose") {
        return {
          content: `Saved draft skill "${id}" for ${source.name}. It is not usable until the user approves it in Library.${files}`,
        }
      }
      if (existing) {
        return {
          content: `Updated skill "${id}" for ${source.name}. Its existing scope is unchanged.${files}`,
        }
      }
      return {
        content: `Created skill "${id}" for ${source.name}. It is scoped only to this bot and will be available in the next model step.${files}`,
      }
    }

    const manageBotMemory = async (source: StoredBot, input: unknown) => {
      const args = input as {
        action?: unknown
        id?: unknown
        title?: unknown
        content?: unknown
      }
      const action = args.action === "delete" ? "delete" : args.action === "save" ? "save" : ""

      if (action === "delete") {
        const id = typeof args.id === "string" ? args.id.trim() : ""
        if (!id) {
          return { content: "Error: id is required to delete a memory entry." }
        }
        const index = source.memory.findIndex((entry) => entry.id === id)
        if (index === -1) {
          return { content: `Error: no memory entry with id "${id}".` }
        }
        const [removed] = source.memory.splice(index, 1)
        source.updatedAt = Date.now()
        await save()
        await emitChanged(source.id)
        return { content: `Deleted memory "${removed?.title ?? id}".` }
      }

      if (action !== "save") {
        return { content: 'Error: action must be "save" or "delete".' }
      }

      const title = cleanLibraryText(args.title, MAX_MEMORY_TITLE) || "Memory"
      const content = cleanLibraryText(args.content, MAX_MEMORY_CONTENT)
      if (!content) {
        return { content: "Error: content is required to save a memory entry." }
      }

      const id = typeof args.id === "string" ? args.id.trim() : ""
      const existing = id ? source.memory.find((entry) => entry.id === id) : undefined
      if (id && !existing) {
        return {
          content: `Error: no memory entry with id "${id}". Omit id to create a new entry.`,
        }
      }
      if (!existing && source.memory.length >= MAX_MEMORY_ENTRIES) {
        return {
          content: `Error: memory is full (${MAX_MEMORY_ENTRIES} entries). Delete an entry with bots_memory first.`,
        }
      }

      const previous = existing ? existing.title.length + existing.content.length : 0
      const current = source.memory.reduce(
        (sum, entry) => sum + entry.title.length + entry.content.length,
        0,
      )
      if (current - previous + title.length + content.length > MAX_MEMORY_TOTAL) {
        return {
          content: `Error: memory would exceed ${MAX_MEMORY_TOTAL} characters. Delete or shorten entries first.`,
        }
      }

      if (existing) {
        existing.title = title
        existing.content = content
      } else {
        const entry: StoredMemory = { id: randomUUID(), title, content }
        source.memory.push(entry)
      }
      source.updatedAt = Date.now()
      await save()
      await emitChanged(source.id)

      const saved = existing ?? source.memory.at(-1)!
      return {
        content: `${existing ? "Updated" : "Saved"} memory "${saved.title}" (id ${saved.id}). It will be available in the next model step.`,
      }
    }

    const setBotRole = async (source: StoredBot, input: unknown) => {
      const role = cleanRole((input as { role?: unknown }).role).trim()
      if (!role) return { content: "Error: role is required. Pass the complete new role." }
      const previous = source.role
      source.role = role
      source.roleChangedAt = source.updatedAt = Date.now()
      await save()
      await emitChanged(source.id)
      // The previous text lets the bot undo a mistaken edit in the same session.
      return {
        content: `Updated your role. It takes effect in the next model step.\n\nPrevious role:\n${previous.trim() || "(empty)"}`,
      }
    }

    const saveBotCommand = async (source: StoredBot, input: unknown) => {
      const args = input as {
        action?: unknown
        id?: unknown
        name?: unknown
        description?: unknown
        template?: unknown
      }
      const action = args.action === "delete" ? "delete" : args.action === "save" ? "save" : ""

      if (action === "delete") {
        const id = typeof args.id === "string" ? args.id.trim() : ""
        const name = cleanCommandName(args.name)
        const command = id
          ? store.commands.find((item) => item.id === id)
          : name
            ? store.commands.find((item) => item.name === name)
            : undefined
        if (!command) {
          return {
            content: "Error: command not found. Provide the command name or id.",
          }
        }
        store.commands = store.commands.filter((item) => item.id !== command.id)
        await save()
        await registerCommands()
        await emitChanged("commands")
        return { content: `Deleted command /${command.name}.` }
      }

      if (action !== "save") {
        return { content: 'Error: action must be "save" or "delete".' }
      }

      const name = cleanCommandName(args.name)
      const template = cleanLibraryText(args.template, MAX_COMMAND_TEMPLATE)
      const description = cleanLibraryText(args.description, MAX_LIBRARY_DESCRIPTION)
      if (!name) return { content: "Error: command name is required." }
      if (!template) return { content: "Error: command template is required." }

      const id = typeof args.id === "string" ? args.id.trim() : ""
      let existing = id
        ? store.commands.find((item) => item.id === id)
        : store.commands.find((item) => item.name === name)
      if (id && !existing) {
        return { content: `Error: no command with id "${id}".` }
      }
      const conflict = store.commands.find((item) => item.name === name && item.id !== existing?.id)
      if (conflict) {
        return { content: `Error: /${name} already exists. Choose a different name.` }
      }

      const created = !existing
      if (existing) {
        existing.name = name
        existing.description = description
        existing.template = template
      } else {
        existing = {
          id: randomUUID(),
          name,
          description,
          template,
          scope: "selected",
          botIDs: [source.id],
        }
        store.commands.push(existing)
      }

      await save()
      await registerCommands()
      await emitChanged("commands")
      return {
        content: `${created ? "Created" : "Updated"} command /${name} for ${source.name}. It is scoped only to this bot and appears in its / menu.`,
      }
    }

    const createBotFromTool = async (source: StoredBot, input: unknown) => {
      if (source.id !== store.coordinatorID) {
        return {
          content: "Error: only the coordinator bot can create bots.",
        }
      }
      const args = input as {
        name?: unknown
        role?: unknown
      }
      const name = typeof args.name === "string" ? args.name.trim() : ""
      if (!name) return { content: "Error: bot name is required." }
      const role = cleanRole(args.role)
      const bot = await createBot({ name, color: randomColor(), role, memory: [] })
      return {
        content: `Created bot "${bot.name}" (@${bot.handle}) with its own persistent session.`,
      }
    }

    /** Creates or updates a task. Shared by the Settings board and bots_task; throws readable errors. */
    const saveTaskRecord = (input: TaskInput, author: string) => {
      const bot = findBot(input.botID)
      if (!bot) throw new Error("That task's bot no longer exists.")
      const title = cleanLibraryText(input.title, MAX_TASK_TITLE)
      if (!title) throw new Error("A task needs a title.")
      const existing = input.id ? store.tasks.find((task) => task.id === input.id) : undefined
      if (input.id && !existing) throw new Error(`No task with id "${input.id}".`)
      const status = cleanTaskStatus(input.status)
      if (!existing || existing.botID !== bot.id) {
        if (!existing && store.tasks.length >= MAX_TASKS) {
          throw new Error(`There are already ${MAX_TASKS} tasks. Delete finished ones first.`)
        }
        const open = store.tasks.filter((task) => task.botID === bot.id && task.status !== "done")
        if (status !== "done" && open.length >= MAX_OPEN_TASKS_PER_BOT) {
          throw new Error(`${bot.name} already has ${MAX_OPEN_TASKS_PER_BOT} open tasks.`)
        }
      }
      const now = Date.now()
      const task: StoredTask = existing ?? {
        id: shortID((id) => store.tasks.some((item) => item.id === id)),
        botID: bot.id,
        title,
        notes: "",
        status,
        wakeAt: 0,
        author,
        createdAt: now,
        updatedAt: now,
        doneAt: 0,
      }
      task.botID = bot.id
      task.title = title
      task.notes = cleanLibraryText(input.notes, MAX_TASK_NOTES)
      task.doneAt =
        status !== "done" ? 0 : task.status === "done" && task.doneAt ? task.doneAt : now
      task.status = status
      task.wakeAt = status === "done" ? 0 : cleanCount(input.wakeAt)
      task.updatedAt = now
      if (!existing) store.tasks.push(task)
      return task
    }

    /** Creates or updates a job. Shared by the Settings jobs list and bots_job; throws readable errors. */
    const saveJobRecord = (input: JobInput, author: string) => {
      const bot = findBot(input.botID)
      if (!bot) throw new Error("That job's bot no longer exists.")
      const name = cleanLibraryText(input.name, MAX_JOB_NAME)
      if (!name) throw new Error("A job needs a name.")
      const prompt = cleanLibraryText(input.prompt, MAX_JOB_PROMPT)
      if (!prompt) throw new Error("A job needs a prompt.")
      const cron = input.cron.trim().replace(/\s+/g, " ")
      const zone = input.timeZone.trim() || timeZone
      validateSchedule(cron, zone)
      const existing = input.id ? store.jobs.find((job) => job.id === input.id) : undefined
      if (input.id && !existing) throw new Error(`No job with id "${input.id}".`)
      if (!existing && store.jobs.length >= MAX_JOBS) {
        throw new Error(`There are already ${MAX_JOBS} jobs. Delete one first.`)
      }
      const now = Date.now()
      const rescheduled =
        !existing ||
        existing.cron !== cron ||
        existing.timeZone !== zone ||
        existing.enabled !== input.enabled ||
        !existing.nextRunAt
      const job: StoredJob = existing ?? {
        id: shortID((id) => store.jobs.some((item) => item.id === id)),
        botID: bot.id,
        name,
        prompt,
        cron,
        timeZone: zone,
        enabled: input.enabled,
        notify: input.notify,
        author,
        createdAt: now,
        updatedAt: now,
        nextRunAt: 0,
        lastRunAt: 0,
        runs: 0,
      }
      Object.assign(job, {
        botID: bot.id,
        name,
        prompt,
        cron,
        timeZone: zone,
        enabled: input.enabled,
        notify: input.notify,
        updatedAt: now,
      })
      if (rescheduled || !job.enabled) job.nextRunAt = jobNextRun(job, now)
      if (!existing) store.jobs.push(job)
      return job
    }

    /** Removes the bot's tasks and jobs when it is deleted. */
    const dropSchedule = (botID: string) => {
      store.tasks = store.tasks.filter((task) => task.botID !== botID)
      store.jobs = store.jobs.filter((job) => job.botID !== botID)
    }

    const jobTrigger = (job: StoredJob, dueAt: number) =>
      [
        `Scheduled job "${job.name}" · ${describeCron(job.cron)}${dueAt ? ` · was due ${formatTime(dueAt, job.timeZone)}` : ""}`,
        "",
        job.prompt,
        "",
        `(Sent automatically by job ${job.id} at ${formatTime(Date.now(), job.timeZone)}. The user did not just write this and may not be watching: do the work and reply with a short result.)`,
      ].join("\n")

    const taskTrigger = (task: StoredTask) =>
      [
        `Task reminder: "${task.title}" · ${TASK_STATUS_LABEL[task.status]}`,
        ...(task.notes ? ["", task.notes] : []),
        "",
        `(Sent automatically at ${formatTime(Date.now(), timeZone)} because task ${task.id} reached its wake time. Act on it now, then update it with bots_task: mark it done, or snooze it with a new wake time. If it needs the user, say so in your reply.)`,
      ].join("\n")

    /**
     * Wakes a bot in its own session. A synthetic message shows as a system note
     * rather than a user bubble, and it queues behind any run in progress.
     */
    const wakeBot = async (bot: StoredBot, text: string, metadata: Record<string, string>) => {
      const sessionID = await ensureSession(bot)
      await ctx.session.synthetic({
        sessionID,
        text,
        description: text.split("\n", 1)[0],
        metadata,
        delivery: "queue",
        resume: true,
      })
    }

    const runJob = async (job: StoredJob, dueAt = 0) => {
      const bot = findBot(job.botID)
      if (!bot) throw new Error("That job's bot no longer exists.")
      await wakeBot(bot, jobTrigger(job, dueAt), { botsJob: job.id })
    }

    let ticking = false
    let lastPrune = 0

    /**
     * Fires due jobs and task wake-ups. Each is recorded and saved before the
     * bot is woken, so a restart mid-tick cannot fire the same run twice. A job
     * missed while OpenCode was not running fires once, marked late.
     */
    const tick = async () => {
      if (ticking) return
      ticking = true
      try {
        await refreshStore()
        const now = Date.now()
        const due: Array<{ label: string; run: () => Promise<void> }> = []
        let changed = false

        for (const job of store.jobs) {
          if (!job.enabled) continue
          if (!job.nextRunAt) {
            job.nextRunAt = jobNextRun(job, now)
            changed ||= job.nextRunAt > 0
            continue
          }
          if (job.nextRunAt > now) continue
          const dueAt = now - job.nextRunAt > LATE_RUN_MS ? job.nextRunAt : 0
          job.lastRunAt = now
          job.runs += 1
          job.nextRunAt = jobNextRun(job, now)
          changed = true
          const snapshot = { ...job }
          due.push({ label: `job ${job.id}`, run: () => runJob(snapshot, dueAt) })
        }

        for (const task of store.tasks) {
          if (task.status === "done" || !task.wakeAt || task.wakeAt > now) continue
          const bot = findBot(task.botID)
          if (!bot) continue
          const text = taskTrigger(task)
          task.wakeAt = 0
          task.updatedAt = now
          changed = true
          due.push({
            label: `task ${task.id}`,
            run: () => wakeBot(bot, text, { botsTask: task.id }),
          })
        }

        if (now - lastPrune > PRUNE_MS) {
          lastPrune = now
          const before = store.tasks.length
          store.tasks = store.tasks.filter(
            (task) => task.status !== "done" || now - task.doneAt < DONE_TASK_TTL_MS,
          )
          changed ||= store.tasks.length !== before
        }

        if (!changed) return
        await save()
        await emitChanged("schedule")
        for (const item of due) {
          try {
            await item.run()
          } catch (error) {
            console.error(`[opencode-bots] could not run ${item.label}`, error)
          }
        }
      } catch (error) {
        console.error("[opencode-bots] schedule tick failed", error)
      } finally {
        ticking = false
      }
    }

    /** Resolves the bot a task or job tool call acts on, enforcing coordinator-only delegation. */
    const ownerFor = (source: StoredBot, handle: unknown, current?: string) => {
      if (typeof handle !== "string" || !handle.trim()) {
        return { bot: current ? findBot(current) : source }
      }
      const bot = findBotByHandle(handle)
      if (!bot) {
        const handles = store.bots.map((item) => `@${item.handle}`).join(", ")
        return { error: `Error: no bot has the handle ${handle}. Available bots: ${handles}.` }
      }
      if (bot.id !== source.id && source.id !== store.coordinatorID) {
        return { error: "Error: only the coordinator can manage another bot's tasks and jobs." }
      }
      return { bot }
    }

    const canManage = (source: StoredBot, botID: string) =>
      botID === source.id || source.id === store.coordinatorID

    const handleOf = (botID: string) => `@${findBot(botID)?.handle ?? "unknown"}`

    const nowLine = () => `Current time: ${formatTime(Date.now(), timeZone)} (${timeZone}).`

    const describeTask = (task: StoredTask) =>
      `[${task.id}] ${handleOf(task.botID)} · ${TASK_STATUS_LABEL[task.status]}: ${task.title}${task.wakeAt ? ` (wakes ${formatTime(task.wakeAt, timeZone)})` : ""}`

    const describeJob = (job: StoredJob) =>
      `[${job.id}] ${handleOf(job.botID)} · ${job.name}: ${describeCron(job.cron)} (${job.timeZone})${!job.enabled ? ", paused" : job.nextRunAt ? `, next ${formatTime(job.nextRunAt, job.timeZone)}` : ", never runs again"}`

    const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

    const errorText = (error: unknown) => `Error: ${messageOf(error)}`

    const manageTasks = async (source: StoredBot, input: unknown) => {
      const args = input as {
        action?: unknown
        id?: unknown
        bot?: unknown
        title?: unknown
        notes?: unknown
        status?: unknown
        wake?: unknown
      }
      const action =
        args.action === "list" || args.action === "delete" || args.action === "save"
          ? args.action
          : ""
      if (!action) return { content: 'Error: action must be "list", "save", or "delete".' }
      const coordinator = source.id === store.coordinatorID

      if (action === "list") {
        const all = coordinator && args.bot === "all"
        const owner = all ? undefined : ownerFor(source, args.bot)
        if (owner && "error" in owner) return { content: owner.error }
        const tasks = store.tasks
          .filter((task) => all || task.botID === owner?.bot?.id)
          .sort(taskOrder)
        const open = tasks.filter((task) => task.status !== "done")
        const done = tasks
          .filter((task) => task.status === "done")
          .sort((a, b) => b.doneAt - a.doneAt)
          .slice(0, 10)
        return {
          content: [
            nowLine(),
            "",
            "Open tasks:",
            ...(open.length ? open.map((task) => `- ${describeTask(task)}`) : ["- None."]),
            "",
            "Recently done:",
            ...(done.length ? done.map((task) => `- ${describeTask(task)}`) : ["- None."]),
          ].join("\n"),
        }
      }

      const id = typeof args.id === "string" ? args.id.trim() : ""
      const existing = id ? store.tasks.find((task) => task.id === id) : undefined
      if (id && !existing) return { content: `Error: no task with id "${id}".` }
      if (existing && !canManage(source, existing.botID)) {
        return { content: "Error: only the coordinator can manage another bot's tasks." }
      }

      if (action === "delete") {
        if (!existing) return { content: "Error: id is required to delete a task." }
        store.tasks = store.tasks.filter((task) => task.id !== existing.id)
        await save()
        await emitChanged("schedule")
        return { content: `Deleted task [${existing.id}] "${existing.title}".` }
      }

      const owner = ownerFor(source, args.bot, existing?.botID)
      if ("error" in owner) return { content: owner.error }
      if (!owner.bot) return { content: "Error: that task's bot no longer exists." }
      const now = Date.now()
      let wakeAt = existing?.wakeAt ?? 0
      if (typeof args.wake === "string") {
        if (!args.wake.trim()) {
          wakeAt = 0
        } else {
          try {
            wakeAt = parseWakeTime(args.wake, now, timeZone)
          } catch (error) {
            return { content: errorText(error) }
          }
          if (wakeAt < now - 60_000) {
            return {
              content: `Error: ${formatTime(wakeAt, timeZone)} is in the past. ${nowLine()}`,
            }
          }
        }
      }
      try {
        const task = saveTaskRecord(
          {
            id: existing?.id,
            botID: owner.bot.id,
            title: typeof args.title === "string" ? args.title : (existing?.title ?? ""),
            notes: typeof args.notes === "string" ? args.notes : (existing?.notes ?? ""),
            status:
              typeof args.status === "string"
                ? cleanTaskStatus(args.status)
                : (existing?.status ?? "todo"),
            wakeAt,
          },
          source.id,
        )
        await save()
        await emitChanged("schedule")
        return {
          content: `${existing ? "Updated" : "Created"} task ${describeTask(task)}.${task.wakeAt ? "" : " No wake time."} ${nowLine()}`,
        }
      } catch (error) {
        return { content: errorText(error) }
      }
    }

    const manageJobs = async (source: StoredBot, input: unknown) => {
      const args = input as {
        action?: unknown
        id?: unknown
        bot?: unknown
        name?: unknown
        prompt?: unknown
        cron?: unknown
        timezone?: unknown
        enabled?: unknown
        notify?: unknown
      }
      const action =
        args.action === "list" ||
        args.action === "save" ||
        args.action === "delete" ||
        args.action === "run"
          ? args.action
          : ""
      if (!action) return { content: 'Error: action must be "list", "save", "delete", or "run".' }
      const coordinator = source.id === store.coordinatorID

      if (action === "list") {
        const all = coordinator && args.bot === "all"
        const owner = all ? undefined : ownerFor(source, args.bot)
        if (owner && "error" in owner) return { content: owner.error }
        const jobs = store.jobs.filter((job) => all || job.botID === owner?.bot?.id)
        return {
          content: [
            nowLine(),
            "",
            "Scheduled jobs:",
            ...(jobs.length
              ? jobs.map((job) => `- ${describeJob(job)}\n  Prompt: ${oneLine(job.prompt, 300)}`)
              : ["- None."]),
          ].join("\n"),
        }
      }

      const id = typeof args.id === "string" ? args.id.trim() : ""
      const existing = id ? store.jobs.find((job) => job.id === id) : undefined
      if (id && !existing) return { content: `Error: no job with id "${id}".` }
      if (existing && !canManage(source, existing.botID)) {
        return { content: "Error: only the coordinator can manage another bot's jobs." }
      }

      if (action === "delete" || action === "run") {
        if (!existing) return { content: `Error: id is required to ${action} a job.` }
        if (action === "delete") {
          store.jobs = store.jobs.filter((job) => job.id !== existing.id)
          await save()
          await emitChanged("schedule")
          return { content: `Deleted job [${existing.id}] "${existing.name}".` }
        }
        existing.lastRunAt = Date.now()
        existing.runs += 1
        await save()
        await emitChanged("schedule")
        // Queued: it runs in the job's bot session after the current reply.
        void runJob({ ...existing }).catch((error) =>
          console.error(`[opencode-bots] could not run job ${existing.id}`, error),
        )
        return {
          content: `Queued a run of [${existing.id}] "${existing.name}" in ${handleOf(existing.botID)}'s conversation. It starts after the current reply.`,
        }
      }

      const owner = ownerFor(source, args.bot, existing?.botID)
      if ("error" in owner) return { content: owner.error }
      if (!owner.bot) return { content: "Error: that job's bot no longer exists." }
      try {
        const job = saveJobRecord(
          {
            id: existing?.id,
            botID: owner.bot.id,
            name: typeof args.name === "string" ? args.name : (existing?.name ?? ""),
            prompt: typeof args.prompt === "string" ? args.prompt : (existing?.prompt ?? ""),
            cron: typeof args.cron === "string" ? args.cron : (existing?.cron ?? ""),
            timeZone:
              typeof args.timezone === "string" ? args.timezone : (existing?.timeZone ?? timeZone),
            enabled: typeof args.enabled === "boolean" ? args.enabled : (existing?.enabled ?? true),
            notify: typeof args.notify === "boolean" ? args.notify : (existing?.notify ?? true),
          },
          source.id,
        )
        await save()
        await emitChanged("schedule")
        return { content: `${existing ? "Updated" : "Created"} job ${describeJob(job)}.` }
      } catch (error) {
        return { content: errorText(error) }
      }
    }

    type SessionInfo = Awaited<ReturnType<typeof ctx.session.get>>

    /** Waits for a session to finish, up to TARGET_TIMEOUT_MS or until the tool call is cancelled. */
    const waitForSession = async (sessionID: string, signal: AbortSignal) => {
      const stop = AbortSignal.any([signal, AbortSignal.timeout(TARGET_TIMEOUT_MS)])
      return Promise.race([
        ctx.session.wait({ sessionID }).then(
          () => "done" as const,
          () => "error" as const,
        ),
        new Promise<"stopped">((resolve) =>
          stop.addEventListener("abort", () => resolve("stopped"), { once: true }),
        ),
      ])
    }

    const workerLabel = (worker: StoredWorker) =>
      worker.title || basename(worker.directory) || worker.directory

    const describeWorker = (worker: StoredWorker, withOwner: boolean) =>
      `[${worker.id}] ${withOwner ? `${handleOf(worker.botID)} · ` : ""}${workerLabel(worker)} — ${worker.directory}`

    /** A running session started an execution after the previous one ended. */
    const isBusy = (session: SessionInfo) => (session.time.busy ?? 0) > (session.time.idle ?? 0)

    /** Resolves and checks a new worker's project directory; throws readable errors. */
    const workerDirectory = async (value: unknown) => {
      const text = typeof value === "string" ? value.trim() : ""
      if (!text) throw new Error("directory is required to create a worker.")
      if (text !== "~" && !text.startsWith("~/") && !isAbsolute(text)) {
        throw new Error(`"${text}" is not an absolute path. Pass an absolute path or one under ~/.`)
      }
      const directory =
        text === "~"
          ? homedir()
          : resolve(text.startsWith("~/") ? join(homedir(), text.slice(2)) : text)
      const info = await stat(directory).catch(() => null)
      if (!info) throw new Error(`${directory} does not exist.`)
      if (!info.isDirectory()) throw new Error(`${directory} is not a directory.`)
      // The bot workspace would load the bot plugin's hooks, so it is no project.
      const root = resolve(workspace)
      if (directory === root || directory.startsWith(`${root}/`)) {
        throw new Error("Workers run in project directories, not in the bot workspace.")
      }
      return directory
    }

    const missingWorker = (worker: StoredWorker) =>
      `Error: worker [${worker.id}]'s session no longer exists; it may have been deleted in Desktop. Remove the record with action "delete".`

    /** Queues a message in the worker's session and, when asked, waits for its reply. */
    const promptWorker = async (
      worker: StoredWorker,
      message: string,
      wait: boolean,
      signal: AbortSignal,
    ) => {
      let since: number
      try {
        const inbox = await ctx.session.prompt({
          sessionID: worker.sessionID,
          text: message,
          metadata: { botsWorker: worker.id },
          delivery: "queue",
        })
        since = inbox.time.created
      } catch (error) {
        return isMissing(error) ? missingWorker(worker) : errorText(error)
      }
      worker.updatedAt = Date.now()
      await save()
      await emitChanged("workers")
      if (!wait) {
        return `Sent to worker [${worker.id}]. It works on its own; check back with action "read" or "status".`
      }
      const outcome = await waitForSession(worker.sessionID, signal)
      if (signal.aborted) return `Cancelled the wait. Worker [${worker.id}] keeps running.`
      if (outcome === "stopped") {
        return `Worker [${worker.id}] is still working. Check back later with action "read" or "status".`
      }
      if (outcome === "error") {
        return `Worker [${worker.id}] could not finish. Check it with action "status", or ask the user to open its session in Desktop.`
      }
      const reply = replyText(await ctx.session.context({ sessionID: worker.sessionID }), since)
      return reply
        ? `Worker [${worker.id}] replied:\n\n${clip(reply)}`
        : `Worker [${worker.id}] finished without a text reply.`
    }

    const clip = (text: string) =>
      text.length > MAX_WORKER_READ
        ? `${text.slice(0, MAX_WORKER_READ)}\n\n…(${text.length - MAX_WORKER_READ} more characters; the full text is in the session in Desktop)`
        : text

    const manageWorkers = async (source: StoredBot, input: unknown, signal: AbortSignal) => {
      const args = input as {
        action?: unknown
        id?: unknown
        directory?: unknown
        title?: unknown
        agent?: unknown
        message?: unknown
        wait?: unknown
      }
      const actions = ["create", "send", "read", "status", "interrupt", "delete", "list"] as const
      const action = actions.find((item) => item === args.action)
      if (!action) {
        return {
          content: `Error: action must be one of ${actions.map((item) => `"${item}"`).join(", ")}.`,
        }
      }
      const coordinator = source.id === store.coordinatorID
      const message = typeof args.message === "string" ? args.message.trim() : ""
      if (message.length > MAX_WORKER_MESSAGE) {
        return { content: `Error: message is longer than ${MAX_WORKER_MESSAGE} characters.` }
      }
      const wait = args.wait !== false

      if (action === "list") {
        const workers = store.workers.filter((worker) => coordinator || worker.botID === source.id)
        return {
          content: [
            coordinator ? "Workers (all bots):" : "Your workers:",
            ...(workers.length
              ? workers.map((worker) => `- ${describeWorker(worker, coordinator)}`)
              : ["- None."]),
          ].join("\n"),
        }
      }

      if (action === "create") {
        if (store.workers.length >= MAX_WORKERS) {
          return { content: `Error: there are already ${MAX_WORKERS} workers. Delete one first.` }
        }
        if (
          store.workers.filter((worker) => worker.botID === source.id).length >= MAX_WORKERS_PER_BOT
        ) {
          return {
            content: `Error: you already have ${MAX_WORKERS_PER_BOT} workers. Delete one you no longer need first.`,
          }
        }
        let directory: string
        try {
          directory = await workerDirectory(args.directory)
        } catch (error) {
          return { content: errorText(error) }
        }
        const title = cleanLibraryText(args.title, MAX_WORKER_TITLE)
        const agent = typeof args.agent === "string" ? args.agent.trim() : ""
        // No parentID, model, or permissions: the session takes the project's own.
        let session: SessionInfo
        try {
          session = await ctx.session.create({
            ...(title ? { title } : {}),
            location: { directory },
            ...(agent ? { agent } : {}),
          })
        } catch (error) {
          return { content: errorText(error) }
        }
        const now = Date.now()
        const worker: StoredWorker = {
          id: shortID((id) => store.workers.some((item) => item.id === id)),
          botID: source.id,
          sessionID: session.id,
          directory,
          title,
          createdAt: now,
          updatedAt: now,
        }
        store.workers.push(worker)
        await save()
        await emitChanged("workers")
        const created = `Created worker [${worker.id}] in ${directory}${agent ? ` with agent ${agent}` : ""}. It is a top-level OpenCode session the user can open in Desktop under that project.`
        if (!message) return { content: `${created} Give it work with action "send".` }
        return { content: `${created}\n\n${await promptWorker(worker, message, wait, signal)}` }
      }

      const id = typeof args.id === "string" ? args.id.trim() : ""
      if (!id) return { content: `Error: id is required to ${action} a worker.` }
      const worker = store.workers.find((item) => item.id === id)
      if (!worker) {
        return { content: `Error: no worker with id "${id}". Use action "list" to see workers.` }
      }
      if (!canManage(source, worker.botID)) {
        return { content: "Error: only the coordinator can manage another bot's workers." }
      }

      if (action === "send") {
        if (!message) return { content: "Error: message is required to send to a worker." }
        return { content: await promptWorker(worker, message, wait, signal) }
      }

      if (action === "delete") {
        try {
          await removeSession(worker.sessionID, `worker ${worker.id}`)
        } catch (error) {
          return { content: errorText(error) }
        }
        store.workers = store.workers.filter((item) => item.id !== worker.id)
        await save()
        await emitChanged("workers")
        return { content: `Deleted worker [${worker.id}] and its session.` }
      }

      if (action === "interrupt") {
        try {
          await ctx.session.interrupt({ sessionID: worker.sessionID, resume: false })
        } catch (error) {
          return { content: isMissing(error) ? missingWorker(worker) : errorText(error) }
        }
        return { content: `Interrupted worker [${worker.id}].` }
      }

      let session: SessionInfo
      try {
        session = await ctx.session.get({ sessionID: worker.sessionID })
      } catch (error) {
        return { content: isMissing(error) ? missingWorker(worker) : errorText(error) }
      }
      const busy = isBusy(session)

      if (action === "read") {
        const reply = replyText(await ctx.session.context({ sessionID: worker.sessionID }), 0)
        const note = busy
          ? `Worker [${worker.id}] is still working; this is its latest reply so far.`
          : ""
        if (!reply) {
          return { content: note || `Worker [${worker.id}] has no text reply yet.` }
        }
        return {
          content: [note, `Worker [${worker.id}]'s latest reply:`, "", clip(reply)]
            .filter((line, index) => index > 0 || line)
            .join("\n"),
        }
      }

      const model = session.model
      return {
        content: [
          describeWorker(worker, coordinator),
          `Owner: ${handleOf(worker.botID)}`,
          `Session title: ${session.title || "(untitled)"}`,
          `Session location: ${session.location.directory}`,
          `Agent: ${session.agent ?? "project default"}`,
          `Model: ${model ? `${model.providerID}/${model.id}${model.variant ? ` (${model.variant})` : ""}` : "project default"}`,
          `State: ${busy ? "working" : `idle${session.outcome ? `, last run ${session.outcome}` : ""}`}`,
        ].join("\n"),
      }
    }

    const toolTransform = await ctx.tool.transform((editor) => {
      editor.namespace({ name: "bots", description: "Bot messaging and bot library tools" })
      editor.add({
        name: "send",
        options: { namespace: "bots" },
        description:
          "Send a message to another bot and wait for its reply. Use this only when the user's current message mentions another bot with @handle.",
        input: {
          type: "object",
          properties: {
            target: { type: "string", description: "The target bot handle, without @" },
            message: { type: "string", description: "The message to send" },
          },
          required: ["target", "message"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          await refreshStore()
          const args = input as { target?: unknown; message?: unknown }
          const targetHandle =
            typeof args.target === "string"
              ? args.target.trim().replace(/^@+/, "").toLowerCase()
              : ""
          const message = typeof args.message === "string" ? args.message.trim() : ""
          if (!targetHandle) return { content: "Error: target bot handle is required." }
          if (!message) return { content: "Error: message is required." }

          const { group, source } = sourceFor(context.sessionID)
          if (!source)
            return { content: "Error: bots_send is only available in a bot or group session." }

          const target = store.bots.find((bot) => bot.handle === targetHandle)
          if (!target) {
            const handles = store.bots.map((bot) => `@${bot.handle}`).join(", ")
            return {
              content: `Error: no bot has the handle @${targetHandle}. Available bots: ${handles || "none"}.`,
            }
          }
          if (target.id === source.id)
            return { content: "Error: a bot cannot send a message to itself." }
          if (group && !group.memberIDs.includes(target.id)) {
            return { content: `Error: @${target.handle} is not a member of ${group.name}.` }
          }

          // A scheduled job or task reminder routes like the user's own message.
          const messages = await ctx.session.context({ sessionID: context.sessionID })
          const trigger = triggerOf(messages)
          if (!trigger) return { content: "Error: no user message to route." }
          if (
            trigger.type === "user" &&
            trigger.metadata &&
            typeof trigger.metadata === "object" &&
            "fromBot" in trigger.metadata
          ) {
            return {
              content:
                "Error: bot-to-bot calls are disabled. Only the user's own message can mention another bot.",
            }
          }

          const escaped = target.handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          const mention = new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[.,!?;:])`, "i")
          if (!mention.test(trigger.text)) {
            return {
              content: `Error: the ${trigger.type === "user" ? "user's current message" : "scheduled message"} does not mention @${target.handle}, so it cannot be contacted.`,
            }
          }

          if (context.signal.aborted) return { content: "Cancelled." }

          await ensureSession(target)
          await context.progress({ status: "waiting", target: target.handle })

          const inbox = await ctx.session.prompt({
            sessionID: target.sessionID,
            text: `[From @${source.handle}] ${message}`,
            metadata: {
              fromBot: source.id,
              targetBot: target.id,
              ...(group ? { fromGroup: group.id, groupName: group.name } : {}),
            },
            delivery: "queue",
          })

          const outcome = await waitForSession(target.sessionID, context.signal)

          if (context.signal.aborted) return { content: "Cancelled." }
          if (outcome === "stopped") {
            return {
              content: `@${target.handle} is still working. Check its session for the reply.`,
            }
          }
          if (outcome === "error") {
            return {
              content: `@${target.handle} could not finish its reply. Check its session for details.`,
            }
          }

          const reply = replyText(
            await ctx.session.context({ sessionID: target.sessionID }),
            inbox.time.created,
          )

          return {
            content: reply
              ? `@${target.handle} replied:\n\n${reply}`
              : `@${target.handle} finished without a text reply.`,
          }
        },
      })

      editor.add({
        name: "skill",
        options: { namespace: "bots" },
        description:
          "Create, update, propose, or delete a reusable bot-library skill, and manage its supporting files. A skill is a directory with SKILL.md plus optional references, scripts, and assets; paths inside the skill are relative to that directory. New skills are scoped only to you; existing skills keep their current scope, which may be shared. Changing a shared skill affects every bot using it, and deleting a shared skill removes it for everyone. propose: your own initiative after something outside you confirmed the approach worked; it saves a draft the user must approve in Library. patch: a minimal change to an existing skill's instructions, preferred over rewriting. save: only when the user explicitly asks you to create or change a skill. Use the native skill tool to load a skill, not this tool.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["save", "propose", "patch", "delete", "write-file", "delete-file"],
              description:
                "save to create or fully update a skill when the user asks; propose to draft a skill you learned; patch to change part of an existing skill's instructions; delete to remove a skill; write-file to add or replace a supporting file; delete-file to remove one.",
            },
            id: {
              type: "string",
              description:
                "Existing skill ID. Pass it to update, patch, delete, or manage the files of a specific skill, including a shared one. Derived from the name when omitted on save or propose.",
            },
            name: { type: "string", description: "Short display name for the skill." },
            description: {
              type: "string",
              description: "When the skill should be used, written for discovery.",
            },
            evidence: {
              type: "string",
              description:
                'For propose: what externally confirmed the approach worked, such as "tests passed" or the user confirming the deploy worked.',
            },
            old: {
              type: "string",
              description:
                "For patch: the exact text to replace. It must occur exactly once in the current instructions.",
            },
            new: {
              type: "string",
              description:
                "For patch: the replacement text for old. Use an empty string to delete it.",
            },
            content: {
              type: "string",
              description:
                "Complete instructions for the skill when saving, or the file's contents when writing a file.",
            },
            files: {
              type: "array",
              description:
                "Supporting files to write with a save. Paths are relative to the skill directory, such as references/policy.md or scripts/check.sh.",
              items: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  content: { type: "string" },
                  encoding: { type: "string", enum: ["utf8", "base64"] },
                },
                required: ["path", "content"],
                additionalProperties: false,
              },
            },
            path: {
              type: "string",
              description:
                "Supporting file path relative to the skill directory, for write-file or delete-file.",
            },
            encoding: {
              type: "string",
              enum: ["utf8", "base64"],
              description: "How file content is encoded. Defaults to utf8.",
            },
          },
          required: [],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          await refreshStore()
          const { source } = sourceFor(context.sessionID)
          if (!source)
            return { content: "Error: bots_skill is only available in a bot or group session." }
          return saveBotSkill(source, input)
        },
      })

      editor.add({
        name: "memory",
        options: { namespace: "bots" },
        description:
          "Save, update, or delete a memory entry for yourself. Save only facts and durable preferences the user actually stated; never save your own guesses, inferences about the user, or lessons you judged yourself. Keep entries short and update an existing entry instead of adding a near-duplicate. Memory is private to this bot.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["save", "delete"],
              description: "save to add or update an entry; delete to forget one.",
            },
            id: {
              type: "string",
              description:
                "Existing memory ID from your Memory instructions. Omit when saving a new entry.",
            },
            title: {
              type: "string",
              description: "Short label for the memory (save only).",
            },
            content: {
              type: "string",
              description: "What to remember (save only).",
            },
          },
          required: ["action"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          await refreshStore()
          const { source } = sourceFor(context.sessionID)
          if (!source)
            return { content: "Error: bots_memory is only available in a bot or group session." }
          return manageBotMemory(source, input)
        },
      })

      editor.add({
        name: "role",
        options: { namespace: "bots" },
        description:
          'Replace your own role: the standing instructions that define who you are and how you behave. Use this only when the user asks you to change your role, personality, focus, or standing instructions; never on your own initiative. Pass the complete new role body, not a diff; start from your current role and keep what should stay. Do not include your identity line or a "Role" heading; they are added automatically. Use memory for facts, not this tool.',
        input: {
          type: "object",
          properties: {
            role: { type: "string", description: "The complete new role text." },
          },
          required: ["role"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          await refreshStore()
          const { source } = sourceFor(context.sessionID)
          if (!source)
            return { content: "Error: bots_role is only available in a bot or group session." }
          return setBotRole(source, input)
        },
      })

      editor.add({
        name: "command",
        options: { namespace: "bots" },
        description:
          "Create, update, or delete a slash command in the bot library. New commands are scoped only to you; existing commands keep their current scope, which may be shared. Changing a shared command affects every bot using it, and deleting a shared command removes it for everyone. The command appears in the relevant chat's / menu.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["save", "delete"],
              description: "save to add or update a command; delete to remove one.",
            },
            name: {
              type: "string",
              description: "Command name without the leading slash.",
            },
            description: {
              type: "string",
              description: "Short description shown in the / menu (save only).",
            },
            template: {
              type: "string",
              description: "Prompt template. Supports $ARGUMENTS and $1…$9 (save only).",
            },
            id: {
              type: "string",
              description: "Existing command id. Optional; the name is usually enough.",
            },
          },
          required: [],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          await refreshStore()
          const { source } = sourceFor(context.sessionID)
          if (!source)
            return { content: "Error: bots_command is only available in a bot or group session." }
          return saveBotCommand(source, input)
        },
      })

      editor.add({
        name: "task",
        options: { namespace: "bots" },
        description:
          "Keep your task board: list, create, update, or delete tasks (To do, In progress, Done). A task can have a wake time: when it arrives, you receive a task reminder in your conversation, so you can follow up without being asked. Snooze a task by giving it a new wake time. Only the coordinator can manage other bots' tasks, by passing bot.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["list", "save", "delete"],
              description:
                "list to see tasks; save to create (no id) or update (with id) a task; delete to remove one.",
            },
            id: { type: "string", description: "Existing task id, to update or delete it." },
            bot: {
              type: "string",
              description:
                'Coordinator only: the handle of the bot that owns the task. Defaults to you. For list, "all" shows every bot\'s tasks.',
            },
            title: { type: "string", description: "Short task title." },
            notes: {
              type: "string",
              description: "Details, context, or progress notes. Replaces the current notes.",
            },
            status: {
              type: "string",
              enum: ["todo", "doing", "done"],
              description: "To do, in progress, or done. New tasks default to todo.",
            },
            wake: {
              type: "string",
              description:
                'When to remind the task\'s bot: a duration from now ("45m", "2h", "3d", "1w"), a local time ("2026-11-09 09:00"; a bare date means 09:00), or an ISO timestamp with an offset. An empty string clears it. Omit to keep the current wake time.',
            },
          },
          required: ["action"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          await refreshStore()
          const { source } = sourceFor(context.sessionID)
          if (!source)
            return { content: "Error: bots_task is only available in a bot or group session." }
          return manageTasks(source, input)
        },
      })

      editor.add({
        name: "job",
        options: { namespace: "bots" },
        description:
          "Manage scheduled jobs: prompts that run automatically on a cron schedule in a bot's own conversation. Use this only when the user asks for something to happen repeatedly. Each run posts the job's prompt as an automatic message, and the bot replies to it. Jobs can run at most every 5 minutes. Only the coordinator can manage other bots' jobs, by passing bot.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["list", "save", "delete", "run"],
              description:
                "list to see jobs; save to create (no id) or update (with id) a job; delete to remove one; run to queue a run now.",
            },
            id: { type: "string", description: "Existing job id, to update, delete, or run it." },
            bot: {
              type: "string",
              description:
                'Coordinator only: the handle of the bot that runs the job. Defaults to you. For list, "all" shows every bot\'s jobs.',
            },
            name: { type: "string", description: "Short job name, such as Morning briefing." },
            prompt: {
              type: "string",
              description:
                "The instructions sent to the bot on every run. Write them so they make sense on their own.",
            },
            cron: {
              type: "string",
              description:
                'Five-field cron expression (minute hour day-of-month month day-of-week), such as "0 9 * * 1-5" for weekdays at 09:00, or a macro such as "@daily".',
            },
            timezone: {
              type: "string",
              description: "IANA time zone for the schedule. Defaults to the machine's time zone.",
            },
            enabled: { type: "boolean", description: "false pauses the job. Defaults to true." },
            notify: {
              type: "boolean",
              description:
                "Send the user a push notification when a run finishes. Defaults to true.",
            },
          },
          required: ["action"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          await refreshStore()
          const { source } = sourceFor(context.sessionID)
          if (!source)
            return { content: "Error: bots_job is only available in a bot or group session." }
          return manageJobs(source, input)
        },
      })

      editor.add({
        name: "worker",
        options: { namespace: "bots" },
        description:
          "Open and manage project workers: independent, classic OpenCode sessions in a project directory. A worker is a real top-level session, not a subagent; the user sees it under that project in Desktop and can open and continue it. It gets that project's own agents, skills, instructions (AGENTS.md), MCP servers, permissions, and default model, and none of your role, memory, library skills, or bot tools, so write messages that stand on their own. create opens one (optionally with a first message); send continues it; read returns its latest reply; status shows its state; interrupt stops its current run; delete removes the session and its history, only when the user asks; list shows workers. Only the coordinator can manage other bots' workers.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["create", "send", "read", "status", "interrupt", "delete", "list"],
              description:
                "create a worker; send it a message; read its latest reply; status of its session; interrupt its current run; delete it and its session; list workers.",
            },
            id: {
              type: "string",
              description: "Worker id, for every action except create and list.",
            },
            directory: {
              type: "string",
              description: "For create: the project directory, absolute or starting with ~/.",
            },
            title: {
              type: "string",
              description: "For create: optional session title. Omit to let OpenCode title it.",
            },
            agent: {
              type: "string",
              description:
                "For create: optional agent ID defined in that project. Omit to use the project's default agent.",
            },
            message: {
              type: "string",
              description:
                "For create: an optional first message. For send: the message. The worker knows nothing about you or this conversation.",
            },
            wait: {
              type: "boolean",
              description:
                "With a message: wait up to 2 minutes for the reply. Defaults to true; pass false for long work and check back with read or status.",
            },
          },
          required: ["action"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          await refreshStore()
          const { source } = sourceFor(context.sessionID)
          if (!source)
            return { content: "Error: bots_worker is only available in a bot or group session." }
          return manageWorkers(source, input, context.signal)
        },
      })

      editor.add({
        name: "create",
        options: { namespace: "bots" },
        description:
          "Create a new bot with its own persistent session. Only the coordinator bot can use this.",
        input: {
          type: "object",
          properties: {
            name: { type: "string", description: "Display name for the new bot." },
            role: {
              type: "string",
              description:
                'Optional role body: who the bot is, what it owns, and how it works. Its name, @handle, and the "Role" heading are added automatically, so do not include an identity preamble or a full system prompt.',
            },
          },
          required: ["name"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          await refreshStore()
          const { source } = sourceFor(context.sessionID)
          if (!source)
            return { content: "Error: bots_create is only available in a bot or group session." }
          return createBotFromTool(source, input)
        },
      })
    })

    // The bots_* tools check their session themselves. This guard covers the
    // native skill tool, which would otherwise load any bot-library skill, and
    // notifies when a bot's native question tool starts waiting for the user.
    const toolGuard = await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool.toLowerCase() === "question") {
        // The run blocks until someone answers, so the finished notification never comes.
        await refreshStore()
        const { bot, group } = sourceFor(event.sessionID)
        if (!bot && !group) return
        const questions = (event.input as { questions?: unknown } | undefined)?.questions
        const first = Array.isArray(questions)
          ? (questions[0] as { question?: unknown } | undefined)?.question
          : undefined
        const text = typeof first === "string" ? first.replace(/\s+/g, " ").trim() : ""
        void sendPush({
          title: `${bot?.name ?? group?.name} has a question`,
          body: !text
            ? "Waiting for your answer."
            : text.length > 160
              ? `${text.slice(0, 157)}…`
              : text,
          url: bot
            ? `/?bot=${encodeURIComponent(bot.id)}`
            : `/?group=${encodeURIComponent(group!.id)}`,
          tag: `opencode-bots:${event.sessionID}:question`,
        })
        return
      }
      if (event.tool.toLowerCase() !== "skill") return
      const id = (event.input as { id?: unknown } | undefined)?.id
      await refreshStore()
      const skill = store.skills.find((item) => item.id === id)
      if (!skill) return
      const { source } = sourceFor(event.sessionID)
      if (!source || !appliesTo(skill, source.id)) {
        throw new Error("This skill is only available to its assigned bot sessions")
      }
      if (skill.status !== "active") {
        throw new Error(
          `Skill "${skill.id}" is not active. It must be approved in the Library first`,
        )
      }
      await recordSkillUses([skill])
    })

    if (freshInstall) {
      freshInstall = false
      const lockPath = join(dataDir, "bots.json.init")
      let lock: Awaited<ReturnType<typeof open>> | undefined
      try {
        await mkdir(dataDir, { recursive: true })
        lock = await open(lockPath, "wx")
      } catch {
        // Recover from a lock left behind by an interrupted run.
        const info = await stat(lockPath).catch(() => null)
        if (info && Date.now() - info.mtimeMs > 60_000) {
          await rm(lockPath, { force: true })
          lock = await open(lockPath, "wx").catch(() => undefined)
        }
      }
      if (lock) {
        try {
          const chief = await createBot({
            name: "Chief",
            color: randomColor(),
            role: "You are Chief, the coordinator of this workspace. You can create new bots with the bots_create tool, you keep the team's task board with bots_task, and you help the user organise, delegate, and follow up on work across bots.",
            memory: [],
          })
          store.coordinatorID = chief.id
          await save()
          console.log("[opencode-bots] created the initial coordinator bot", chief.handle)
        } catch (error) {
          console.error("[opencode-bots] could not create the initial bot", error)
        } finally {
          await lock.close()
          await rm(lockPath, { force: true })
        }
      } else {
        // Another instance is creating the initial bot. Wait for its store, then
        // reload so this instance also sees Chief.
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 150))
          const info = await stat(storePath).catch(() => null)
          if (!info) continue
          await refreshStore()
          break
        }
      }
    }

    const rpc = await ctx.rpc.register(BotsRpc, {
      list: async () => {
        await refreshStore()
        return toState()
      },
      create: async (input) => {
        await refreshStore()
        return toView(await createBot(input as BotInput))
      },
      update: async (input) => {
        await refreshStore()
        const data = input as { id: string; patch: BotPatch }
        const bot = findBot(data.id)
        if (!bot) throw new Error("Bot not found")
        const previousName = bot.name
        applyPatch(bot, data.patch ?? {})
        await save()

        if (bot.sessionID && bot.name !== previousName) {
          await ctx.session.update({ sessionID: bot.sessionID, title: bot.name })
        }

        await emitChanged(bot.id)
        return toView(bot)
      },
      remove: async (input) => {
        await refreshStore()
        const data = input as { id: string }
        const bot = findBot(data.id)
        if (!bot) throw new Error("Bot not found")

        const hosted = store.groups.filter((group) => group.hostID === bot.id)
        if (hosted.length > 0) {
          throw new Error(
            `${bot.name} hosts ${hosted.map((group) => group.name).join(", ")}. Change the group host before deleting this bot.`,
          )
        }

        // Remove the OpenCode session first, exactly like deleting it in Desktop.
        // If that fails, keep the bot so no orphan session is left behind.
        await removeSession(bot.sessionID, bot.name)

        store.bots = store.bots.filter((item) => item.id !== bot.id)

        for (const group of store.groups) {
          if (group.memberIDs.includes(bot.id)) {
            group.memberIDs = group.memberIDs.filter((id) => id !== bot.id)
            group.updatedAt = Date.now()
          }
        }

        for (const item of [...store.commands, ...store.skills]) {
          if (item.scope === "selected") {
            item.botIDs = item.botIDs.filter((id) => id !== bot.id)
          }
        }

        if (store.coordinatorID === bot.id) store.coordinatorID = ""
        dropSchedule(bot.id)
        // Only the index goes: worker sessions stay in Desktop for the user.
        store.workers = store.workers.filter((worker) => worker.botID !== bot.id)

        await save()
        await emitChanged(bot.id)
        return { ok: true as const }
      },
      clearConversation: async (input) => {
        await refreshStore()
        const data = input as { id: string }
        const bot = findBot(data.id)
        if (!bot) throw new Error("Bot not found")

        // Removing the session also interrupts a running turn, cancels its
        // jobs, and deletes subagent children. Keep pointing at the old
        // session if that fails, as deleting a bot does.
        await removeSession(bot.sessionID, bot.name)
        bot.sessionID = ""
        bot.updatedAt = Date.now()
        await save()
        await emitChanged(bot.id)
        return { ok: true as const }
      },
      ensureSession: async (input) => {
        await refreshStore()
        const data = input as { id: string }
        const bot = findBot(data.id)
        if (!bot) throw new Error("Bot not found")
        return { sessionID: await ensureSession(bot) }
      },
      createGroup: async (input) => {
        await refreshStore()
        const now = Date.now()
        const data = normalizeGroup(input as GroupInput)
        const group: StoredGroup = {
          id: randomUUID(),
          ...data,
          sessionID: "",
          createdAt: now,
          updatedAt: now,
        }
        store.groups.push(group)
        await save()
        try {
          await ensureSession(group)
        } catch (error) {
          console.error("[opencode-bots] could not create group session", error)
        }
        await emitChanged(group.id)
        console.log("[opencode-bots] created group", group.name)
        return toGroupView(group)
      },
      updateGroup: async (input) => {
        await refreshStore()
        const data = input as { id: string; patch: GroupPatch }
        const group = findGroup(data.id)
        if (!group) throw new Error("Group not found")
        const previousName = group.name
        applyGroupPatch(group, data.patch ?? {})
        await save()

        if (group.sessionID && group.name !== previousName) {
          await ctx.session.update({ sessionID: group.sessionID, title: group.name })
        }

        await emitChanged(group.id)
        return toGroupView(group)
      },
      removeGroup: async (input) => {
        await refreshStore()
        const data = input as { id: string }
        const group = findGroup(data.id)
        if (!group) throw new Error("Group not found")
        await removeSession(group.sessionID, group.name)
        store.groups = store.groups.filter((item) => item.id !== group.id)
        await save()
        await emitChanged(group.id)
        return { ok: true as const }
      },
      ensureGroupSession: async (input) => {
        await refreshStore()
        const data = input as { id: string }
        const group = findGroup(data.id)
        if (!group) throw new Error("Group not found")
        return { sessionID: await ensureSession(group) }
      },
      updateSettings: async (input) => {
        await refreshStore()
        const data = input as { model: unknown }
        store.model = cleanModel(data.model)
        await save()
        for (const owner of [...store.bots, ...store.groups]) {
          if (owner.sessionID) await enforceModel(owner.sessionID)
        }
        await emitChanged("settings")
        return toState()
      },
      updateCoordinator: async (input) => {
        await refreshStore()
        const data = input as { id: string }
        const id = typeof data.id === "string" ? data.id.trim() : ""
        if (id && !findBot(id)) throw new Error("Bot not found")
        store.coordinatorID = id
        await save()
        await emitChanged("coordinator")
        return toState()
      },
      updateLibrary: async (input) => {
        await refreshStore()
        const data = input as { commands: CommandInput[]; skills: SkillInput[] }
        await validateLibrary(data)
        const previousSkills = new Map(store.skills.map((skill) => [skill.id, skill]))
        const contents = new Map<string, string>()
        for (const skill of data.skills) {
          const id = cleanSkillID(skill.id)
          if (id) contents.set(id, skill.content)
        }
        store.commands = cleanCommands(data.commands, (id) => !!findBot(id))
        store.skills = cleanSkills(data.skills, (id) => !!findBot(id))
        for (const skill of store.skills) {
          const previous = previousSkills.get(skill.id)
          if (previous) {
            skill.createdAt = previous.createdAt
            skill.uses = previous.uses
            skill.lastUsedAt = previous.lastUsedAt
          }
          const content = contents.get(skill.id)
          if (content !== undefined) await writeSkillDocument(skill, content)
        }
        await save()
        for (const id of previousSkills.keys()) {
          if (!store.skills.some((skill) => skill.id === id)) {
            await removeSkillDir(id)
          }
        }
        await registerCommands()
        await registerSkills()
        await emitChanged("library")
        console.log(
          `[opencode-bots] library updated: ${store.commands.length} command(s), ${store.skills.length} skill(s)`,
        )
        return toState()
      },
      models: async () => {
        const result = await ctx.model.list()
        return {
          models: result.data
            .filter(
              (model) =>
                model.capabilities.tools &&
                model.status !== "deprecated" &&
                (model.type === undefined || model.type === "chat"),
            )
            .map((model) => ({
              providerID: model.providerID,
              id: model.id,
              name: model.name || model.id,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }
      },
      readSkillFile: async (input) => {
        await refreshStore()
        const data = input as { skillID: string; path: string }
        if (!store.skills.some((skill) => skill.id === data.skillID)) {
          throw new Error(`No skill with id "${data.skillID}".`)
        }
        return readSkillFile(data.skillID, data.path)
      },
      writeSkillFile: async (input) => {
        await refreshStore()
        const data = input as {
          skillID: string
          path: string
          content: string
          encoding?: "utf8" | "base64"
        }
        const result = await writeSkillFile(data.skillID, data.path, data.content, data.encoding)
        await emitChanged("skills")
        return result
      },
      deleteSkillFile: async (input) => {
        await refreshStore()
        const data = input as { skillID: string; path: string }
        const result = await deleteSkillFile(data.skillID, data.path)
        await emitChanged("skills")
        return result
      },
      saveTask: async (input, context) => {
        await refreshStore()
        try {
          saveTaskRecord(input as TaskInput, "")
        } catch (error) {
          return context.error("invalid", messageOf(error), null)
        }
        await save()
        await emitChanged("schedule")
        return toState()
      },
      removeTask: async (input, context) => {
        await refreshStore()
        const { id } = input as { id: string }
        if (!store.tasks.some((task) => task.id === id)) {
          return context.error("invalid", "That task no longer exists.", null)
        }
        store.tasks = store.tasks.filter((task) => task.id !== id)
        await save()
        await emitChanged("schedule")
        return toState()
      },
      saveJob: async (input, context) => {
        await refreshStore()
        try {
          saveJobRecord(input as JobInput, "")
        } catch (error) {
          return context.error("invalid", messageOf(error), null)
        }
        await save()
        await emitChanged("schedule")
        return toState()
      },
      removeJob: async (input, context) => {
        await refreshStore()
        const { id } = input as { id: string }
        if (!store.jobs.some((job) => job.id === id)) {
          return context.error("invalid", "That job no longer exists.", null)
        }
        store.jobs = store.jobs.filter((job) => job.id !== id)
        await save()
        await emitChanged("schedule")
        return toState()
      },
      runJob: async (input, context) => {
        await refreshStore()
        const { id } = input as { id: string }
        const job = store.jobs.find((item) => item.id === id)
        if (!job) return context.error("invalid", "That job no longer exists.", null)
        job.lastRunAt = Date.now()
        job.runs += 1
        await save()
        try {
          await runJob(job)
        } catch (error) {
          return context.error("invalid", messageOf(error), null)
        }
        await emitChanged("schedule")
        return toState()
      },
      revokeDevices: async () => {
        // The web host re-reads remote.json when its mtime moves, so rotating the
        // secret signs every paired device out without a restart. Push
        // subscriptions are tied to the secret, so they stop at the same time.
        const path = join(dataDir, "remote.json")
        let hostname: string | null = null
        try {
          const parsed = JSON.parse(await readFile(path, "utf8")) as { hostname?: unknown }
          if (typeof parsed.hostname === "string" && parsed.hostname) hostname = parsed.hostname
        } catch {
          // A missing or unreadable file is fine: a new secret is all that is needed.
        }

        await mkdir(dataDir, { recursive: true })
        const temp = `${path}.tmp`
        const secret = randomBytes(32).toString("base64url")
        // 0600 from the first byte: the secret is never briefly world-readable.
        await writeFile(temp, `${JSON.stringify({ secret, hostname }, null, 2)}\n`, { mode: 0o600 })
        await rename(temp, path)
        return { ok: true }
      },
    })

    emitChanged = (botID) => rpc.events.emit("changed", { botID })

    await archiveStaleSkills(true)

    void tick()
    const scheduleTimer = setInterval(() => void tick(), SCHEDULE_TICK_MS)

    // A worker runs in another location, so toolGuard never sees its questions.
    // The global event stream does; bot and group sessions are left to toolGuard.
    const notified = new Set<string>()
    const notifyWorkerRequest = async (
      sessionID: string,
      key: string,
      kind: "question" | "permission",
      text: string,
    ) => {
      if (notified.has(key)) return
      await refreshStore()
      const worker = store.workers.find((item) => item.sessionID === sessionID)
      const bot = worker ? findBot(worker.botID) : undefined
      if (!worker || !bot) return
      notified.add(key)
      if (notified.size > 500) notified.delete(notified.values().next().value!)
      void sendPush({
        title:
          kind === "question"
            ? `${bot.name}'s worker has a question`
            : `${bot.name}'s worker needs permission`,
        body: oneLine(`${workerLabel(worker)}: ${text}`, 160),
        url: `/?bot=${encodeURIComponent(bot.id)}`,
        tag: `opencode-bots:${sessionID}:${kind}`,
      })
    }

    const events = new AbortController()
    const watchWorkerRequests = async () => {
      while (!events.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({
            types: ["form.created", "permission.asked"],
            signal: events.signal,
          })) {
            try {
              if (event.type === "form.created") {
                const { form } = event.data
                const field = form.fields[0] as { title?: string; description?: string } | undefined
                await notifyWorkerRequest(
                  form.sessionID,
                  `form:${form.id}`,
                  "question",
                  field?.description || field?.title || form.title || "Waiting for your answer.",
                )
              } else if (event.type === "permission.asked") {
                const request = event.data
                await notifyWorkerRequest(
                  request.sessionID,
                  `permission:${request.id}`,
                  "permission",
                  `wants to use ${request.action}${request.resources.length ? ` on ${request.resources.join(", ")}` : ""}`,
                )
              }
            } catch (error) {
              console.error("[opencode-bots] could not notify about a worker request", error)
            }
          }
        } catch (error) {
          if (events.signal.aborted) return
          console.warn("[opencode-bots] worker request stream stopped; reconnecting", error)
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 5000)
          events.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer)
              resolve()
            },
            { once: true },
          )
        })
      }
    }
    void watchWorkerRequests()

    console.log(
      `[opencode-bots] workspace loaded ${store.bots.length} bot(s), ${store.groups.length} group(s), ${store.commands.length} command(s), ${store.skills.length} skill(s), ${store.tasks.length} task(s), ${store.jobs.length} job(s), ${store.workers.length} worker(s) from ${storePath} for ${workspace}`,
    )

    return async () => {
      clearInterval(scheduleTimer)
      events.abort()
      await Promise.allSettled([
        contextHook.dispose(),
        promptHook.dispose(),
        idleHook.dispose(),
        commandRegistration?.dispose(),
        skillRegistration?.dispose(),
        toolTransform.dispose(),
        toolGuard.dispose(),
        rpc.dispose(),
        releaseWebHost(),
      ])
    }
  },
})
