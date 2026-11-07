import { OpenCode, isSessionNotFoundError, type SessionMessageInfo } from "@opencode/client"
import type {
  Bot,
  BotCommand,
  BotSkill,
  BotsState,
  Group,
  ModelOption,
  ModelRef,
  PairingLink,
  PromptAttachment,
  RemoteInfo,
  SessionInfo,
  SkillFile,
  SkillFileContent,
  ToolCall,
  UiMessage,
} from "./types"

export const client = OpenCode.make({
  baseUrl: window.location.origin,
})

let workspacePromise: Promise<string> | undefined

export const workspace = () => {
  workspacePromise ??= fetch("/bots/config")
    .then((response) => {
      if (!response.ok) throw new Error(`Could not read bot workspace: ${response.status}`)
      return response.json() as Promise<{ workspace: string }>
    })
    .then((data) => data.workspace)
  return workspacePromise
}

/** The bot RPC and providers are registered in the bot workspace location only. */
const location = async () => new URLSearchParams({ "location[directory]": await workspace() })

async function rpc<T>(method: string, input: unknown): Promise<T> {
  const response = await fetch(`/api/rpc/opencode-bots/${method}?${await location()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input }),
  })
  const body = (await response.json()) as {
    output?: T
    message?: string
    error?: string
    type?: string
  }
  if (!response.ok) {
    throw new Error(body.message || body.error || body.type || `RPC ${method} failed`)
  }
  return body.output as T
}

/**
 * `updateLibrary` validates each skill with `additionalProperties: false`, and the
 * server owns createdAt, uses, and lastUsedAt. Send only the fields the schema
 * accepts, picking them explicitly so nothing new leaks into the payload.
 */
const skillInput = (skill: BotSkill) => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  content: skill.content,
  autoinvoke: skill.autoinvoke,
  scope: skill.scope,
  botIDs: skill.botIDs,
  files: skill.files,
  status: skill.status,
  pinned: skill.pinned,
  author: skill.author,
  evidence: skill.evidence,
})

export const botsApi = {
  state: () => rpc<BotsState>("list", {}),
  models: () => rpc<{ models: ModelOption[] }>("models", {}),
  providers: async () => {
    const response = await fetch(`/api/provider?${await location()}`)
    if (!response.ok) throw new Error(`Could not read providers: ${response.status}`)
    const body = (await response.json()) as {
      data?: Array<{ id: string; name?: string }>
    }
    return {
      providers: (body.data ?? []).map((provider) => ({
        id: provider.id,
        name: provider.name || provider.id,
      })),
    }
  },
  create: (input: Omit<Bot, "id" | "handle" | "sessionID" | "createdAt" | "updatedAt">) =>
    rpc<Bot>("create", input),
  update: (
    id: string,
    patch: Partial<Omit<Bot, "id" | "handle" | "sessionID" | "createdAt" | "updatedAt">>,
  ) => rpc<Bot>("update", { id, patch }),
  remove: (id: string) => rpc<{ ok: true }>("remove", { id }),
  ensureSession: (id: string) => rpc<{ sessionID: string }>("ensureSession", { id }),
  createGroup: (input: Omit<Group, "id" | "sessionID" | "createdAt" | "updatedAt">) =>
    rpc<Group>("createGroup", input),
  updateGroup: (
    id: string,
    patch: Partial<Omit<Group, "id" | "sessionID" | "createdAt" | "updatedAt">>,
  ) => rpc<Group>("updateGroup", { id, patch }),
  removeGroup: (id: string) => rpc<{ ok: true }>("removeGroup", { id }),
  ensureGroupSession: (id: string) => rpc<{ sessionID: string }>("ensureGroupSession", { id }),
  updateSettings: (model: ModelRef | null) => rpc<BotsState>("updateSettings", { model }),
  updateCoordinator: (id: string) => rpc<BotsState>("updateCoordinator", { id }),
  updateLibrary: (commands: BotCommand[], skills: BotSkill[]) =>
    rpc<BotsState>("updateLibrary", { commands, skills: skills.map(skillInput) }),
  readSkillFile: (skillID: string, path: string) =>
    rpc<SkillFileContent>("readSkillFile", { skillID, path }),
  writeSkillFile: (
    skillID: string,
    path: string,
    content: string,
    encoding: "utf8" | "base64" = "utf8",
  ) =>
    rpc<{ ok: true; files: SkillFile[] }>("writeSkillFile", {
      skillID,
      path,
      content,
      encoding,
    }),
  deleteSkillFile: (skillID: string, path: string) =>
    rpc<{ ok: true; files: SkillFile[] }>("deleteSkillFile", { skillID, path }),
}

export const remoteApi = {
  session: async (): Promise<SessionInfo> => {
    const response = await fetch("/api/session", { headers: { accept: "application/json" } })
    if (!response.ok) throw new Error(`Could not read the session: ${response.status}`)
    return (await response.json()) as SessionInfo
  },
  pair: async (link: string) => {
    const response = await fetch("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ link }),
    })
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) throw new Error(body.error || "Pairing failed")
    return true
  },
  code: async (): Promise<PairingLink> => {
    const response = await fetch("/api/pair/code", { method: "POST" })
    const body = (await response.json().catch(() => ({}))) as PairingLink & { error?: string }
    if (!response.ok) throw new Error(body.error || "Could not create a pairing link")
    return body
  },
}

export async function loadMessages(sessionID: string): Promise<UiMessage[]> {
  const messages = (await client.session.context({ sessionID })) as SessionMessageInfo[]
  return toMessages(messages)
}

/**
 * Sends a message, or runs a library command when `command` is set. A session
 * deleted outside the app (for example in Desktop) is recreated through
 * `recover` and the send is retried once.
 */
export async function send(
  sessionID: string,
  text: string,
  files: PromptAttachment[],
  recover: () => Promise<string>,
  command?: string,
): Promise<string> {
  const attachments = files.map((file) => ({ uri: file.dataUrl, name: file.name }))
  const run = (target: string) => {
    const input = { sessionID: target, text, ...(attachments.length ? { files: attachments } : {}) }
    return command
      ? client.session.command({ ...input, name: command })
      : client.session.prompt(input)
  }
  try {
    await run(sessionID)
    return sessionID
  } catch (error) {
    if (!isSessionNotFoundError(error)) throw error
    const next = await recover()
    await run(next)
    return next
  }
}

function toolOutput(state: unknown): string | undefined {
  if (!state || typeof state !== "object") return undefined
  const value = state as { content?: unknown }
  if (!Array.isArray(value.content)) return undefined
  return (
    value.content
      .map((part) => {
        if (!part || typeof part !== "object") return ""
        const item = part as { type?: string; text?: string }
        return item.type === "text" ? (item.text ?? "") : ""
      })
      .filter(Boolean)
      .join("\n") || undefined
  )
}

type ToolState = {
  status?: string
  input?: unknown
  content?: unknown
  metadata?: {
    toolCalls?: Array<{
      tool?: string
      status?: string
      input?: { target?: unknown; message?: unknown }
    }>
  }
}

type ToolPart = {
  type: "tool"
  name: string
  state: ToolState
  time?: { created?: number; ran?: number; completed?: number }
}

/** bots_send, as Code Mode records it: bare in older sessions, namespaced since. */
const isSend = (tool: unknown) => tool === "send" || tool === "bots_send" || tool === "bots.send"

function sendTargets(state: ToolState): Set<string> {
  const targets = new Set<string>()
  const calls = state.metadata?.toolCalls
  if (!Array.isArray(calls)) return targets
  for (const call of calls) {
    if (!call || !isSend(call.tool)) continue
    if (call.status && call.status !== "completed") continue
    const target = call.input?.target
    if (typeof target === "string" && target.trim()) {
      targets.add(target.trim().replace(/^@+/, "").toLowerCase())
    }
  }
  return targets
}

function parseMemberReplies(output: string | undefined): Array<{ handle: string; text: string }> {
  if (!output) return []
  const pattern = /@([a-z0-9_-]+) replied:\s*\n\n([\s\S]*?)(?=\n\n@[a-z0-9_-]+ replied:|$)/gi
  const replies: Array<{ handle: string; text: string }> = []
  for (const match of output.matchAll(pattern)) {
    const handle = (match[1] ?? "").toLowerCase()
    const text = (match[2] ?? "").trim()
    if (handle && text) replies.push({ handle, text })
  }
  return replies
}

function toMessages(messages: readonly SessionMessageInfo[]): UiMessage[] {
  const output: UiMessage[] = []
  for (const message of messages) {
    if (message.type === "user") {
      const files = (message.files ?? [])
        .filter((file) => file.data)
        .map((file) => ({
          name: file.name || "Attachment",
          mime: file.mime,
          data: file.data,
        }))
      output.push({
        id: message.id,
        role: "user",
        text: message.text,
        time: message.time.created,
        tools: [],
        ...(files.length > 0 ? { files } : {}),
      })
      continue
    }

    if (message.type === "synthetic") {
      output.push({
        id: message.id,
        role: "synthetic",
        text: message.text,
        time: message.time.created,
        tools: [],
      })
      continue
    }

    if (message.type !== "assistant") continue

    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()

    const tools: ToolCall[] = []
    const memberMessages: UiMessage[] = []

    for (const part of message.content) {
      if (part.type !== "tool") continue
      const tool = part as unknown as ToolPart
      const state = tool.state
      const toolText = toolOutput(state)
      const replies = parseMemberReplies(toolText)
      if (replies.length === 0) {
        tools.push({
          name: tool.name,
          status: String(state.status ?? ""),
          input: state.input,
          output: toolText,
        })
        continue
      }

      const targets = sendTargets(state)
      const relevant = targets.size ? replies.filter((reply) => targets.has(reply.handle)) : replies
      const calls = state.metadata?.toolCalls ?? []
      const allSend =
        calls.length > 0 ? calls.every((call) => isSend(call?.tool)) : relevant.length > 0

      if (relevant.length > 0) {
        const time =
          tool.time?.completed ?? tool.time?.ran ?? tool.time?.created ?? message.time.created
        for (const [index, reply] of relevant.entries()) {
          memberMessages.push({
            id: `${message.id}:member:${reply.handle}:${index}`,
            role: "member",
            handle: reply.handle,
            text: reply.text,
            time,
            tools: [],
          })
        }
      }

      if (!allSend || relevant.length === 0) {
        tools.push({
          name: tool.name,
          status: String(state.status ?? ""),
          input: state.input,
          output: toolText,
        })
      }
    }

    if (text || tools.length > 0) {
      output.push({
        id: message.id,
        role: "assistant",
        text,
        time: message.time.created,
        tools,
      })
    }
    output.push(...memberMessages)
  }

  return output.sort((a, b) => a.time - b.time)
}
