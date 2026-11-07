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
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { randomBytes, randomUUID } from "node:crypto"
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
  type LibraryScope,
  type ModelRef,
  type SkillFileContent,
  type SkillFileView,
  type SkillInput,
  type SkillView,
} from "./rpc"

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
const MAX_COMMAND_TEMPLATE = 20_000
const MAX_SKILL_CONTENT = 100_000
const MAX_SKILL_FILE_BYTES = 4 * 1024 * 1024
const MAX_SKILL_FILES = 200
const MAX_SKILL_TOTAL_BYTES = 40 * 1024 * 1024
const TARGET_TIMEOUT_MS = 120_000

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
  role: string
  sessionID: string
  memory: StoredMemory[]
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
}

type Store = {
  version: 1
  model: ModelRef | null
  bots: StoredBot[]
  groups: StoredGroup[]
  commands: StoredCommand[]
  skills: StoredSkill[]
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
    })
  }
  return output
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

const storedBot = (raw: Record<string, unknown>): StoredBot => {
  const name = cleanName(raw.name)
  const created = typeof raw.createdAt === "number" ? raw.createdAt : Date.now()
  return {
    id: String(raw.id),
    name,
    handle: typeof raw.handle === "string" && raw.handle ? raw.handle : slugify(name),
    color: cleanColor(raw.color),
    role: cleanRole(raw.role),
    sessionID: typeof raw.sessionID === "string" ? raw.sessionID : "",
    memory: cleanMemory(raw.memory),
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
  `Manage this memory with the bots_memory tool. Use action "save" with title/content to add or update an entry, or action "delete" with the entry's id to forget it. Memory is private to ${owner}.`,
]

// With Code Mode on, plugin tools are not direct tool calls: they live in the
// `execute` tool's catalog (for example `tools.memory`). Bots that are only told
// "call bots_memory" look for a direct tool, find none, and give up.
const TOOL_NOTE = [
  "Bot tools: bots_send, bots_memory, bots_skill, bots_command, and bots_create (coordinator only).",
  "If they are not listed as direct tools, they are in the execute tool's catalog (for example `await tools.memory({...})` inside execute). Search the catalog for them before concluding a tool is missing.",
]

const FROM_BOT_RULES = [
  "- A message prefixed [From @handle] comes from another bot. Answer it directly and do not call bots_send for that message.",
  "- The other bot replies in its own session, and you receive its reply as the tool result.",
]

const buildSystemPrompt = (bot: StoredBot) =>
  [
    `You are "${bot.name}" (@${bot.handle}), a bot in Bots for OpenCode.`,
    "",
    "Your role:",
    bot.role.trim() || "Be a helpful, concise assistant.",
    "",
    "You have your own persistent OpenCode session. Treat this conversation as continuous.",
    "",
    ...TOOL_NOTE,
    "",
    "Bot mentions:",
    "- When the user's current message mentions another bot with @handle, call the bots_send tool with the target handle and the message to send.",
    "- Only call bots_send when the user's current message includes a bot mention. Never call it on your own.",
    ...FROM_BOT_RULES,
    "",
    ...memorySection(bot, "you"),
  ].join("\n")

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
    if (!isBotWorkspace) return async () => releaseWebHost()

    await mkdir(workspace, { recursive: true })

    let store: Store = {
      version: 1,
      model: null,
      bots: [],
      groups: [],
      commands: [],
      skills: [],
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
        coordinatorID: String(coordinatorID),
      }
      return (
        parsed.version !== 1 ||
        !("model" in parsed) ||
        !("groups" in parsed) ||
        !("commands" in parsed) ||
        !("skills" in parsed) ||
        !("coordinatorID" in parsed) ||
        bots.some((bot) => "model" in bot) ||
        parsed.coordinatorID !== coordinatorID ||
        skillsMigrated
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
      coordinatorID: store.coordinatorID,
    })

    const appliesTo = (item: { scope: LibraryScope; botIDs: string[] }, botID: string) =>
      item.scope === "all" || item.botIDs.includes(botID)

    const skillsFor = (botID: string) => store.skills.filter((skill) => appliesTo(skill, botID))

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
      if (patch.role !== undefined) bot.role = cleanRole(patch.role)
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
        `You are "${host.name}" (@${host.handle}), the host of the group chat "${group.name}".`,
        "",
        "Your role:",
        host.role.trim() || "Be a helpful, concise assistant.",
        "",
        "Group instructions:",
        group.description.trim() || "Coordinate the group and answer the user.",
        "",
        "Group members:",
        roster,
        "",
        ...TOOL_NOTE,
        "",
        "You are the host and the only bot that routes messages in this group.",
        "- When the user's current message mentions a member with @handle, call the bots_send tool with that member's handle and the message to send.",
        "- Only mention members listed above. Never call bots_send on your own.",
        ...FROM_BOT_RULES,
        "",
        ...memorySection(host, "the host bot"),
      ].join("\n")
    }

    const contextHook = await ctx.session.hook("context", async (event) => {
      await refreshStore()
      const { bot, group, source } = sourceFor(event.sessionID)
      if (bot) event.system.push({ type: "text", text: buildSystemPrompt(bot) })
      if (group && source)
        event.system.push({ type: "text", text: buildGroupPrompt(group, source) })

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
      for (const name of ["bots_send", "bots_skill", "bots_memory", "bots_command"]) {
        delete event.tools[name]
      }
    })

    const promptHook = await ctx.session.hook("prompt", async (event) => {
      await refreshStore()
      const { bot, group, source } = sourceFor(event.sessionID)
      if (bot || group) await enforceModel(event.sessionID)

      const library = librarySkillIDs()
      if (library.size === 0 || !event.prompt.skills?.length) return
      const allowed = source
        ? new Set(skillsFor(source.id).map((skill) => skill.id))
        : new Set<string>()
      event.prompt.skills = event.prompt.skills.filter(
        (skill) => !library.has(skill.id) || allowed.has(skill.id),
      )
    })

    // Runs only after a successful turn (not after failure or interruption).
    const idleHook = await ctx.session.hook("experimental.idle", async (event) => {
      await refreshStore()
      const { bot, group } = sourceFor(event.sessionID)
      if (!bot && !group) return
      // Work this session owns wakes it again when done, so wait for that. Work a
      // descendant owns never wakes this session, so it must not hold the
      // notification back.
      if (event.background.some((item) => item.sessionID === event.sessionID)) return

      try {
        const messages = await ctx.session.context({ sessionID: event.sessionID })
        const lastUser = messages.findLast((item) => item.type === "user")
        // Bot-to-bot and group-member turns stay inside the app.
        if (!lastUser || lastUser.metadata?.fromBot || lastUser.metadata?.fromGroup) return
        const text = replyText(messages, lastUser.time.created).replace(/\s+/g, " ")
        void sendPush({
          title: `${bot?.name ?? group?.name} finished`,
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
      }
      const action =
        args.action === "delete"
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

      if (action === "delete") {
        const id = skillID()
        if (!id) {
          return { content: "Error: skill id or name is required to delete a skill." }
        }
        const existing = store.skills.find((skill) => skill.id === id)
        if (!existing) {
          return { content: `Error: no skill with id "${id}".` }
        }
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
        if (!store.skills.some((skill) => skill.id === id)) {
          return { content: `Error: no skill with id "${id}".` }
        }
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
      if (existing) {
        existing.name = name
        existing.description = description
        await writeSkillDocument(existing, content)
        await save()
      } else {
        const globalCollision = (await ctx.skill.list()).data.some(
          (skill) => skill.id === id && !librarySkillIDs().has(id),
        )
        if (globalCollision) {
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
        color?: unknown
        role?: unknown
      }
      const name = typeof args.name === "string" ? args.name.trim() : ""
      if (!name) return { content: "Error: bot name is required." }
      const color = cleanColor(
        typeof args.color === "string"
          ? args.color
          : DEFAULT_COLORS[store.bots.length % DEFAULT_COLORS.length],
      )
      const role = cleanRole(args.role)
      const bot = await createBot({ name, color, role, memory: [] })
      return {
        content: `Created bot "${bot.name}" (@${bot.handle}) with its own persistent session.`,
      }
    }

    const toolTransform = await ctx.tool.transform((editor) => {
      editor.namespace({ name: "bots", description: "Bot messaging and bot library tools" })
      editor.add({
        name: "send",
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

          const messages = await ctx.session.context({ sessionID: context.sessionID })
          const lastUser = [...messages].reverse().find((item) => item.type === "user")
          if (!lastUser) return { content: "Error: no user message to route." }
          if (
            lastUser.metadata &&
            typeof lastUser.metadata === "object" &&
            "fromBot" in lastUser.metadata
          ) {
            return {
              content:
                "Error: bot-to-bot calls are disabled. Only the user's own message can mention another bot.",
            }
          }

          const escaped = target.handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          const mention = new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[.,!?;:])`, "i")
          if (!mention.test(lastUser.text)) {
            return {
              content: `Error: the user's current message does not mention @${target.handle}, so it cannot be contacted.`,
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

          const stop = AbortSignal.any([context.signal, AbortSignal.timeout(TARGET_TIMEOUT_MS)])
          const outcome = await Promise.race([
            ctx.session.wait({ sessionID: target.sessionID }).then(
              () => "done" as const,
              () => "error" as const,
            ),
            new Promise<"stopped">((resolve) =>
              stop.addEventListener("abort", () => resolve("stopped"), { once: true }),
            ),
          ])

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
        description:
          "Create, update, or delete a reusable bot-library skill, and manage its supporting files. A skill is a directory with SKILL.md plus optional references, scripts, and assets; paths inside the skill are relative to that directory. New skills are scoped only to you; existing skills keep their current scope, which may be shared. Changing a shared skill affects every bot using it, and deleting a shared skill removes it for everyone. Use the native skill tool to load a skill, not this tool.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["save", "delete", "write-file", "delete-file"],
              description:
                "save to add or update a skill; delete to remove it; write-file to add or replace a supporting file; delete-file to remove one.",
            },
            id: {
              type: "string",
              description:
                "Existing skill ID. Pass it to update, delete, or manage the files of a specific skill, including a shared one. Derived from the name when omitted on save.",
            },
            name: { type: "string", description: "Short display name for the skill." },
            description: {
              type: "string",
              description: "When the skill should be used, written for discovery.",
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
        description:
          "Save, update, or delete a memory entry for yourself. Use this when the user asks you to remember or forget something, or when they state a durable preference. Memory is private to this bot.",
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
        name: "command",
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
        name: "create",
        description:
          "Create a new bot with its own persistent session. Only the coordinator bot can use this.",
        input: {
          type: "object",
          properties: {
            name: { type: "string", description: "Display name for the new bot." },
            color: {
              type: "string",
              description: "Optional six-digit hex colour.",
            },
            role: {
              type: "string",
              description: "Optional role / system prompt for the new bot.",
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
    // native skill tool, which would otherwise load any bot-library skill.
    const toolGuard = await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool.toLowerCase() !== "skill") return
      const id = (event.input as { id?: unknown } | undefined)?.id
      await refreshStore()
      const skill = store.skills.find((item) => item.id === id)
      if (!skill) return
      const { source } = sourceFor(event.sessionID)
      if (!source || !appliesTo(skill, source.id)) {
        throw new Error("This skill is only available to its assigned bot sessions")
      }
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
            color: DEFAULT_COLORS[0],
            role: "You are Chief, the coordinator of this workspace. You can create new bots with the bots_create tool, and you help the user organise and delegate work across bots.",
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
        const previousSkills = new Set(store.skills.map((skill) => skill.id))
        const contents = new Map<string, string>()
        for (const skill of data.skills) {
          const id = cleanSkillID(skill.id)
          if (id) contents.set(id, skill.content)
        }
        store.commands = cleanCommands(data.commands, (id) => !!findBot(id))
        store.skills = cleanSkills(data.skills, (id) => !!findBot(id))
        for (const skill of store.skills) {
          const content = contents.get(skill.id)
          if (content !== undefined) await writeSkillDocument(skill, content)
        }
        await save()
        for (const id of previousSkills) {
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

    console.log(
      `[opencode-bots] workspace loaded ${store.bots.length} bot(s), ${store.groups.length} group(s), ${store.commands.length} command(s), ${store.skills.length} skill(s) from ${storePath} for ${workspace}`,
    )

    return async () => {
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
