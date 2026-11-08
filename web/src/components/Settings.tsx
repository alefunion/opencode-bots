import { useEffect, useMemo, useState } from "react"
import { botsApi } from "../api"
import type {
  Bot,
  BotCommand,
  BotSkill,
  BotsState,
  MemoryEntry,
  ModelOption,
  ModelRef,
  RemoteInfo,
} from "../types"
import { Avatar, COLORS } from "./Avatar"
import { Icon } from "../icons"
import { CommandsEditor, SkillsEditor } from "./Library"
import { GroupsEditor } from "./GroupSettings"
import { JobsEditor, TasksBoard } from "./Planner"
import { RemotePanel } from "./Remote"

type Draft = {
  id: string | null
  name: string
  color: string
  role: string
  memory: MemoryEntry[]
}

export type SettingsTab = "bots" | "groups" | "tasks" | "jobs" | "commands" | "skills" | "remote"

const fromBot = (bot: Bot): Draft => ({
  id: bot.id,
  name: bot.name,
  color: bot.color,
  role: bot.role,
  memory: bot.memory,
})

const empty = (): Draft => ({
  id: null,
  name: "New bot",
  color: COLORS[0]!,
  role: "",
  memory: [],
})

export function Settings({
  state,
  models,
  remote,
  startNew = false,
  initialTab = "bots",
  initialGroupID,
  onClose,
  onRefresh,
  onToast,
}: {
  state: BotsState
  models: ModelOption[]
  remote: RemoteInfo
  startNew?: boolean
  initialTab?: SettingsTab
  initialGroupID?: string
  onClose: () => void
  onRefresh: () => Promise<void>
  onToast: (message: string, variant?: "success" | "error") => void
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [commands, setCommands] = useState<BotCommand[]>(state.commands)
  const [skills, setSkills] = useState<BotSkill[]>(state.skills)
  const [selectedID, setSelectedID] = useState<string | null>(
    startNew ? null : (state.bots[0]?.id ?? null),
  )
  const [draft, setDraft] = useState<Draft | null>(() =>
    !startNew && state.bots[0] ? fromBot(state.bots[0]) : empty(),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [modelPicker, setModelPicker] = useState(false)
  const [modelQuery, setModelQuery] = useState("")

  const currentModel = state.model
    ? models.find(
        (model) => model.providerID === state.model?.providerID && model.id === state.model?.id,
      )
    : undefined
  const currentModelLabel = state.model
    ? (currentModel?.name ?? state.model.id)
    : "Workspace default"
  const currentProviderLabel = state.model
    ? (currentModel?.providerName ?? currentModel?.providerID ?? state.model.providerID)
    : null
  const draftCount = skills.filter((skill) => (skill.status ?? "active") === "draft").length
  const openTasks = state.tasks.filter((task) => task.status !== "done").length
  // Tabs whose changes apply immediately rather than through "Save library".
  const immediate = tab === "remote" || tab === "tasks" || tab === "jobs"

  const modelGroups = useMemo(() => {
    const query = modelQuery.trim().toLowerCase()
    const filtered = models.filter(
      (model) =>
        !query ||
        model.name.toLowerCase().includes(query) ||
        model.id.toLowerCase().includes(query) ||
        model.providerID.toLowerCase().includes(query) ||
        (model.providerName ?? "").toLowerCase().includes(query),
    )
    const groups = new Map<string, ModelOption[]>()
    for (const model of filtered) {
      const key = model.providerName ?? model.providerID
      const list = groups.get(key) ?? []
      list.push(model)
      groups.set(key, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [modelQuery, models])

  useEffect(() => {
    if (selectedID && !state.bots.some((bot) => bot.id === selectedID)) {
      const first = state.bots[0]
      setSelectedID(first?.id ?? null)
      setDraft(first ? fromBot(first) : empty())
    }
  }, [selectedID, state.bots])

  const select = (bot: Bot) => {
    setSelectedID(bot.id)
    setDraft(fromBot(bot))
    setError(null)
  }

  const newBot = () => {
    setSelectedID(null)
    setDraft(empty())
    setError(null)
  }

  const patch = (value: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...value } : current))
  }

  const save = async () => {
    if (!draft || !draft.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: draft.name,
        color: draft.color,
        role: draft.role,
        memory: draft.memory,
      }
      const saved = draft.id
        ? await botsApi.update(draft.id, payload)
        : await botsApi.create(payload)
      await onRefresh()
      setSelectedID(saved.id)
      setDraft(fromBot(saved))
      onToast(draft.id ? `${saved.name} saved` : `${saved.name} created`, "success")
    } catch (cause) {
      setError(String(cause))
      onToast("Could not save bot", "error")
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!draft?.id) return
    const hosted = state.groups.filter((group) => group.hostID === draft.id)
    if (hosted.length > 0) {
      const message = `${draft.name} hosts ${hosted.map((group) => group.name).join(", ")}. Change the group host first.`
      setError(message)
      onToast(message, "error")
      return
    }
    if (!confirm(`Delete ${draft.name} and its session? This cannot be undone.`)) return
    setSaving(true)
    try {
      await botsApi.remove(draft.id)
      await onRefresh()
      newBot()
      onToast(`${draft.name} deleted`, "success")
    } catch (cause) {
      setError(String(cause))
      onToast("Could not delete bot", "error")
    } finally {
      setSaving(false)
    }
  }

  const updateModel = async (value: string) => {
    const model: ModelRef | null = value
      ? (() => {
          const option = models.find((item) => `${item.providerID}/${item.id}` === value)
          return option ? { providerID: option.providerID, id: option.id } : null
        })()
      : null
    try {
      await botsApi.updateSettings(model)
      await onRefresh()
      onToast("Model updated for all bots", "success")
    } catch (cause) {
      onToast(`Could not update model: ${String(cause)}`, "error")
    }
  }

  const updateCoordinator = async (id: string) => {
    try {
      await botsApi.updateCoordinator(id)
      await onRefresh()
      onToast(id ? "Coordinator updated" : "Coordinator cleared", "success")
    } catch (cause) {
      onToast(`Could not update coordinator: ${String(cause)}`, "error")
    }
  }

  const saveLibrary = async () => {
    setSaving(true)
    setLibraryError(null)
    try {
      const next = await botsApi.updateLibrary(commands, skills)
      await onRefresh()
      setCommands(next.commands)
      setSkills(next.skills)
      onToast("Library saved", "success")
    } catch (cause) {
      setLibraryError(String(cause))
      onToast("Could not save library", "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="drawer-layer"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="drawer">
        <header className="drawer-header">
          <div>
            <h2>Settings</h2>
            <p>Bots, groups, tasks and scheduled jobs, the shared model, and the library.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings">
            <Icon name="close" />
          </button>
        </header>

        <div className="library-tabs">
          <button
            className={`library-tab${tab === "bots" ? " active" : ""}`}
            onClick={() => setTab("bots")}
          >
            Bots <span>{state.bots.length}</span>
          </button>
          <button
            className={`library-tab${tab === "groups" ? " active" : ""}`}
            onClick={() => setTab("groups")}
          >
            Groups <span>{state.groups.length}</span>
          </button>
          <button
            className={`library-tab${tab === "tasks" ? " active" : ""}`}
            onClick={() => setTab("tasks")}
          >
            Tasks <span>{openTasks}</span>
          </button>
          <button
            className={`library-tab${tab === "jobs" ? " active" : ""}`}
            onClick={() => setTab("jobs")}
          >
            Jobs <span>{state.jobs.length}</span>
          </button>
          <button
            className={`library-tab${tab === "commands" ? " active" : ""}`}
            onClick={() => setTab("commands")}
          >
            Commands <span>{commands.length}</span>
          </button>
          <button
            className={`library-tab${tab === "skills" ? " active" : ""}`}
            onClick={() => setTab("skills")}
          >
            Skills <span>{skills.length}</span>
            {draftCount > 0 ? (
              <span
                className="library-tab-badge"
                title={`${draftCount} proposed skill${draftCount === 1 ? "" : "s"} waiting for review`}
              >
                {draftCount} new
              </span>
            ) : null}
          </button>
          <button
            className={`library-tab${tab === "remote" ? " active" : ""}`}
            onClick={() => setTab("remote")}
          >
            Remote
            {remote.status === "connected" ? (
              <span className={`remote-dot remote-dot-${remote.status}`} />
            ) : null}
          </button>
        </div>

        {tab === "groups" ? (
          <GroupsEditor
            key={`groups-${initialGroupID ?? "first"}-${startNew ? "new" : "edit"}`}
            state={state}
            startNew={startNew}
            initialGroupID={initialGroupID}
            onRefresh={onRefresh}
            onToast={onToast}
          />
        ) : tab === "bots" ? (
          <>
            <section className="settings-section">
              <div className="field">
                <span>Model for all bots</span>
                <button
                  className="model-button"
                  onClick={() => {
                    setModelQuery("")
                    setModelPicker(true)
                  }}
                >
                  <span className="model-button-value">
                    {currentProviderLabel ? (
                      <span className="model-button-provider">{currentProviderLabel}</span>
                    ) : null}
                    <span className="model-button-name">{currentModelLabel}</span>
                  </span>
                  <span className="model-button-hint">Change</span>
                </button>
              </div>
              <p className="hint">
                This is the only model setting. Every bot and group session uses it; per-session
                changes are reverted on the next message.
              </p>
            </section>

            <section className="settings-section">
              <div className="field">
                <span>Coordinator bot</span>
                <select
                  value={state.coordinatorID}
                  onChange={(event) => void updateCoordinator(event.currentTarget.value)}
                >
                  <option value="">No coordinator</option>
                  {state.bots.map((bot) => (
                    <option key={bot.id} value={bot.id}>
                      {bot.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="hint">
                Only the coordinator can create new bots with the bots_create tool. Deleting it
                clears this setting.
              </p>
            </section>

            <div className="settings-body">
              <div className="settings-bots">
                <div className="settings-bots-header">
                  <span>Bots</span>
                  <button
                    className="icon-button"
                    onClick={newBot}
                    title="New bot"
                    aria-label="New bot"
                  >
                    <Icon name="plus" />
                  </button>
                </div>
                <div className="settings-bot-list">
                  {state.bots.map((bot) => (
                    <button
                      key={bot.id}
                      className={`settings-bot${selectedID === bot.id ? " active" : ""}`}
                      onClick={() => select(bot)}
                    >
                      <Avatar name={bot.name} color={bot.color} size={24} />
                      <span>
                        <strong>{bot.name}</strong>
                        <small>@{bot.handle}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-editor">
                <div className="settings-editor-scroll">
                  {draft ? (
                    <div className="editor-form">
                      <div className="editor-title">
                        <h3>{draft.id ? "Edit bot" : "New bot"}</h3>
                        {draft.id ? (
                          <button
                            className="danger-button"
                            onClick={() => void remove()}
                            disabled={saving}
                          >
                            <Icon name="trash" size={15} /> Delete
                          </button>
                        ) : null}
                      </div>

                      <label className="field">
                        <span>Name</span>
                        <input
                          value={draft.name}
                          onChange={(event) => patch({ name: event.currentTarget.value })}
                        />
                      </label>

                      <div className="field">
                        <span>Color</span>
                        <div className="swatches">
                          {COLORS.map((color) => (
                            <button
                              key={color}
                              className="swatch"
                              style={{ background: color }}
                              aria-label={color}
                              aria-pressed={draft.color === color}
                              onClick={() => patch({ color })}
                            />
                          ))}
                        </div>
                      </div>

                      <label className="field">
                        <span>Role / system prompt</span>
                        <textarea
                          rows={6}
                          value={draft.role}
                          onChange={(event) => patch({ role: event.currentTarget.value })}
                          placeholder="Describe who this bot is, how it should behave, and what it should care about."
                        />
                      </label>

                      <div className="memory-section">
                        <div className="memory-header">
                          <span>Memory</span>
                          <button
                            className="secondary-button"
                            onClick={() =>
                              patch({
                                memory: [
                                  ...draft.memory,
                                  { id: crypto.randomUUID(), title: "", content: "" },
                                ],
                              })
                            }
                          >
                            <Icon name="plus" size={14} /> Add
                          </button>
                        </div>
                        {draft.memory.length === 0 ? (
                          <p className="hint">No memory entries yet.</p>
                        ) : (
                          draft.memory.map((entry) => (
                            <div key={entry.id} className="memory-item">
                              <input
                                value={entry.title}
                                placeholder="Title"
                                onChange={(event) => {
                                  const title = event.currentTarget.value
                                  patch({
                                    memory: draft.memory.map((item) =>
                                      item.id === entry.id ? { ...item, title } : item,
                                    ),
                                  })
                                }}
                              />
                              <textarea
                                rows={2}
                                value={entry.content}
                                placeholder="What should this bot remember?"
                                onChange={(event) => {
                                  const content = event.currentTarget.value
                                  patch({
                                    memory: draft.memory.map((item) =>
                                      item.id === entry.id ? { ...item, content } : item,
                                    ),
                                  })
                                }}
                              />
                              <button
                                className="icon-button"
                                aria-label="Delete memory"
                                onClick={() =>
                                  patch({
                                    memory: draft.memory.filter((item) => item.id !== entry.id),
                                  })
                                }
                              >
                                <Icon name="trash" size={15} />
                              </button>
                            </div>
                          ))
                        )}
                      </div>

                      {error ? <p className="error-text">{error}</p> : null}
                    </div>
                  ) : (
                    <div className="editor-empty">
                      <p>Select a bot or create one.</p>
                      <button className="primary-button" onClick={newBot}>
                        <Icon name="plus" size={16} /> Create bot
                      </button>
                    </div>
                  )}
                </div>

                {draft ? (
                  <div className="editor-actions">
                    <button className="secondary-button" onClick={onClose}>
                      Close
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => void save()}
                      disabled={saving || !draft.name.trim()}
                    >
                      {saving ? "Saving…" : draft.id ? "Save changes" : "Create bot"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="library-body">
              {tab === "remote" ? (
                <RemotePanel info={remote} onToast={onToast} />
              ) : tab === "tasks" ? (
                <TasksBoard state={state} onRefresh={onRefresh} onToast={onToast} />
              ) : tab === "jobs" ? (
                <JobsEditor state={state} onRefresh={onRefresh} onToast={onToast} />
              ) : tab === "commands" ? (
                <CommandsEditor bots={state.bots} commands={commands} onChange={setCommands} />
              ) : (
                <SkillsEditor
                  bots={state.bots}
                  skills={skills}
                  savedIDs={new Set(state.skills.map((skill) => skill.id))}
                  onChange={setSkills}
                />
              )}
            </div>
            <footer className="library-footer">
              {immediate ? (
                <span className="hint">
                  {tab === "remote" ? "Remote changes" : "Task and job changes"} apply immediately.
                </span>
              ) : libraryError ? (
                <p className="error-text">{libraryError}</p>
              ) : (
                <span className="hint">Changes apply when you save.</span>
              )}
              {immediate ? null : (
                <div className="library-actions">
                  <button
                    className="primary-button"
                    onClick={() => void saveLibrary()}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save library"}
                  </button>
                </div>
              )}
            </footer>
          </>
        )}

        {modelPicker ? (
          <div className="model-picker-layer">
            <div className="model-picker">
              <header className="model-picker-header">
                <div>
                  <h3>Choose a model</h3>
                  <p>This model is used by every bot.</p>
                </div>
                <button
                  className="icon-button"
                  onClick={() => setModelPicker(false)}
                  aria-label="Close model picker"
                >
                  <Icon name="close" />
                </button>
              </header>
              <label className="search model-search">
                <Icon name="search" size={16} />
                <input
                  autoFocus
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.currentTarget.value)}
                  placeholder="Search models or providers"
                />
              </label>
              <div className="model-picker-list">
                <button
                  className={`model-option${state.model ? "" : " active"}`}
                  onClick={() => {
                    void updateModel("")
                    setModelPicker(false)
                  }}
                >
                  <strong>Workspace default</strong>
                  <small>Let the workspace config choose the model</small>
                </button>
                {modelGroups.map(([provider, list]) => (
                  <div className="model-group" key={provider}>
                    <div className="model-provider">{provider}</div>
                    {list.map((model) => {
                      const active =
                        state.model?.providerID === model.providerID && state.model?.id === model.id
                      return (
                        <button
                          key={`${model.providerID}/${model.id}`}
                          className={`model-option${active ? " active" : ""}`}
                          onClick={() => {
                            void updateModel(`${model.providerID}/${model.id}`)
                            setModelPicker(false)
                          }}
                        >
                          <strong>{model.name}</strong>
                          <small>{model.id}</small>
                        </button>
                      )
                    })}
                  </div>
                ))}
                {modelGroups.length === 0 ? (
                  <p className="hint" style={{ padding: "12px" }}>
                    No matching models.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  )
}
