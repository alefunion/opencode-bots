import { Rpc } from "@opencode/plugin/rpc"

export type ModelRef = {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

export type MemoryEntry = {
  readonly id: string
  readonly title: string
  readonly content: string
}

export type LibraryScope = "all" | "selected"

export type CommandView = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly template: string
  readonly scope: LibraryScope
  readonly botIDs: readonly string[]
}

export type CommandInput = Omit<CommandView, "id"> & { readonly id?: string }

export type SkillFileView = {
  readonly path: string
  readonly size: number
}

export type SkillFileContent = {
  readonly path: string
  readonly encoding: "utf8" | "base64"
  readonly content: string
}

export type SkillView = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly content: string
  readonly autoinvoke: boolean
  readonly scope: LibraryScope
  readonly botIDs: readonly string[]
  readonly files: readonly SkillFileView[]
}

export type SkillInput = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly content: string
  readonly autoinvoke: boolean
  readonly scope: LibraryScope
  readonly botIDs: readonly string[]
  readonly files?: readonly SkillFileView[]
}

export type BotView = {
  readonly id: string
  readonly name: string
  readonly handle: string
  readonly color: string
  readonly role: string
  readonly sessionID: string
  readonly memory: readonly MemoryEntry[]
  readonly createdAt: number
  readonly updatedAt: number
}

export type BotInput = {
  readonly name: string
  readonly color: string
  readonly role: string
  readonly memory: readonly MemoryEntry[]
}

export type BotPatch = Partial<BotInput>

export type GroupView = {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly hostID: string
  readonly memberIDs: readonly string[]
  readonly description: string
  readonly sessionID: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type GroupInput = {
  readonly name: string
  readonly color: string
  readonly hostID: string
  readonly memberIDs: readonly string[]
  readonly description: string
}

export type GroupPatch = Partial<GroupInput>

export type ModelOption = {
  readonly providerID: string
  readonly id: string
  readonly name: string
}

export type BotsState = {
  readonly model: ModelRef | null
  readonly bots: readonly BotView[]
  readonly groups: readonly GroupView[]
  readonly commands: readonly CommandView[]
  readonly skills: readonly SkillView[]
  readonly coordinatorID: string
}

export type EnsureSessionOutput = { readonly sessionID: string }
export type ModelsOutput = { readonly models: readonly ModelOption[] }
export type RemoveOutput = { readonly ok: true }

const empty = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const

const model = {
  anyOf: [
    {
      type: "object",
      properties: {
        providerID: { type: "string" },
        id: { type: "string" },
        variant: { type: "string" },
      },
      required: ["providerID", "id"],
      additionalProperties: false,
    },
    { type: "null" },
  ],
} as const

const memory = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      content: { type: "string" },
    },
    required: ["id", "title", "content"],
    additionalProperties: false,
  },
} as const

const bot = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    handle: { type: "string" },
    color: { type: "string" },
    role: { type: "string" },
    sessionID: { type: "string" },
    memory,
    createdAt: { type: "number" },
    updatedAt: { type: "number" },
  },
  required: [
    "id",
    "name",
    "handle",
    "color",
    "role",
    "sessionID",
    "memory",
    "createdAt",
    "updatedAt",
  ],
  additionalProperties: false,
} as const

const botInput = {
  type: "object",
  properties: {
    name: { type: "string" },
    color: { type: "string" },
    role: { type: "string" },
    memory,
  },
  required: ["name", "color", "role", "memory"],
  additionalProperties: false,
} as const

const botPatch = {
  type: "object",
  properties: {
    name: { type: "string" },
    color: { type: "string" },
    role: { type: "string" },
    memory,
  },
  additionalProperties: false,
} as const

const group = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    color: { type: "string" },
    hostID: { type: "string" },
    memberIDs: { type: "array", items: { type: "string" } },
    description: { type: "string" },
    sessionID: { type: "string" },
    createdAt: { type: "number" },
    updatedAt: { type: "number" },
  },
  required: [
    "id",
    "name",
    "color",
    "hostID",
    "memberIDs",
    "description",
    "sessionID",
    "createdAt",
    "updatedAt",
  ],
  additionalProperties: false,
} as const

const groupInput = {
  type: "object",
  properties: {
    name: { type: "string" },
    color: { type: "string" },
    hostID: { type: "string" },
    memberIDs: { type: "array", items: { type: "string" } },
    description: { type: "string" },
  },
  required: ["name", "color", "hostID", "memberIDs", "description"],
  additionalProperties: false,
} as const

