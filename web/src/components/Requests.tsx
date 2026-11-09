import { useState, type FormEvent } from "react"
import { requestsApi } from "../api"
import type {
  Bot,
  FormField,
  FormInfo,
  FormReply,
  PendingRequest,
  PermissionRequest,
  Worker,
} from "../types"
import { Avatar } from "./Avatar"

/** Questions and permission prompts a chat's sessions are waiting on, answered in place. */
export function Requests({ requests, onDone }: { requests: PendingRequest[]; onDone: () => void }) {
  return (
    <>
      {requests.map((item) =>
        item.kind === "form" ? (
          <FormCard
            key={`${item.form.id}:${item.form.sessionID}`}
            bot={item.bot}
            form={item.form}
            worker={item.worker}
            onDone={onDone}
          />
        ) : (
          <PermissionCard
            key={`${item.request.id}:${item.request.sessionID}`}
            bot={item.bot}
            request={item.request}
            worker={item.worker}
            onDone={onDone}
          />
        ),
      )}
    </>
  )
}

type Draft = { choice: Record<string, string[]>; text: Record<string, string> }

/** Names the project worker a request comes from, so it is not mistaken for the bot's own. */
function WorkerSource({ worker }: { worker?: Worker }) {
  if (!worker) return null
  const name =
    worker.title || worker.directory.split("/").filter(Boolean).at(-1) || worker.directory
  return (
    <p className="request-worker">
      From project worker <strong>{name}</strong> in <code>{worker.directory}</code>
    </p>
  )
}

function FormCard({
  bot,
  form,
  worker,
  onDone,
}: {
  bot: Bot
  form: FormInfo
  worker?: Worker
  onDone: () => void
}) {
  const question = form.metadata?.kind === "question"
  const [draft, setDraft] = useState<Draft>(() => initialDraft(form.fields))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const answer = collect(form.fields, draft)
  const shown = form.fields.filter((field) => isShown(field, answer))
  const missing = shown.some(
    (field) =>
      field.type !== "external" &&
      field.type !== "boolean" &&
      (question || field.required) &&
      answer[field.key] === undefined,
  )

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const reply: FormReply = {}
    for (const field of shown) {
      const value = answer[field.key]
      if (value !== undefined) reply[field.key] = value
    }
    void run(() => requestsApi.answer(form, reply))
  }

  const pick = (key: string, value: string, multiple: boolean) =>
    setDraft((current) => {
      const previous = current.choice[key] ?? []
      const choice = multiple
        ? previous.includes(value)
          ? previous.filter((item) => item !== value)
          : [...previous, value]
        : [value]
      // A single choice replaces a typed answer; several choices can include one.
      const text = multiple ? current.text : { ...current.text, [key]: "" }
      return { choice: { ...current.choice, [key]: choice }, text }
    })

  const type = (key: string, value: string, single: boolean) =>
    setDraft((current) => ({
      choice: single && value ? { ...current.choice, [key]: [] } : current.choice,
      text: { ...current.text, [key]: value },
    }))

  return (
    <div className="message-row assistant">
      <Avatar name={bot.name} color={bot.color} size={24} />
      <form className="request-card" onSubmit={submit}>
        <span className="bubble-name">
          {bot.name}
          <span className="bubble-handle">@{bot.handle}</span>
          <span className="bubble-tag">
            {question ? (form.fields.length === 1 ? "question" : "questions") : form.title}
          </span>
        </span>
        <WorkerSource worker={worker} />
        {shown.map((field) => (
          <fieldset className="request-field" key={field.key} disabled={busy}>
            {field.title ? <legend>{field.title}</legend> : null}
            {field.description ? <p className="request-question">{field.description}</p> : null}
            <FieldInput field={field} draft={draft} onPick={pick} onType={type} />
          </fieldset>
        ))}
        {error ? <p className="request-error">{error}</p> : null}
        <div className="request-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void run(() => requestsApi.dismiss(form))}
          >
            Dismiss
          </button>
          <button type="submit" className="primary-button" disabled={busy || missing}>
            {question ? "Send answer" : "Submit"}
          </button>
        </div>
      </form>
    </div>
  )
}

