import { useMemo, useState } from "react"
import { botsApi } from "../api"
import type { Bot, BotsState, Job, Task, TaskInput, TaskStatus } from "../types"
import { describeCron, nextRun, parseCron, validTimeZone } from "../../../plugin/src/schedule"
import { Avatar } from "./Avatar"
import { Icon } from "../icons"

type Props = {
  state: BotsState
  onRefresh: () => Promise<void>
  onToast: (message: string, variant?: "success" | "error") => void
}

const COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: "todo", label: "To do" },
  { status: "doing", label: "In progress" },
  { status: "done", label: "Done" },
]

const PRESETS = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every morning", cron: "0 9 * * *" },
  { label: "Weekdays", cron: "0 9 * * 1-5" },
  { label: "Mondays", cron: "0 9 * * 1" },
  { label: "Monthly", cron: "0 9 1 * *" },
]

const DAY = 24 * 60 * 60 * 1000

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

/** "Today 09:00", "Tomorrow 09:00", or "Mon, Nov 9 09:00", in the device's time zone. */
const whenLabel = (time: number) => {
  const date = new Date(time)
  const now = new Date()
  const clock = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY)
  if (days === 0) return `Today ${clock}`
  if (days === 1) return `Tomorrow ${clock}`
  if (days === -1) return `Yesterday ${clock}`
  const day = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  })
  return `${day} ${clock}`
}

const pad = (value: number) => String(value).padStart(2, "0")