const groupPatch = {
  type: "object",
  properties: {
    name: { type: "string" },
    color: { type: "string" },
    hostID: { type: "string" },
    memberIDs: { type: "array", items: { type: "string" } },
    description: { type: "string" },
  },
  additionalProperties: false,
} as const

const libraryScope = {
  type: "string",
  enum: ["all", "selected"],
} as const

const command = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    template: { type: "string" },
    scope: libraryScope,
    botIDs: { type: "array", items: { type: "string" } },
  },
  required: ["id", "name", "description", "template", "scope", "botIDs"],
  additionalProperties: false,
} as const

const commandInput = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    template: { type: "string" },
    scope: libraryScope,
    botIDs: { type: "array", items: { type: "string" } },
  },
  required: ["name", "description", "template", "scope", "botIDs"],
  additionalProperties: false,
} as const

const skillFile = {
  type: "object",
  properties: {
    path: { type: "string" },
    size: { type: "number" },
  },
  required: ["path", "size"],
  additionalProperties: false,
} as const

const skill = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    content: { type: "string" },
    autoinvoke: { type: "boolean" },
    scope: libraryScope,
    botIDs: { type: "array", items: { type: "string" } },
    files: { type: "array", items: skillFile },
  },
  required: ["id", "name", "description", "content", "autoinvoke", "scope", "botIDs"],
  additionalProperties: false,
} as const

const state = {
  type: "object",
  properties: {
    model,
    bots: { type: "array", items: bot },
    groups: { type: "array", items: group },
    commands: { type: "array", items: command },
    skills: { type: "array", items: skill },
    coordinatorID: { type: "string" },
  },
  required: ["model", "bots", "groups", "commands", "skills", "coordinatorID"],
  additionalProperties: false,
} as const

export const BotsRpc = Rpc.define({
  id: "opencode-bots",
  methods: {
    list: {
      input: empty,
      output: state,
    },
    create: {
      input: botInput,
      output: bot,
    },
    update: {
      input: {
        type: "object",
        properties: {
          id: { type: "string" },
          patch: botPatch,
        },
        required: ["id", "patch"],
        additionalProperties: false,
      },
      output: bot,
    },
    remove: {
      input: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    ensureSession: {
      input: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
    },
    createGroup: {
      input: groupInput,
      output: group,
    },
    updateGroup: {
      input: {
        type: "object",
        properties: {
          id: { type: "string" },
          patch: groupPatch,
        },
        required: ["id", "patch"],
        additionalProperties: false,
      },
      output: group,
    },
    removeGroup: {
      input: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    ensureGroupSession: {
      input: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
    },
    updateSettings: {
      input: {
        type: "object",
        properties: { model },
        required: ["model"],
        additionalProperties: false,
      },
      output: state,
    },
    updateCoordinator: {
      input: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      output: state,
    },
    updateLibrary: {
      input: {
        type: "object",
        properties: {
          commands: { type: "array", items: commandInput },
          skills: { type: "array", items: skill },
        },
        required: ["commands", "skills"],
        additionalProperties: false,
      },
      output: state,
    },
    models: {
      input: empty,
      output: {
        type: "object",
        properties: {
          models: {
            type: "array",
            items: {
              type: "object",
              properties: {
                providerID: { type: "string" },
                id: { type: "string" },
                name: { type: "string" },
              },
              required: ["providerID", "id", "name"],
              additionalProperties: false,
            },
          },
        },
        required: ["models"],
        additionalProperties: false,
      },
    },
    readSkillFile: {
      input: {
        type: "object",
        properties: {
          skillID: { type: "string" },
          path: { type: "string" },
        },
        required: ["skillID", "path"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          path: { type: "string" },
          encoding: { type: "string", enum: ["utf8", "base64"] },
          content: { type: "string" },
        },
        required: ["path", "encoding", "content"],
        additionalProperties: false,
      },
    },
    writeSkillFile: {
      input: {
        type: "object",
        properties: {
          skillID: { type: "string" },
          path: { type: "string" },
          content: { type: "string" },
          encoding: { type: "string", enum: ["utf8", "base64"] },
        },
        required: ["skillID", "path", "content"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          files: { type: "array", items: skillFile },
        },
        required: ["ok", "files"],
        additionalProperties: false,
      },
    },
    deleteSkillFile: {
      input: {
        type: "object",
        properties: {
          skillID: { type: "string" },
          path: { type: "string" },
        },
        required: ["skillID", "path"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          files: { type: "array", items: skillFile },
        },
        required: ["ok", "files"],
        additionalProperties: false,
      },
    },
    revokeDevices: {
      input: empty,
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { botID: { type: "string" } },
        required: ["botID"],
        additionalProperties: false,
      },
    },
  },
})