function FieldInput({
  field,
  draft,
  onPick,
  onType,
}: {
  field: FormField
  draft: Draft
  onPick: (key: string, value: string, multiple: boolean) => void
  onType: (key: string, value: string, single: boolean) => void
}) {
  const chosen = draft.choice[field.key] ?? []
  const text = draft.text[field.key] ?? ""

  if (field.type === "external") {
    return (
      <a className="request-link" href={field.url} target="_blank" rel="noreferrer">
        Open {field.title ?? "link"}
      </a>
    )
  }

  if (field.type === "boolean") {
    return (
      <label className="request-option">
        <input
          type="checkbox"
          checked={chosen.includes("true")}
          onChange={() => onPick(field.key, chosen.includes("true") ? "false" : "true", false)}
        />
        <span>Yes</span>
      </label>
    )
  }

  if (field.type === "number" || field.type === "integer") {
    return (
      <input
        className="request-text"
        type="number"
        step={field.type === "integer" ? 1 : "any"}
        min={typeof field.minimum === "number" ? field.minimum : undefined}
        max={typeof field.maximum === "number" ? field.maximum : undefined}
        value={text}
        onChange={(event) => onType(field.key, event.currentTarget.value, false)}
      />
    )
  }

  const multiple = field.type === "multiselect"
  const options = field.options ?? []
  const custom = options.length === 0 || field.custom === true

  return (
    <>
      {options.map((option) => (
        <label className="request-option" key={option.value}>
          <input
            type={multiple ? "checkbox" : "radio"}
            name={field.key}
            checked={chosen.includes(option.value)}
            onChange={() => onPick(field.key, option.value, multiple)}
          />
          <span>
            {option.label}
            {option.description ? (
              <span className="request-option-description">{option.description}</span>
            ) : null}
          </span>
        </label>
      ))}
      {custom ? (
        <input
          className="request-text"
          type="text"
          value={text}
          placeholder={
            options.length > 0
              ? "Or type your own answer"
              : ((field.type === "string" ? field.placeholder : undefined) ?? "Your answer")
          }
          aria-label={`${field.title ?? field.key}: your own answer`}
          onChange={(event) => onType(field.key, event.currentTarget.value, !multiple)}
        />
      ) : null}
    </>
  )
}

function PermissionCard({
  bot,
  request,
  worker,
  onDone,
}: {
  bot: Bot
  request: PermissionRequest
  worker?: Worker
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reply = async (decision: "once" | "always" | "reject") => {
    setBusy(true)
    setError(null)
    try {
      await requestsApi.permit(request, decision)
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  return (
    <div className="message-row assistant">
      <Avatar name={bot.name} color={bot.color} size={24} />
      <div className="request-card">
        <span className="bubble-name">
          {bot.name}
          <span className="bubble-handle">@{bot.handle}</span>
          <span className="bubble-tag">permission</span>
        </span>
        <WorkerSource worker={worker} />
        <p className="request-question">
          Wants to use <code>{request.action}</code>
          {request.resources.length > 0 ? " on:" : "."}
        </p>
        {request.resources.length > 0 ? <pre>{request.resources.join("\n")}</pre> : null}
        {request.message ? <p className="request-question">{request.message}</p> : null}
        {error ? <p className="request-error">{error}</p> : null}
        <div className="request-actions">
          <button className="danger-button" disabled={busy} onClick={() => void reply("reject")}>
            Deny
          </button>
          <button className="secondary-button" disabled={busy} onClick={() => void reply("always")}>
            Always allow
          </button>
          <button className="primary-button" disabled={busy} onClick={() => void reply("once")}>
            Allow once
          </button>
        </div>
      </div>
    </div>
  )
}

function initialDraft(fields: readonly FormField[]): Draft {
  const draft: Draft = { choice: {}, text: {} }
  for (const field of fields) {
    if (field.type === "external") continue
    if (field.type === "multiselect") draft.choice[field.key] = [...(field.default ?? [])]
    else if (field.type === "boolean") draft.choice[field.key] = [String(field.default ?? false)]
    else if (field.type === "string" && field.default !== undefined) {
      if (field.options?.some((option) => option.value === field.default)) {
        draft.choice[field.key] = [field.default]
      } else draft.text[field.key] = field.default
    } else if (typeof field.default === "number") draft.text[field.key] = String(field.default)
  }
  return draft
}

/** Each field's answer, or undefined while it has none. */
function collect(fields: readonly FormField[], draft: Draft) {
  const answer: Record<string, FormReply[string] | undefined> = {}
  for (const field of fields) {
    const chosen = draft.choice[field.key] ?? []
    const text = (draft.text[field.key] ?? "").trim()
    if (field.type === "external") continue
    if (field.type === "boolean") answer[field.key] = chosen.includes("true")
    else if (field.type === "number" || field.type === "integer") {
      const value = text ? Number(text) : NaN
      answer[field.key] = Number.isFinite(value) ? value : undefined
    } else if (field.type === "multiselect") {
      const values = text ? [...chosen, text] : chosen
      answer[field.key] = values.length > 0 ? values : undefined
    } else answer[field.key] = text || chosen[0]
  }
  return answer
}

function isShown(field: FormField, answer: Record<string, FormReply[string] | undefined>) {
  if (field.type === "external") return true
  if (field.hidden) return false
  return (field.when ?? []).every((condition) => {
    const equal = answer[condition.key] === condition.value
    return condition.op === "eq" ? equal : !equal
  })
}
