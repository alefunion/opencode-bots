import { useRef, useState } from "react"
import type { Bot, BotCommand, BotSkill, LibraryScope, SkillFile } from "../types"
import { botsApi } from "../api"
import { Avatar } from "./Avatar"
import { Icon } from "../icons"

const uniqueID = (base: string, taken: Set<string>) => {
  let id = base
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`
  return id
}

const newCommand = (): BotCommand => ({
  id: crypto.randomUUID(),
  name: "new-command",
  description: "",
  template: "",
  scope: "all",
  botIDs: [],
})

const newSkill = (skills: BotSkill[]): BotSkill => ({
  id: uniqueID("new-skill", new Set(skills.map((skill) => skill.id))),
  name: "New skill",
  description: "",
  content: "",
  autoinvoke: true,
  scope: "all",
  botIDs: [],
  files: [],
  status: "active",
  pinned: false,
  author: "",
  evidence: "",
  createdAt: Date.now(),
  uses: 0,
  lastUsedAt: 0,
})

export function CommandsEditor({
  bots,
  commands,
  onChange,
}: {
  bots: Bot[]
  commands: BotCommand[]
  onChange: (commands: BotCommand[]) => void
}) {
  const patch = (id: string, value: Partial<BotCommand>) =>
    onChange(commands.map((item) => (item.id === id ? { ...item, ...value } : item)))

  return (
    <>
      <div className="library-toolbar">
        <p className="hint">
          Type <code>/name</code> in a bot chat. Templates support <code>$ARGUMENTS</code> and{" "}
          <code>$1</code>, <code>$2</code>…
        </p>
        <button className="secondary-button" onClick={() => onChange([...commands, newCommand()])}>
          <Icon name="plus" size={14} /> Add command
        </button>
      </div>

      {commands.length === 0 ? (
        <div className="library-empty">
          <Icon name="command" size={28} />
          <p>No bot commands yet.</p>
          <p className="hint">Add one to give every bot a reusable prompt.</p>
        </div>
      ) : (
        commands.map((command) => (
          <div className="library-card" key={command.id}>
            <div className="library-card-head">
              <span className="command-preview">/{command.name || "command"}</span>
              <button
                className="icon-button"
                aria-label={`Delete /${command.name}`}
                onClick={() => onChange(commands.filter((item) => item.id !== command.id))}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>Command</span>
                <input
                  value={command.name}
                  placeholder="review"
                  onChange={(event) => patch(command.id, { name: event.currentTarget.value })}
                />
              </label>
              <label className="field">
                <span>Description</span>
                <input
                  value={command.description}
                  placeholder="Review code for correctness"
                  onChange={(event) =>
                    patch(command.id, { description: event.currentTarget.value })
                  }
                />
              </label>
            </div>

            <label className="field">
              <span>Prompt template</span>
              <textarea
                rows={4}
                value={command.template}
                placeholder="Review $ARGUMENTS for bugs and missing tests."
                onChange={(event) => patch(command.id, { template: event.currentTarget.value })}
              />
            </label>

            <ScopePicker
              bots={bots}
              scope={command.scope}
              botIDs={command.botIDs}
              onChange={(scope, botIDs) => patch(command.id, { scope, botIDs })}
            />
          </div>
        ))
      )}
    </>
  )
}

const skillStatus = (skill: BotSkill) => skill.status ?? "active"

const dateLabel = (time: number) => {
  const date = new Date(time)
  const elapsed = Date.now() - time
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (elapsed < minute) return "just now"
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}d ago`
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  )
}

const usageLabel = (skill: BotSkill) => {
  const uses = skill.uses ?? 0
  if (uses === 0 || !skill.lastUsedAt) return "Never used"
  const times = uses === 1 ? "1 time" : `${uses} times`
  return `Used ${times} · last used ${dateLabel(skill.lastUsedAt)}`
}

