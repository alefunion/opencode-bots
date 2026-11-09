import type { FormInfo, PermissionRequest } from "@opencode/client"

export type { FormField, FormInfo, PermissionRequest } from "@opencode/client"

/**
 * A question form or permission request a bot session is blocked on. `worker`
 * is set when it comes from one of the bot's project workers instead.
 */
export type PendingRequest =
  | { kind: "form"; bot: Bot; form: FormInfo; worker?: Worker }
  | { kind: "permission"; bot: Bot; request: PermissionRequest; worker?: Worker }

export type FormReply = Record<string, string | number | boolean | string[]>

export type ModelRef = {
  providerID: string
  id: string
  variant?: string
}

export type MemoryEntry = {
  id: string
  title: string
  content: string
}

export type LibraryScope = "all" | "selected"

export type BotCommand = {
  id: string
  name: string
  description: string
  template: string
  scope: LibraryScope
  botIDs: string[]
}

export type SkillFile = {
  path: string
  size: number
}

export type SkillFileContent = {
  path: string
  encoding: "utf8" | "base64"
  content: string
}

export type BotSkill = {
  id: string
  name: string
  description: string
  content: string
  autoinvoke: boolean
  scope: LibraryScope
  botIDs: string[]
  files: SkillFile[]
  status: "active" | "draft" | "archived"
  pinned: boolean
  author: string
  evidence: string
  createdAt: number
  uses: number
  lastUsedAt: number
}

export type RemoteStatus = "connecting" | "connected" | "error"

export type RemoteInfo = {
  status: RemoteStatus
  url: string | null
  error: string | null
}

export type SessionInfo = {
  authenticated: boolean
  remote: RemoteInfo
}

export type PairingLink = {
  code: string
  link: string | null
  qr: string | null
  expiresAt: number
}

export type Bot = {
  id: string
  name: string
  handle: string
  color: string
  face: string
  role: string
  sessionID: string
  memory: MemoryEntry[]
  createdAt: number
  updatedAt: number
}

export type Group = {
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

export type TaskStatus = "todo" | "doing" | "done"

export type Task = {
  id: string
  botID: string
  title: string
  notes: string
  status: TaskStatus
  /** 0 means no wake time. */
  wakeAt: number
  author: string
  createdAt: number
  updatedAt: number
  doneAt: number
}

export type TaskInput = Pick<Task, "botID" | "title" | "notes" | "status" | "wakeAt"> & {
  id?: string
}

export type Job = {
  id: string
  botID: string
  name: string
  prompt: string
  cron: string
  timeZone: string
  enabled: boolean
  notify: boolean
  author: string
  createdAt: number
  updatedAt: number
  nextRunAt: number
  lastRunAt: number
  runs: number
}

export type JobInput = Pick<
  Job,
  "botID" | "name" | "prompt" | "cron" | "timeZone" | "enabled" | "notify"
> & { id?: string }

/** A top-level OpenCode session a bot opened in a project directory. */
export type Worker = {
  id: string
  botID: string
  sessionID: string
  directory: string
  /** "" when OpenCode titled the session itself. */
  title: string
  createdAt: number
  updatedAt: number
}

export type BotsState = {
  model: ModelRef | null
  bots: Bot[]
  groups: Group[]
  commands: BotCommand[]
  skills: BotSkill[]
  tasks: Task[]
  jobs: Job[]
  workers: Worker[]
  coordinatorID: string
  /** The machine's time zone, the default for new jobs. */
  timeZone: string
}

export type ModelOption = {
  providerID: string
  providerName?: string
  id: string
  name: string
}

export type PromptAttachment = {
  id: string
  name: string
  mime: string
  dataUrl: string
  size: number
}

export type MessageFile = {
  name: string
  mime: string
  data: string
}

export type ToolCall = {
  name: string
  status: string
  input?: unknown
  output?: string
}

export type UiMessage = {
  id: string
  role: "user" | "assistant" | "synthetic" | "member"
  text: string
  time: number
  tools: ToolCall[]
  handle?: string
  files?: MessageFile[]
  /** Synthetic messages posted by a scheduled job or a task's wake time. */
  scheduled?: "job" | "task"
}