/** A timestamp as a `datetime-local` value in the device's time zone. */
const toLocalInput = (time: number) => {
  if (!time) return ""
  const date = new Date(time)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const fromLocalInput = (value: string) => {
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

const errorMessage = (cause: unknown) =>
  (cause instanceof Error ? cause.message : String(cause)).replace(/^Error:\s*/, "")

function BotFilter({
  bots,
  value,
  onChange,
}: {
  bots: Bot[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <select
      className="planner-filter"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      aria-label="Filter by bot"
    >
      <option value="">All bots</option>
      {bots.map((bot) => (
        <option key={bot.id} value={bot.id}>
          {bot.name}
        </option>
      ))}
    </select>
  )
}

function BotLabel({ bot, author, bots }: { bot?: Bot; author?: string; bots: Bot[] }) {
  const creator = author ? bots.find((item) => item.id === author) : undefined
  return (
    <span className="planner-bot">
      {bot ? <Avatar name={bot.name} color={bot.color} face={bot.face} size={16} /> : null}
      <span>{bot?.name ?? "Unknown bot"}</span>
      {creator && creator.id !== bot?.id ? (
        <span className="planner-muted">· by {creator.name}</span>
      ) : null}
    </span>
  )
}

type TaskDraft = {
  id?: string
  botID: string
  title: string
  notes: string
  status: TaskStatus
  wake: string
}

const taskDraft = (task: Task): TaskDraft => ({
  id: task.id,
  botID: task.botID,
  title: task.title,
  notes: task.notes,
  status: task.status,
  wake: toLocalInput(task.wakeAt),
})

/** In progress first, then soonest wake time, then most recently changed; done by completion. */
const taskOrder = (a: Task, b: Task) =>
  a.status === "done" && b.status === "done"
    ? b.doneAt - a.doneAt
    : (a.wakeAt || Infinity) - (b.wakeAt || Infinity) || b.updatedAt - a.updatedAt

export function TasksBoard({ state, onRefresh, onToast }: Props) {
  const [filter, setFilter] = useState("")
  const [draft, setDraft] = useState<TaskDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const defaultBot = filter || state.coordinatorID || state.bots[0]?.id || ""
  const tasks = useMemo(
    () => state.tasks.filter((task) => !filter || task.botID === filter).sort(taskOrder),
    [filter, state.tasks],
  )

  const patch = (value: Partial<TaskDraft>) =>
    setDraft((current) => (current ? { ...current, ...value } : current))

  const persist = async (input: TaskInput) => {
    setSaving(true)
    setError(null)
    try {
      await botsApi.saveTask(input)
      await onRefresh()
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      onToast("Could not save the task", "error")
      return false
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    if (!draft || !draft.title.trim()) return
    const { wake, ...input } = draft
    if (await persist({ ...input, wakeAt: fromLocalInput(wake) })) {
      onToast(draft.id ? "Task saved" : "Task added", "success")
      setDraft(null)
    }
  }

  const move = async (task: Task, status: TaskStatus) => {
    const { id, botID, title, notes, wakeAt } = task
    if (await persist({ id, botID, title, notes, status, wakeAt })) {
      onToast(`Moved to ${COLUMNS.find((column) => column.status === status)?.label}`, "success")
    }
  }

  const remove = async () => {
    if (!draft?.id) return
    if (!confirm(`Delete the task "${draft.title}"?`)) return
    setSaving(true)
    try {
      await botsApi.removeTask(draft.id)
      await onRefresh()
      setDraft(null)
      onToast("Task deleted", "success")
    } catch (cause) {
      setError(errorMessage(cause))
      onToast("Could not delete the task", "error")
    } finally {
      setSaving(false)
    }
  }

  const form = (current: TaskDraft) => (
    <div className="library-card task-form">
      <label className="field">
        <span>Title</span>
        <input
          autoFocus
          value={current.title}
          placeholder="Follow up on the release notes"
          onChange={(event) => patch({ title: event.currentTarget.value })}
        />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>Bot</span>
          <select
            value={current.botID}
            onChange={(event) => patch({ botID: event.currentTarget.value })}
          >
            {state.bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select
            value={current.status}
            onChange={(event) => patch({ status: event.currentTarget.value as TaskStatus })}
          >
            {COLUMNS.map((column) => (
              <option key={column.status} value={column.status}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {current.status !== "done" ? (
        <div className="field">
          <span>Wake the bot at</span>
          <div className="planner-wake">
            <input
              type="datetime-local"
              value={current.wake}
              onChange={(event) => patch({ wake: event.currentTarget.value })}
            />
            {current.wake ? (
              <button className="secondary-button" onClick={() => patch({ wake: "" })}>
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <label className="field">
        <span>Notes</span>
        <textarea
          rows={3}
          value={current.notes}
          placeholder="Context the bot needs when it picks this up."
          onChange={(event) => patch({ notes: event.currentTarget.value })}
        />
      </label>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="planner-form-actions">
        {current.id ? (
          <button className="danger-button" onClick={() => void remove()} disabled={saving}>
            <Icon name="trash" size={14} /> Delete
          </button>
        ) : null}
        <button className="secondary-button" onClick={() => setDraft(null)} disabled={saving}>
          Cancel
        </button>
        <button
          className="primary-button"
          onClick={() => void save()}
          disabled={saving || !current.title.trim() || !current.botID}
        >
          {saving ? "Saving…" : current.id ? "Save" : "Add task"}
        </button>
      </div>
    </div>
  )

  if (state.bots.length === 0) {
    return (
      <div className="library-empty">
        <Icon name="check" size={28} />
        <p>Create a bot before adding tasks.</p>
      </div>
    )
  }

  return (
    <>
      <div className="library-toolbar">
        <p className="hint">
          Each bot keeps its own board and manages it with <code>bots_task</code>; the coordinator
          sees everyone's. A wake time reminds the bot in its chat at that moment.
        </p>
        <div className="planner-toolbar-actions">
          <BotFilter bots={state.bots} value={filter} onChange={setFilter} />
          <button
            className="secondary-button"
            onClick={() => {
              setError(null)
              setDraft({ botID: defaultBot, title: "", notes: "", status: "todo", wake: "" })
            }}
          >
            <Icon name="plus" size={14} /> Add task
          </button>
        </div>
      </div>

      <div className="task-board">
        {COLUMNS.map((column) => {
          const items = tasks.filter((task) => task.status === column.status)
          return (
            <section className="task-column" key={column.status}>
              <div className="library-group-title">
                <span>{column.label}</span>
                <span className="library-group-count">{items.length}</span>
              </div>
              {draft && !draft.id && column.status === "todo" ? form(draft) : null}
              {items.map((task) =>
                draft?.id === task.id ? (
                  <div key={task.id}>{form(draft)}</div>
                ) : (
                  <TaskCard
                    key={task.id}
                    task={task}
                    bots={state.bots}
                    disabled={saving}
                    onEdit={() => {
                      setError(null)
                      setDraft(taskDraft(task))
                    }}
                    onMove={(status) => void move(task, status)}
                  />
                ),
              )}
              {items.length === 0 && !(draft && !draft.id && column.status === "todo") ? (
                <p className="task-column-empty">Nothing here.</p>
              ) : null}
            </section>
          )
        })}
      </div>
    </>
  )
}

function TaskCard({
  task,
  bots,
  disabled,
  onEdit,
  onMove,
}: {
  task: Task
  bots: Bot[]
  disabled: boolean
  onEdit: () => void
  onMove: (status: TaskStatus) => void
}) {
  const bot = bots.find((item) => item.id === task.botID)
  const overdue = task.wakeAt > 0 && task.wakeAt < Date.now()
  const next: { status: TaskStatus; label: string } =
    task.status === "todo"
      ? { status: "doing", label: "Start" }
      : task.status === "doing"
        ? { status: "done", label: "Done" }
        : { status: "todo", label: "Reopen" }
  return (
    <article className={`task-card${task.status === "done" ? " done" : ""}`}>
      <button className="task-card-main" onClick={onEdit} aria-label={`Edit ${task.title}`}>
        <strong>{task.title}</strong>
        {task.notes ? <span className="task-card-notes">{task.notes}</span> : null}
      </button>
      <div className="task-card-meta">
        <BotLabel bot={bot} author={task.author} bots={bots} />
        {task.wakeAt ? (
          <span className={`planner-pill${overdue ? " due" : ""}`}>
            {overdue ? "Waking" : "Wakes"} {whenLabel(task.wakeAt)}
          </span>
        ) : task.status === "done" && task.doneAt ? (
          <span className="planner-muted">{whenLabel(task.doneAt)}</span>
        ) : null}
        <button
          className="link-button task-card-move"
          disabled={disabled}
          onClick={() => onMove(next.status)}
        >
          {next.label}
        </button>
      </div>
    </article>
  )
}

type JobDraft = {
  id?: string
  botID: string
  name: string
  prompt: string
  cron: string
  timeZone: string
  enabled: boolean
  notify: boolean
}

const jobDraft = (job: Job): JobDraft => ({
  id: job.id,
  botID: job.botID,
  name: job.name,
  prompt: job.prompt,
  cron: job.cron,
  timeZone: job.timeZone,
  enabled: job.enabled,
  notify: job.notify,
})

/** The next few runs, or a readable problem with the expression or time zone. */
const preview = (cron: string, timeZone: string) => {
  if (!cron.trim()) return { error: "Enter a cron expression or pick a preset." }
  if (!validTimeZone(timeZone)) return { error: `"${timeZone}" is not a time zone.` }
  try {
    const parsed = parseCron(cron)
    const runs: number[] = []
    let after = Date.now()
    for (let index = 0; index < 3; index += 1) {
      const next = nextRun(parsed, after, timeZone)
      if (next === null) break
      runs.push(next)
      after = next
    }
    if (runs.length === 0) return { error: "This expression never runs." }
    if (runs.length > 1 && runs[1]! - runs[0]! < 5 * 60_000) {
      return { error: "A job can run at most once every 5 minutes." }
    }
    return { runs }
  } catch (cause) {
    return { error: errorMessage(cause) }
  }
}

const timeZones = (() => {
  try {
    return Intl.supportedValuesOf("timeZone")
  } catch {
    return []
  }
})()

export function JobsEditor({ state, onRefresh, onToast }: Props) {
  const [filter, setFilter] = useState("")
  const [draft, setDraft] = useState<JobDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const jobs = state.jobs.filter((job) => !filter || job.botID === filter)
  const check = draft ? preview(draft.cron, draft.timeZone) : null

  const patch = (value: Partial<JobDraft>) =>
    setDraft((current) => (current ? { ...current, ...value } : current))

  const persist = async (input: JobDraft) => {
    setSaving(true)
    setError(null)
    try {
      await botsApi.saveJob({
        ...(input.id ? { id: input.id } : {}),
        botID: input.botID,
        name: input.name,
        prompt: input.prompt,
        cron: input.cron,
        timeZone: input.timeZone,
        enabled: input.enabled,
        notify: input.notify,
      })
      await onRefresh()
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      onToast("Could not save the job", "error")
      return false
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    if (!draft) return
    if (await persist(draft)) {
      onToast(draft.id ? "Job saved" : "Job scheduled", "success")
      setDraft(null)
    }
  }

  const toggle = async (job: Job) => {
    if (await persist({ ...jobDraft(job), enabled: !job.enabled })) {
      onToast(job.enabled ? `${job.name} paused` : `${job.name} resumed`, "success")
    }
  }

  const run = async (job: Job) => {
    setSaving(true)
    try {
      await botsApi.runJob(job.id)
      await onRefresh()
      const bot = state.bots.find((item) => item.id === job.botID)
      onToast(`${job.name} queued in ${bot?.name ?? "its bot"}'s chat`, "success")
    } catch (cause) {
      onToast(`Could not run ${job.name}: ${errorMessage(cause)}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!draft?.id) return
    if (!confirm(`Delete the job "${draft.name}"?`)) return
    setSaving(true)
    try {
      await botsApi.removeJob(draft.id)
      await onRefresh()
      setDraft(null)
      onToast("Job deleted", "success")
    } catch (cause) {
      setError(errorMessage(cause))
      onToast("Could not delete the job", "error")
    } finally {
      setSaving(false)
    }
  }

  const form = (current: JobDraft) => (
    <div className="library-card job-form">
      <div className="field-grid">
        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            value={current.name}
            placeholder="Morning briefing"
            onChange={(event) => patch({ name: event.currentTarget.value })}
          />
        </label>
        <label className="field">
          <span>Bot</span>
          <select
            value={current.botID}
            onChange={(event) => patch({ botID: event.currentTarget.value })}
          >
            {state.bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Prompt</span>
        <textarea
          rows={4}
          value={current.prompt}
          placeholder="Summarize what changed in my repositories since yesterday and flag anything that needs me."
          onChange={(event) => patch({ prompt: event.currentTarget.value })}
        />
      </label>
      <div className="field">
        <span>Schedule</span>
        <div className="scope-bots">
          {PRESETS.map((item) => (
            <button
              key={item.cron}
              className={`scope-chip${current.cron === item.cron ? " active" : ""}`}
              onClick={() => patch({ cron: item.cron })}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field-grid">
        <label className="field">
          <span>Cron expression</span>
          <input
            className="mono-input"
            value={current.cron}
            placeholder="0 9 * * 1-5"
            onChange={(event) => patch({ cron: event.currentTarget.value })}
          />
        </label>
        <label className="field">
          <span>Time zone</span>
          <input
            list="planner-time-zones"
            value={current.timeZone}
            onChange={(event) => patch({ timeZone: event.currentTarget.value })}
          />
          <datalist id="planner-time-zones">
            {timeZones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </label>
      </div>
      {check?.error ? (
        <p className="error-text">{check.error}</p>
      ) : check?.runs ? (
        <p className="hint">
          {describeCron(current.cron)} · next {check.runs.map(whenLabel).join(", ")}
        </p>
      ) : null}
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={current.enabled}
          onChange={(event) => patch({ enabled: event.currentTarget.checked })}
        />
        Enabled
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={current.notify}
          onChange={(event) => patch({ notify: event.currentTarget.checked })}
        />
        Notify me when a run finishes
      </label>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="planner-form-actions">
        {current.id ? (
          <button className="danger-button" onClick={() => void remove()} disabled={saving}>
            <Icon name="trash" size={14} /> Delete
          </button>
        ) : null}
        <button className="secondary-button" onClick={() => setDraft(null)} disabled={saving}>
          Cancel
        </button>
        <button
          className="primary-button"
          onClick={() => void save()}
          disabled={saving || !current.name.trim() || !current.prompt.trim() || !!check?.error}
        >
          {saving ? "Saving…" : current.id ? "Save" : "Schedule job"}
        </button>
      </div>
    </div>
  )

  if (state.bots.length === 0) {
    return (
      <div className="library-empty">
        <Icon name="command" size={28} />
        <p>Create a bot before scheduling jobs.</p>
      </div>
    )
  }

  return (
    <>
      <div className="library-toolbar">
        <p className="hint">
          A job posts its prompt into a bot's chat on a schedule, and the bot replies to it. Bots
          create jobs with <code>bots_job</code> when you ask for something recurring.
        </p>
        <div className="planner-toolbar-actions">
          <BotFilter bots={state.bots} value={filter} onChange={setFilter} />
          <button
            className="secondary-button"
            onClick={() => {
              setError(null)
              setDraft({
                botID: filter || state.coordinatorID || state.bots[0]?.id || "",
                name: "",
                prompt: "",
                cron: "0 9 * * *",
                timeZone: state.timeZone,
                enabled: true,
                notify: true,
              })
            }}
          >
            <Icon name="plus" size={14} /> Add job
          </button>
        </div>
      </div>

      {draft && !draft.id ? form(draft) : null}

      {jobs.length === 0 && !(draft && !draft.id) ? (
        <div className="library-empty">
          <Icon name="command" size={28} />
          <p>No scheduled jobs{filter ? " for this bot" : ""}.</p>
          <p className="hint">Add one, or ask a bot to do something every morning.</p>
        </div>
      ) : (
        jobs.map((job) =>
          draft?.id === job.id ? (
            <div key={job.id}>{form(draft)}</div>
          ) : (
            <JobCard
              key={job.id}
              job={job}
              bots={state.bots}
              disabled={saving}
              onEdit={() => {
                setError(null)
                setDraft(jobDraft(job))
              }}
              onToggle={() => void toggle(job)}
              onRun={() => void run(job)}
            />
          ),
        )
      )}
    </>
  )
}

function JobCard({
  job,
  bots,
  disabled,
  onEdit,
  onToggle,
  onRun,
}: {
  job: Job
  bots: Bot[]
  disabled: boolean
  onEdit: () => void
  onToggle: () => void
  onRun: () => void
}) {
  const bot = bots.find((item) => item.id === job.botID)
  return (
    <article className={`library-card job-card${job.enabled ? "" : " paused"}`}>
      <div className="library-card-head">
        <div className="job-card-title">
          <strong>{job.name}</strong>
          <BotLabel bot={bot} author={job.author} bots={bots} />
        </div>
        <div className="job-card-actions">
          <button className="secondary-button" onClick={onRun} disabled={disabled}>
            Run now
          </button>
          <button className="secondary-button" onClick={onToggle} disabled={disabled}>
            {job.enabled ? "Pause" : "Resume"}
          </button>
          <button className="icon-button" onClick={onEdit} aria-label={`Edit ${job.name}`}>
            <Icon name="edit" size={15} />
          </button>
        </div>
      </div>
      <div className="job-card-schedule">
        <span className="command-preview">{describeCron(job.cron)}</span>
        <span className="planner-muted">{job.timeZone}</span>
        {!job.enabled ? (
          <span className="planner-pill">Paused</span>
        ) : job.nextRunAt ? (
          <span className="planner-pill">Next {whenLabel(job.nextRunAt)}</span>
        ) : (
          <span className="planner-pill due">Never runs again</span>
        )}
      </div>
      <p className="job-card-prompt">{job.prompt}</p>
      <p className="skill-meta">
        {job.runs === 0
          ? "Never run"
          : `Ran ${job.runs === 1 ? "once" : `${job.runs} times`} · last ${whenLabel(job.lastRunAt)}`}
        {job.notify ? "" : " · notifications off"}
      </p>
    </article>
  )
}
