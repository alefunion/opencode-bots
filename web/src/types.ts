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

export type BotsState = {
  model: ModelRef | null
  bots: Bot[]
  groups: Group[]
  commands: BotCommand[]
  skills: BotSkill[]
  coordinatorID: string
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
}