export function SkillsEditor({
  bots,
  skills,
  savedIDs,
  onChange,
}: {
  bots: Bot[]
  skills: BotSkill[]
  savedIDs: Set<string>
  onChange: (skills: BotSkill[]) => void
}) {
  const [showArchived, setShowArchived] = useState(false)

  // By position: the ID is one of the fields being edited, so it cannot be the key.
  const patch = (index: number, value: Partial<BotSkill>) =>
    onChange(skills.map((item, at) => (at === index ? { ...item, ...value } : item)))

  const cardKey = (skill: BotSkill, index: number) =>
    savedIDs.has(skill.id) ? `saved:${skill.id}` : `new:${index}`
  const entries = skills.map((skill, index) => ({ skill, index }))
  const drafts = entries.filter(({ skill }) => skillStatus(skill) === "draft")
  const active = entries.filter(({ skill }) => skillStatus(skill) === "active")
  const archived = entries.filter(({ skill }) => skillStatus(skill) === "archived")
  const botName = (id: string) => bots.find((bot) => bot.id === id)?.name
  const meta = (skill: BotSkill) =>
    [skill.author ? `Created by ${botName(skill.author) ?? "Unknown bot"}` : "", usageLabel(skill)]
      .filter(Boolean)
      .join(" · ")

  return (
    <>
      <div className="library-toolbar">
        <p className="hint">
          Skills are real folders in the bot workspace. Each one has a <code>SKILL.md</code> plus
          any references, scripts, or assets it needs. Bots load them by ID with the native skill
          tool.
        </p>
        <button
          className="secondary-button"
          onClick={() => onChange([...skills, newSkill(skills)])}
        >
          <Icon name="plus" size={14} /> Add skill
        </button>
      </div>

      {skills.length === 0 ? (
        <div className="library-empty">
          <Icon name="bot" size={28} />
          <p>No bot skills yet.</p>
          <p className="hint">Add reusable instructions that only bot sessions can use.</p>
        </div>
      ) : (
        <>
          {drafts.length > 0 ? (
            <section className="library-group">
              <div className="library-group-title">
                <span>Proposed by bots</span>
                <span className="library-group-count">{drafts.length}</span>
              </div>
              {drafts.map(({ skill, index }) => {
                const author = skill.author
                  ? bots.find((bot) => bot.id === skill.author)
                  : undefined
                const content = skill.content || "No instructions provided."
                const evidence = skill.evidence || "No evidence recorded."
                return (
                  <div className="library-card skill-draft" key={cardKey(skill, index)}>
                    <div className="library-card-head">
                      <div className="skill-draft-author">
                        {author ? (
                          <Avatar name={author.name} color={author.color} size={18} />
                        ) : (
                          <Icon name="bot" size={15} />
                        )}
                        <span>
                          Proposed by <strong>{author?.name ?? "Unknown bot"}</strong>
                        </span>
                      </div>
                      <div className="skill-draft-actions">
                        <button
                          className="primary-button"
                          aria-label={`Approve ${skill.name || skill.id}`}
                          onClick={() => patch(index, { status: "active" })}
                        >
                          <Icon name="check" size={14} /> Approve
                        </button>
                        <button
                          className="danger-button"
                          aria-label={`Discard ${skill.name || skill.id}`}
                          onClick={() => onChange(skills.filter((_, at) => at !== index))}
                        >
                          <Icon name="trash" size={14} /> Discard
                        </button>
                      </div>
                    </div>

                    <div className="skill-draft-summary">
                      <span className="command-preview">{skill.id || "skill"}</span>
                      <span className="skill-draft-name">{skill.name || "Untitled skill"}</span>
                    </div>
                    <p className="skill-draft-description">
                      {skill.description || "No description provided."}
                    </p>

                    <div className="skill-evidence">
                      <span>Evidence</span>
                      <p>{evidence}</p>
                    </div>

                    <div className="skill-draft-content-wrap">
                      <span>Instructions</span>
                      <pre className="skill-draft-content">{content}</pre>
                    </div>
                  </div>
                )
              })}
            </section>
          ) : null}

          {active.map(({ skill, index }) => {
            const saved = savedIDs.has(skill.id)
            return (
              // Saved IDs are read-only, so they are stable keys; unsaved cards use
              // their position.
              <div className="library-card" key={cardKey(skill, index)}>
                <div className="library-card-head">
                  <span className="command-preview">{skill.id || "skill"}</span>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${skill.id}`}
                    onClick={() => onChange(skills.filter((_, at) => at !== index))}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>

                <p className="skill-meta">{meta(skill)}</p>

                <div className="field-grid">
                  <label className="field">
                    <span>Skill ID{saved ? " (permanent)" : ""}</span>
                    <input
                      value={skill.id}
                      placeholder="release-check"
                      readOnly={saved}
                      title={
                        saved ? "The skill ID is permanent after the library is saved." : undefined
                      }
                      onChange={(event) => patch(index, { id: event.currentTarget.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Display name</span>
                    <input
                      value={skill.name}
                      placeholder="Release check"
                      onChange={(event) => patch(index, { name: event.currentTarget.value })}
                    />
                  </label>
                </div>

                <label className="field">
                  <span>Description</span>
                  <input
                    value={skill.description}
                    placeholder="Use when preparing or checking a release"
                    onChange={(event) => patch(index, { description: event.currentTarget.value })}
                  />
                </label>

                <label className="field">
                  <span>Instructions</span>
                  <textarea
                    rows={6}
                    value={skill.content}
                    placeholder="Write the workflow the bot should follow. Supporting files live beside SKILL.md and are visible to the model when it loads the skill."
                    onChange={(event) => patch(index, { content: event.currentTarget.value })}
                  />
                </label>

                <SupportingFiles
                  skill={skill}
                  saved={saved}
                  onFiles={(files) => patch(index, { files })}
                />

                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={skill.autoinvoke}
                    onChange={(event) => patch(index, { autoinvoke: event.currentTarget.checked })}
                  />
                  Let bots discover this skill from its description
                </label>

                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={skill.pinned ?? false}
                    onChange={(event) => patch(index, { pinned: event.currentTarget.checked })}
                  />
                  Pinned — bots can't change or delete it
                </label>

                <ScopePicker
                  bots={bots}
                  scope={skill.scope}
                  botIDs={skill.botIDs}
                  onChange={(scope, botIDs) => patch(index, { scope, botIDs })}
                />
              </div>
            )
          })}

          {archived.length > 0 ? (
            <section className="library-group library-archived">
              <button
                className="library-group-head"
                aria-expanded={showArchived}
                onClick={() => setShowArchived((value) => !value)}
              >
                <span>Archived</span>
                <span className="library-group-count">{archived.length}</span>
                <span className="library-group-toggle">{showArchived ? "Hide" : "Show"}</span>
              </button>
              {showArchived ? (
                <div className="library-archived-list">
                  {archived.map(({ skill, index }) => (
                    <div className="library-archived-row" key={cardKey(skill, index)}>
                      <div className="library-archived-info">
                        <div className="library-archived-title">
                          <span className="command-preview">{skill.id || "skill"}</span>
                          <span className="library-archived-name">
                            {skill.name || "Untitled skill"}
                          </span>
                        </div>
                        <span className="skill-meta">{meta(skill)}</span>
                      </div>
                      <button
                        className="secondary-button"
                        aria-label={`Restore ${skill.name || skill.id}`}
                        onClick={() => patch(index, { status: "active" })}
                      >
                        Restore
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Delete ${skill.id}`}
                        onClick={() => onChange(skills.filter((_, at) => at !== index))}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </>
  )
}

const formatBytes = (size: number) => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(reader.error ?? new Error("Could not read that file."))
    reader.readAsDataURL(file)
  })

const fileBytes = (data: { encoding: "utf8" | "base64"; content: string }) => {
  if (data.encoding === "utf8") return new TextEncoder().encode(data.content)
  const binary = atob(data.content)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function SupportingFiles({
  skill,
  saved,
  onFiles,
}: {
  skill: BotSkill
  saved: boolean
  onFiles: (files: SkillFile[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const uploadRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  const upload = async (list: FileList | null) => {
    if (!list || !saved) return
    setBusy(true)
    setError(null)
    try {
      const entries = Array.from(list).map((file) => ({
        file,
        path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      }))
      // A folder picker prefixes every path with the selected folder's name.
      // Strip it when it is common to the whole selection.
      const first = entries[0]?.path.split("/")[0]
      const strip =
        first && entries.every((entry) => entry.path.startsWith(`${first}/`)) ? `${first}/` : ""
      let files = skill.files
      for (const entry of entries) {
        const path = entry.path.startsWith(strip) ? entry.path.slice(strip.length) : entry.path
        if (!path || path.split("/").pop() === "SKILL.md") continue
        const content = await fileToBase64(entry.file)
        files = (await botsApi.writeSkillFile(skill.id, path, content, "base64")).files
      }
      onFiles(files)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      if (uploadRef.current) uploadRef.current.value = ""
      if (folderRef.current) folderRef.current.value = ""
    }
  }

  const edit = async (file: SkillFile) => {
    setError(null)
    try {
      const data = await botsApi.readSkillFile(skill.id, file.path)
      if (data.encoding !== "utf8") {
        setError("That file is binary. Download it instead of editing it here.")
        return
      }
      setEditing(file.path)
      setDraft(data.content)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const save = async () => {
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      const result = await botsApi.writeSkillFile(skill.id, editing, draft, "utf8")
      onFiles(result.files)
      setEditing(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (file: SkillFile) => {
    if (!confirm(`Delete ${file.path} from ${skill.name}?`)) return
    setBusy(true)
    setError(null)
    try {
      const result = await botsApi.deleteSkillFile(skill.id, file.path)
      onFiles(result.files)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const download = async (file: SkillFile) => {
    setError(null)
    try {
      const data = await botsApi.readSkillFile(skill.id, file.path)
      const blob = new Blob([fileBytes(data)])
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = file.path.split("/").pop() || "skill-file"
      link.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="skill-files">
      <div className="skill-files-head">
        <div>
          <span>Supporting files</span>
          <p className="hint">
            References, scripts, and assets. Paths inside the skill are relative to this folder.
          </p>
        </div>
        {saved ? (
          <div className="skill-files-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => uploadRef.current?.click()}
            >
              <Icon name="plus" size={13} /> Add files
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => folderRef.current?.click()}
            >
              Add folder
            </button>
          </div>
        ) : (
          <span className="hint">Save the library once to add files.</span>
        )}
      </div>

      <input
        ref={uploadRef}
        type="file"
        multiple
        hidden
        onChange={(event) => void upload(event.currentTarget.files)}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        hidden
        {...({ webkitdirectory: "true", directory: "true" } as Record<string, string>)}
        onChange={(event) => void upload(event.currentTarget.files)}
      />

      {skill.files.length === 0 ? (
        <p className="hint skill-files-empty">No supporting files yet.</p>
      ) : (
        <div className="skill-file-list">
          {skill.files.map((file) => (
            <div className="skill-file-row" key={file.path}>
              <button
                className="skill-file-name"
                title={`Edit ${file.path}`}
                onClick={() => void edit(file)}
              >
                <Icon name="command" size={13} />
                <code>{file.path}</code>
              </button>
              <span className="skill-file-size">{formatBytes(file.size)}</span>
              <button
                className="icon-button"
                aria-label={`Download ${file.path}`}
                onClick={() => void download(file)}
              >
                <Icon name="back" size={14} />
              </button>
              <button
                className="icon-button"
                aria-label={`Delete ${file.path}`}
                onClick={() => void remove(file)}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <div className="skill-file-editor">
          <div className="skill-file-editor-head">
            <code>{editing}</code>
            <button className="link-button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
          <textarea
            rows={8}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <div className="skill-file-editor-actions">
            <button className="primary-button" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save file"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
    </div>
  )
}

function ScopePicker({
  bots,
  scope,
  botIDs,
  onChange,
}: {
  bots: Bot[]
  scope: LibraryScope
  botIDs: string[]
  onChange: (scope: LibraryScope, botIDs: string[]) => void
}) {
  const selected = new Set(botIDs)

  return (
    <div className="scope-section">
      <div className="scope-head">
        <span>Available to</span>
        <select
          value={scope}
          onChange={(event) => {
            const next = event.currentTarget.value as LibraryScope
            onChange(next, next === "all" ? [] : botIDs)
          }}
        >
          <option value="all">All bots</option>
          <option value="selected">Selected bots</option>
        </select>
      </div>

      {scope === "selected" ? (
        bots.length === 0 ? (
          <p className="hint">Create a bot first.</p>
        ) : (
          <div className="scope-bots">
            {bots.map((bot) => {
              const active = selected.has(bot.id)
              return (
                <button
                  key={bot.id}
                  className={`scope-chip${active ? " active" : ""}`}
                  onClick={() => {
                    const next = new Set(selected)
                    if (next.has(bot.id)) next.delete(bot.id)
                    else next.add(bot.id)
                    onChange("selected", [...next])
                  }}
                >
                  <Avatar name={bot.name} color={bot.color} size={16} />
                  {bot.name}
                </button>
              )
            })}
          </div>
        )
      ) : (
        <p className="hint">Every bot and group host can use this.</p>
      )}
    </div>
  )
}
