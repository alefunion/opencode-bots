import { useEffect, useState } from "react"
import { botsApi } from "../api"
import type { Bot, BotsState, Group } from "../types"
import { Avatar, COLORS } from "./Avatar"
import { Icon } from "../icons"

type Draft = {
  id: string | null
  name: string
  color: string
  hostID: string
  memberIDs: string[]
  description: string
}

const fromGroup = (group: Group): Draft => ({
  id: group.id,
  name: group.name,
  color: group.color,
  hostID: group.hostID,
  memberIDs: [...group.memberIDs],
  description: group.description,
})

const empty = (bots: Bot[]): Draft => {
  const host = bots[0]
  return {
    id: null,
    name: "New group",
    color: COLORS[1]!,
    hostID: host?.id ?? "",
    memberIDs: host ? [host.id] : [],
    description: "",
  }
}

export function GroupsEditor({
  state,
  startNew = false,
  initialGroupID,
  onRefresh,
  onToast,
}: {
  state: BotsState
  startNew?: boolean
  initialGroupID?: string
  onRefresh: () => Promise<void>
  onToast: (message: string, variant?: "success" | "error") => void
}) {
  const first = startNew
    ? undefined
    : (state.groups.find((group) => group.id === initialGroupID) ?? state.groups[0])
  const [selectedID, setSelectedID] = useState<string | null>(first?.id ?? null)
  const [draft, setDraft] = useState<Draft | null>(first ? fromGroup(first) : empty(state.bots))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (selectedID && !state.groups.some((group) => group.id === selectedID)) {
      const next = state.groups[0]
      setSelectedID(next?.id ?? null)
      setDraft(next ? fromGroup(next) : empty(state.bots))
    }
  }, [selectedID, state.bots, state.groups])

  useEffect(() => {
    if (draft?.hostID && !state.bots.some((bot) => bot.id === draft.hostID)) {
      const host = state.bots[0]
      setDraft({
        ...draft,
        hostID: host?.id ?? "",
        memberIDs: host ? [...new Set([host.id, ...draft.memberIDs])] : [],
      })
    }
  }, [draft, state.bots])

  const select = (group: Group) => {
    setSelectedID(group.id)
    setDraft(fromGroup(group))
    setError(null)
  }

  const newGroup = () => {
    setSelectedID(null)
    setDraft(empty(state.bots))
    setError(null)
  }

  const patch = (value: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...value } : current))
  }

  const setHost = (hostID: string) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            hostID,
            memberIDs: [...new Set([hostID, ...current.memberIDs])],
          }
        : current,
    )
  }

  const toggleMember = (id: string) => {
    setDraft((current) => {
      if (!current || id === current.hostID) return current
      const memberIDs = current.memberIDs.includes(id)
        ? current.memberIDs.filter((item) => item !== id)
        : [...current.memberIDs, id]
      return {
        ...current,
        memberIDs: memberIDs.length ? memberIDs : [current.hostID],
      }
    })
  }

  const save = async () => {
    if (!draft || !draft.name.trim() || !draft.hostID) return
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: draft.name,
        color: draft.color,
        hostID: draft.hostID,
        memberIDs: draft.memberIDs.length ? draft.memberIDs : [draft.hostID],
        description: draft.description,
      }
      const saved = draft.id
        ? await botsApi.updateGroup(draft.id, payload)
        : await botsApi.createGroup(payload)
      await onRefresh()
      setSelectedID(saved.id)
      setDraft(fromGroup(saved))
      onToast(draft.id ? `${saved.name} saved` : `${saved.name} created`, "success")
    } catch (cause) {
      setError(String(cause))
      onToast("Could not save group", "error")
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!draft?.id) return
    if (!confirm(`Delete ${draft.name} and its group session? This cannot be undone.`)) return
    setSaving(true)
    try {
      await botsApi.removeGroup(draft.id)
      await onRefresh()
      newGroup()
      onToast(`${draft.name} deleted`, "success")
    } catch (cause) {
      setError(String(cause))
      onToast("Could not delete group", "error")
    } finally {
      setSaving(false)
    }
  }

  const host = state.bots.find((bot) => bot.id === draft?.hostID)

  return (
    <div className="settings-body">
      <div className="settings-bots">
        <div className="settings-bots-header">
          <span>Groups</span>
          <button
            className="icon-button"
            onClick={newGroup}
            title="New group"
            aria-label="New group"
          >
            <Icon name="plus" />
          </button>
        </div>
        <div className="settings-bot-list">
          {state.groups.map((group) => (
            <button
              key={group.id}
              className={`settings-bot${selectedID === group.id ? " active" : ""}`}
              onClick={() => select(group)}
            >
              <Avatar name={group.name} color={group.color} size={24} />
              <span>
                <strong>{group.name}</strong>
                <small>
                  {group.memberIDs.length} {group.memberIDs.length === 1 ? "member" : "members"}
                </small>
              </span>
            </button>
          ))}
          {state.groups.length === 0 ? <p className="hint">No groups yet.</p> : null}
        </div>
      </div>

      <div className="settings-editor">
        <div className="settings-editor-scroll">
          {state.bots.length === 0 ? (
            <div className="editor-empty">
              <p>Create a bot before creating a group.</p>
            </div>
          ) : draft ? (
            <div className="editor-form">
              <div className="editor-title">
                <h3>{draft.id ? "Edit group" : "New group"}</h3>
                {draft.id ? (
                  <button className="danger-button" onClick={() => void remove()} disabled={saving}>
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
                <span>Host bot</span>
                <select
                  className="select-input"
                  value={draft.hostID}
                  onChange={(event) => setHost(event.currentTarget.value)}
                >
                  {state.bots.map((bot) => (
                    <option key={bot.id} value={bot.id}>
                      {bot.name}
                    </option>
                  ))}
                </select>
              </label>
              {host ? (
                <p className="hint">
                  {host.name} writes the group replies and routes member mentions.
                </p>
              ) : null}

              <div className="field">
                <span>Members</span>
                <div className="member-picker">
                  {state.bots.map((bot) => {
                    const checked = draft.memberIDs.includes(bot.id)
                    const isHost = bot.id === draft.hostID
                    return (
                      <button
                        key={bot.id}
                        className={`member-option${checked ? " selected" : ""}${isHost ? " host" : ""}`}
                        onClick={() => toggleMember(bot.id)}
                        disabled={isHost}
                        type="button"
                      >
                        <Avatar name={bot.name} color={bot.color} size={20} />
                        <span className="member-option-main">
                          <strong>{bot.name}</strong>
                          <small>@{bot.handle}</small>
                        </span>
                        {isHost ? <span className="member-badge">Host</span> : null}
                        <span className={`member-check${checked ? " checked" : ""}`}>
                          {checked ? <Icon name="check" size={14} /> : null}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <label className="field">
                <span>Group instructions</span>
                <textarea
                  rows={4}
                  value={draft.description}
                  onChange={(event) => patch({ description: event.currentTarget.value })}
                  placeholder="What is this group for? How should the host coordinate the members?"
                />
              </label>

              {error ? <p className="error-text">{error}</p> : null}
            </div>
          ) : (
            <div className="editor-empty">
              <p>Select a group or create one.</p>
              <button className="primary-button" onClick={newGroup}>
                <Icon name="plus" size={16} /> Create group
              </button>
            </div>
          )}
        </div>

        {draft && state.bots.length > 0 ? (
          <div className="editor-actions">
            <button
              className="primary-button"
              onClick={() => void save()}
              disabled={saving || !draft.name.trim() || !draft.hostID}
            >
              {saving ? "Saving…" : draft.id ? "Save changes" : "Create group"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
