import { useEffect, useMemo, useRef, useState } from "react"
import { client, botsApi, loadMessages, remoteApi, requestsApi, send as sendToSession } from "./api"
import type {
  Bot,
  BotsState,
  FormInfo,
  Group,
  ModelOption,
  PendingRequest,
  PermissionRequest,
  PromptAttachment,
  RemoteInfo,
  SessionInfo,
  UiMessage,
} from "./types"
import { syncPushSubscription } from "./push"
import { Sidebar, type Selection } from "./components/Sidebar"
import { Chat } from "./components/Chat"
import { Settings, type SettingsTab } from "./components/Settings"
import { Pairing } from "./components/Pairing"
import { Icon, Mark } from "./icons"

const LAST_READ_KEY = "opencode-bots:last-read"

const OFFLINE: RemoteInfo = {
  status: "connecting",
  url: null,
  error: null,
}

type Toast = { message: string; variant: "success" | "error" }
type SettingsState = {
  tab: SettingsTab
  mode: "settings" | "new"
  groupID?: string
}

const readKey = (kind: "bot" | "group", id: string) => `${kind}:${id}`

export function App() {
  const [state, setState] = useState<BotsState>({
    model: null,
    bots: [],
    groups: [],
    commands: [],
    skills: [],
    tasks: [],
    jobs: [],
    coordinatorID: "",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  const [models, setModels] = useState<ModelOption[]>([])
  const [selected, setSelected] = useState<Selection | null>(null)
  const [messages, setMessages] = useState<Record<string, UiMessage[]>>({})
  const [typing, setTyping] = useState<Set<string>>(() => new Set())
  const [streaming, setStreaming] = useState<Record<string, { id: string; text: string }>>({})
  const [lastRead, setLastRead] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(LAST_READ_KEY) ?? "{}") as Record<string, number>
    } catch {
      return {}
    }
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [pending, setPending] = useState<{ forms: FormInfo[]; permissions: PermissionRequest[] }>({
    forms: [],
    permissions: [],
  })
  const remote = session?.remote ?? OFFLINE

  const actionsRef = useRef({
    refreshState: async () => {},
    loadMessagesForSession: async (_sessionID: string) => {},
    refreshPending: async () => {},
  })

  const selectedBot = useMemo(
    () =>
      selected?.kind === "bot" ? (state.bots.find((bot) => bot.id === selected.id) ?? null) : null,
    [selected, state.bots],
  )
  const selectedGroup = useMemo(
    () =>
      selected?.kind === "group"
        ? (state.groups.find((group) => group.id === selected.id) ?? null)
        : null,
    [selected, state.groups],
  )
  const selectedHost = useMemo(
    () =>
      selectedGroup ? (state.bots.find((bot) => bot.id === selectedGroup.hostID) ?? null) : null,
    [selectedGroup, state.bots],
  )
  const selectedSessionID = selectedBot?.sessionID ?? selectedGroup?.sessionID ?? null
  const hasChat = !!(selectedBot || (selectedGroup && selectedHost))
  const selectedCommandBot = selectedBot ?? selectedHost
  const selectedCommands = useMemo(
    () =>
      selectedCommandBot
        ? state.commands.filter(
            (command) => command.scope === "all" || command.botIDs.includes(selectedCommandBot.id),
          )
        : [],
    [selectedCommandBot, state.commands],
  )

  /** Pending questions and permission prompts for a chat, from every session it waits on. */
  const requestsFor = (owners: Map<string, Bot>): PendingRequest[] => [
    ...pending.forms.flatMap((form) => {
      const bot = owners.get(form.sessionID)
      return bot ? [{ kind: "form" as const, bot, form }] : []
    }),
    ...pending.permissions.flatMap((request) => {
      const bot = owners.get(request.sessionID)
      return bot ? [{ kind: "permission" as const, bot, request }] : []
    }),
  ]

  // A group's members answer in their own sessions, so their questions block the group too.
  const selectedRequests = useMemo(() => {
    const owners = new Map<string, Bot>()
    if (selectedBot?.sessionID) owners.set(selectedBot.sessionID, selectedBot)
    if (selectedGroup && selectedHost) {
      owners.set(selectedGroup.sessionID, selectedHost)
      for (const bot of state.bots) {
        if (bot.sessionID && selectedGroup.memberIDs.includes(bot.id))
          owners.set(bot.sessionID, bot)
      }
    }
    return requestsFor(owners)
  }, [pending, selectedBot, selectedGroup, selectedHost, state.bots])

  const waiting = useMemo(
    () =>
      new Set([
        ...pending.forms.map((form) => form.sessionID),
        ...pending.permissions.map((request) => request.sessionID),
      ]),
    [pending],
  )

  const unread = useMemo(() => {
    const result = new Set<string>()
    for (const bot of state.bots) {
      if (selected?.kind === "bot" && selected.id === bot.id) continue
      const last = messages[bot.sessionID]?.at(-1)
      if (last && last.time > (lastRead[readKey("bot", bot.id)] ?? 0)) {
        result.add(readKey("bot", bot.id))
      }
    }
    for (const group of state.groups) {
      if (selected?.kind === "group" && selected.id === group.id) continue
      const last = messages[group.sessionID]?.at(-1)
      if (last && last.time > (lastRead[readKey("group", group.id)] ?? 0)) {
        result.add(readKey("group", group.id))
      }
    }
    return result
  }, [lastRead, messages, selected, state.bots, state.groups])

  const showToast = (message: string, variant: "success" | "error" = "success") => {
    setToast({ message, variant })
  }

  const loadMessagesForSession = async (sessionID: string) => {
    try {
      const list = await loadMessages(sessionID)
      setMessages((current) => ({ ...current, [sessionID]: list }))
    } catch {
      // A session can briefly disappear while the plugin recreates it.
    }
  }

  /**
   * The chat's session ID, asking the plugin to create (or recreate) it when the
   * chat has none, and recording the new ID locally.
   */
  const ensureSessionFor = async (target: Selection) => {
    const { sessionID } =
      target.kind === "bot"
        ? await botsApi.ensureSession(target.id)
        : await botsApi.ensureGroupSession(target.id)
    setState((current) => {
      const patch = <T extends { id: string }>(items: T[]) =>
        items.map((item) => (item.id === target.id ? { ...item, sessionID } : item))
      return target.kind === "bot"
        ? { ...current, bots: patch(current.bots) }
        : { ...current, groups: patch(current.groups) }
    })
    return sessionID
  }

  const loadAllMessages = async (bots: Bot[], groups: Group[]) => {
    const chats = [
      ...bots.map((bot) => ({ kind: "bot" as const, id: bot.id, sessionID: bot.sessionID })),
      ...groups.map((group) => ({
        kind: "group" as const,
        id: group.id,
        sessionID: group.sessionID,
      })),
    ]
    await Promise.allSettled(
      chats.map(async (chat) =>
        loadMessagesForSession(chat.sessionID || (await ensureSessionFor(chat))),
      ),
    )
  }

  /** Stops the typing indicator and drops any partial streamed text. */
  const clearActivity = (...sessionIDs: string[]) => {
    setTyping((current) => {
      const next = new Set(current)
      for (const id of sessionIDs) next.delete(id)
      return next
    })
    setStreaming((current) => {
      const next = { ...current }
      for (const id of sessionIDs) delete next[id]
      return next
    })
  }

  const refreshPending = async () => {
    try {
      setPending(await requestsApi.list())
    } catch {
      // Keep the last list; the next form or permission event refreshes it.
    }
  }

  const refreshState = async () => {
    void refreshPending()
    const next = await botsApi.state()
    setState(next)
    setSelected((current) => {
      if (current) {
        const exists =
          current.kind === "bot"
            ? next.bots.some((bot) => bot.id === current.id)
            : next.groups.some((group) => group.id === current.id)
        if (exists) return current
      }
      const initialBot =
        next.bots.find((bot) => bot.id === next.coordinatorID) ?? next.bots[0] ?? null
      return initialBot ? { kind: "bot", id: initialBot.id } : null
    })
    await loadAllMessages(next.bots, next.groups)
  }

  actionsRef.current = { refreshState, loadMessagesForSession, refreshPending }

  const loadInitial = async () => {
    setError(null)
    try {
      const [next, modelResult, providerResult] = await Promise.all([
        botsApi.state(),
        botsApi.models().catch(() => null),
        botsApi.providers().catch(() => null),
      ])
      setState(next)
      if (modelResult) {
        const names = new Map(
          (providerResult?.providers ?? []).map((provider) => [provider.id, provider.name]),
        )
        setModels(
          modelResult.models.map((model) => ({
            ...model,
            providerName: names.get(model.providerID) ?? model.providerID,
          })),
        )
      }
      await loadAllMessages(next.bots, next.groups)
      void refreshPending()

      // A notification opens `/?bot=<id>` or `/?group=<id>`. Otherwise land on
      // the coordinator so the app does not open empty.
      const params = new URLSearchParams(window.location.search)
      const botParam = params.get("bot")
      const groupParam = params.get("group")
      const targetGroup = groupParam
        ? next.groups.find((group) => group.id === groupParam)
        : undefined
      const targetBot = botParam
        ? next.bots.find((bot) => bot.id === botParam || bot.handle === botParam)
        : undefined
      if (targetGroup && next.bots.some((bot) => bot.id === targetGroup.hostID)) {
        setSelected({ kind: "group", id: targetGroup.id })
        setLastRead((current) => ({
          ...current,
          [readKey("group", targetGroup.id)]: Date.now(),
        }))
      } else {
        const initialBot =
          targetBot ??
          next.bots.find((bot) => bot.id === next.coordinatorID) ??
          next.bots[0] ??
          null
        if (initialBot) {
          setSelected({ kind: "bot", id: initialBot.id })
          setLastRead((current) => ({
            ...current,
            [readKey("bot", initialBot.id)]: Date.now(),
          }))
        }
      }

      setLastRead((current) => {
        const updated = { ...current }
        for (const bot of next.bots) {
          const key = readKey("bot", bot.id)
          if (!(key in updated)) updated[key] = Date.now()
        }
        for (const group of next.groups) {
          const key = readKey("group", group.id)
          if (!(key in updated)) updated[key] = Date.now()
        }
        return updated
      })
    } catch (cause) {
      setError(String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const info = await remoteApi.session()
        setSession(info)
        if (!info.authenticated) {
          setLoading(false)
          return
        }
      } catch (cause) {
        setError(String(cause))
        setLoading(false)
        return
      }
      await loadInitial()
    })()
  }, [])

  useEffect(() => {
    if (!session?.authenticated) return
    // A paired device that already subscribed keeps its subscription in sync
    // after VAPID rotation or a server-side clear.
    void syncPushSubscription().catch(() => {})
  }, [session?.authenticated])

  useEffect(() => {
    const timer = setInterval(() => {
      void remoteApi
        .session()
        .then((info) => {
          if (!info.authenticated) {
            // Signed out (revoked): drop anything already on screen.
            setMessages({})
            setSelected(null)
            setSettings(null)
          }
          setSession(info)
        })
        .catch(() => {})
    }, 20_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify(lastRead))
  }, [lastRead])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!session?.authenticated) return
    const controller = new AbortController()
    let stopped = false

    const run = async () => {
      while (!stopped) {
        try {
          for await (const event of client.event.subscribe({ signal: controller.signal })) {
            const type = String(event.type)
            const data = (event as { data?: Record<string, unknown> }).data
            const sessionID = typeof data?.sessionID === "string" ? data.sessionID : undefined

            if (type === "server.connected") {
              void actionsRef.current.refreshState()
              continue
            }

            if (type === "session.execution.started" && sessionID) {
              clearActivity(sessionID)
              setTyping((current) => new Set(current).add(sessionID))
              continue
            }

            if (type === "session.text.delta" && sessionID) {
              const id = typeof data?.assistantMessageID === "string" ? data.assistantMessageID : ""
              const delta = typeof data?.delta === "string" ? data.delta : ""
              setTyping((current) => new Set(current).add(sessionID))
              setStreaming((current) => {
                const previous = current[sessionID]
                return {
                  ...current,
                  [sessionID]: {
                    id,
                    text: `${previous?.id === id ? previous.text : ""}${delta}`,
                  },
                }
              })
              continue
            }

            if (
              type === "session.execution.succeeded" ||
              type === "session.execution.failed" ||
              type === "session.execution.interrupted"
            ) {
              if (sessionID) {
                clearActivity(sessionID)
                void actionsRef.current.loadMessagesForSession(sessionID)
              }
              // An interrupted run cancels the questions it was waiting on.
              void actionsRef.current.refreshPending()
              if (type === "session.execution.failed") {
                const message =
                  data?.error && typeof data.error === "object" && "message" in data.error
                    ? String((data.error as { message: unknown }).message)
                    : "Bot run failed"
                showToast(message, "error")
              }
              continue
            }

            if (type === "session.message.content.updated" && sessionID) {
              void actionsRef.current.loadMessagesForSession(sessionID)
              continue
            }

            if (type.startsWith("form.") || type.startsWith("permission.")) {
              void actionsRef.current.refreshPending()
              continue
            }

            if (type.startsWith("rpc.opencode-bots.")) {
              void actionsRef.current.refreshState()
            }
          }
        } catch {
          if (stopped) return
        }
        if (!stopped) await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    }

    void run()
    return () => {
      stopped = true
      controller.abort()
    }
  }, [session?.authenticated])

  const markRead = (kind: "bot" | "group", id: string) => {
    setLastRead((current) => ({ ...current, [readKey(kind, id)]: Date.now() }))
  }

  const select = async (target: Selection, name: string, sessionID: string) => {
    setSelected(target)
    markRead(target.kind, target.id)
    try {
      await loadMessagesForSession(sessionID || (await ensureSessionFor(target)))
    } catch (cause) {
      showToast(`Could not open ${name}: ${String(cause)}`, "error")
    }
  }

  const send = async (text: string, files: PromptAttachment[] = []) => {
    const chat = selectedBot ?? selectedGroup
    if (!selected || !chat) return

    let sessionID = chat.sessionID
    if (!sessionID) {
      try {
        sessionID = await ensureSessionFor(selected)
      } catch (cause) {
        showToast(`Could not start ${chat.name}: ${String(cause)}`, "error")
        return
      }
    }

    // `/name args` runs a library command when this chat's bot can use it.
    const match = /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/i.exec(text)
    const command = match
      ? state.commands.find((item) => item.name === match[1]!.toLowerCase())
      : undefined
    if (command && selectedCommandBot && !selectedCommands.includes(command)) {
      showToast(`/${command.name} is not available to ${selectedCommandBot.name}`, "error")
      return
    }

    const initial = sessionID
    clearActivity(initial)
    setTyping((current) => new Set(current).add(initial))
    try {
      const active = await sendToSession(
        initial,
        command ? (match?.[2] ?? "") : text,
        files,
        () => ensureSessionFor(selected),
        command?.name,
      )
      // A recreated session reports its own activity; clear the deleted one's.
      if (active !== initial) clearActivity(initial)
      await loadMessagesForSession(active)
    } catch (cause) {
      clearActivity(initial)
      showToast(`Could not send: ${String(cause)}`, "error")
    }
  }

  const openBotSettings = (mode: "settings" | "new") => {
    setSettings({ tab: "bots", mode })
  }

  const openGroupSettings = (mode: "settings" | "new", groupID?: string) => {
    setSettings({ tab: "groups", mode, groupID })
  }

  if (loading) {
    return (
      <div className="boot">
        <Mark size={35} />
        <span className="boot-spinner" />
        <p>Connecting to OpenCode…</p>
      </div>
    )
  }

  if (session && !session.authenticated) {
    return (
      <Pairing
        onPaired={async () => {
          const info = await remoteApi.session()
          setSession(info)
          if (!info.authenticated) throw new Error("Pairing did not stick. Try again.")
          setLoading(true)
          await loadInitial()
        }}
      />
    )
  }

  if (error) {
    return (
      <div className="boot error-boot">
        <Mark size={35} />
        <h1>OpenCode is not reachable</h1>
        <p>{error}</p>
        <p className="muted">
          Open OpenCode Desktop on this Mac. The bots app uses the same background service, so the
          sessions and models stay shared.
        </p>
        <button className="primary-button" onClick={() => void loadInitial()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className={`app${hasChat ? " has-chat" : ""}`}>
      <Sidebar
        bots={state.bots}
        groups={state.groups}
        selected={selected}
        messages={messages}
        unread={unread}
        typing={typing}
        waiting={waiting}
        onSelectBot={(bot) => void select({ kind: "bot", id: bot.id }, bot.name, bot.sessionID)}
        onSelectGroup={(group) =>
          void select({ kind: "group", id: group.id }, group.name, group.sessionID)
        }
        onNewBot={() => openBotSettings("new")}
        onSettings={() => openBotSettings("settings")}
      />

      {selectedBot ? (
        <Chat
          bot={selectedBot}
          bots={state.bots}
          commands={selectedCommands}
          messages={messages[selectedSessionID ?? ""] ?? []}
          typing={typing.has(selectedSessionID ?? "")}
          streaming={streaming[selectedSessionID ?? ""]?.text ?? ""}
          requests={selectedRequests}
          onAnswered={() => void refreshPending()}
          onSend={(text, files) => void send(text, files)}
          onBack={() => setSelected(null)}
        />
      ) : selectedGroup && selectedHost ? (
        <Chat
          bot={selectedHost}
          bots={state.bots}
          commands={selectedCommands}
          group={selectedGroup}
          messages={messages[selectedSessionID ?? ""] ?? []}
          typing={typing.has(selectedSessionID ?? "")}
          streaming={streaming[selectedSessionID ?? ""]?.text ?? ""}
          requests={selectedRequests}
          onAnswered={() => void refreshPending()}
          onSend={(text, files) => void send(text, files)}
          onBack={() => setSelected(null)}
        />
      ) : selectedGroup ? (
        <main className="chat welcome">
          <div className="welcome-card">
            <Mark size={35} />
            <h2>Group host missing</h2>
            <p>Choose another host in group settings.</p>
            <button
              className="primary-button"
              onClick={() => openGroupSettings("settings", selectedGroup.id)}
            >
              Open group settings
            </button>
          </div>
        </main>
      ) : (
        <main className="chat welcome">
          <div className="welcome-card">
            <Mark size={35} />
            <h2>
              {state.bots.length === 0 && state.groups.length === 0
                ? "No chats yet"
                : "Select a chat"}
            </h2>
            <p>
              {state.bots.length === 0 && state.groups.length === 0
                ? "Create a bot with its own role, memory, and persistent session."
                : "Pick a bot or group on the left, or create a new one."}
            </p>
            <div className="welcome-actions">
              <button className="primary-button" onClick={() => openBotSettings("new")}>
                <Icon name="plus" size={16} /> New bot
              </button>
              {state.bots.length > 0 ? (
                <button className="secondary-button" onClick={() => openGroupSettings("new")}>
                  <Icon name="group" size={16} /> New group
                </button>
              ) : null}
            </div>
          </div>
        </main>
      )}

      {settings ? (
        <Settings
          key={`settings-${settings.tab}-${settings.mode}-${settings.groupID ?? "none"}`}
          initialTab={settings.tab}
          startNew={settings.mode === "new"}
          initialGroupID={settings.groupID}
          state={state}
          models={models}
          remote={remote}
          onClose={() => setSettings(null)}
          onRefresh={refreshState}
          onToast={showToast}
        />
      ) : null}

      {toast ? <div className={`toast ${toast.variant}`}>{toast.message}</div> : null}
    </div>
  )
}

export default App
