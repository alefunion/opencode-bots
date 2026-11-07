import { useEffect, useMemo, useRef, useState } from "react"
import type { Bot, BotCommand, PromptAttachment } from "../types"
import { Avatar } from "./Avatar"
import { Icon } from "../icons"

const MAX_FILES = 10
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 25 * 1024 * 1024

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`))
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.readAsDataURL(file)
  })
}

/**
 * Arrow keys, Enter/Tab, and Escape for an open autocomplete menu. Returns true
 * when the key was handled.
 */
function menuKey<T>(
  event: React.KeyboardEvent,
  items: T[],
  index: number,
  actions: { move: (index: number) => void; choose: (item: T) => void; close: () => void },
) {
  if (items.length === 0) return false
  const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
  if (step) actions.move((index + step + items.length) % items.length)
  else if (event.key === "Enter" || event.key === "Tab") {
    const item = items[index]
    if (item) actions.choose(item)
  } else if (event.key === "Escape") actions.close()
  else return false
  event.preventDefault()
  return true
}

export function Composer({
  bot,
  bots,
  commands,
  onSend,
}: {
  bot: Bot
  bots: Bot[]
  commands: BotCommand[]
  onSend: (text: string, files: PromptAttachment[]) => void
}) {
  const [text, setText] = useState("")
  const [attachments, setAttachments] = useState<PromptAttachment[]>([])
  const [reading, setReading] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [mention, setMention] = useState<{ query: string; start: number; index: number } | null>(
    null,
  )
  const [commandMenu, setCommandMenu] = useState<{ query: string; index: number } | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const candidates = useMemo(() => {
    if (!mention) return []
    const value = mention.query.toLowerCase()
    return bots
      .filter((item) => item.id !== bot.id)
      .filter(
        (item) =>
          !value ||
          item.handle.toLowerCase().includes(value) ||
          item.name.toLowerCase().includes(value),
      )
      .slice(0, 8)
  }, [bots, bot.id, mention])

  const commandCandidates = useMemo(() => {
    if (!commandMenu) return []
    const value = commandMenu.query.toLowerCase()
    return commands
      .filter(
        (item) =>
          !value ||
          item.name.toLowerCase().includes(value) ||
          item.description.toLowerCase().includes(value),
      )
      .slice(0, 8)
  }, [commands, commandMenu])

  useEffect(() => {
    const element = area.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(180, element.scrollHeight)}px`
  }, [text])

  useEffect(() => {
    if (!mention) return
    if (candidates.length > 0 && mention.index >= candidates.length) {
      setMention({ ...mention, index: 0 })
    }
  }, [candidates.length, mention])

  useEffect(() => {
    if (!commandMenu) return
    if (commandCandidates.length > 0 && commandMenu.index >= commandCandidates.length) {
      setCommandMenu({ ...commandMenu, index: 0 })
    }
  }, [commandCandidates.length, commandMenu])

  const detectMention = (value: string, cursor: number) => {
    const before = value.slice(0, cursor)
    const match = /(?:^|\s)@([a-z0-9_-]*)$/i.exec(before)
    if (!match) {
      setMention(null)
      return
    }
    const start = before.length - match[1]!.length - 1
    setMention({ query: match[1] ?? "", start, index: 0 })
  }

  const detectCommand = (value: string, cursor: number) => {
    const before = value.slice(0, cursor)
    const match = /^\/([a-z0-9-]*)$/i.exec(before)
    if (!match) {
      setCommandMenu(null)
      return
    }
    setCommandMenu({ query: match[1] ?? "", index: 0 })
  }

  const choose = (candidate: Bot) => {
    if (!mention) return
    const cursor = area.current?.selectionStart ?? text.length
    const next = `${text.slice(0, mention.start)}@${candidate.handle} ${text.slice(cursor)}`
    setText(next)
    setMention(null)
    requestAnimationFrame(() => {
      const element = area.current
      if (!element) return
      const position = mention.start + candidate.handle.length + 2
      element.focus()
      element.setSelectionRange(position, position)
    })
  }

  const chooseCommand = (candidate: BotCommand) => {
    if (!commandMenu) return
    const cursor = area.current?.selectionStart ?? text.length
    const after = text.slice(cursor).replace(/^\s+/, "")
    const next = `/${candidate.name} ${after}`
    setText(next)
    setCommandMenu(null)
    requestAnimationFrame(() => {
      const element = area.current
      if (!element) return
      const position = candidate.name.length + 2
      element.focus()
      element.setSelectionRange(position, position)
    })
  }

  const addFiles = async (incoming: File[]) => {
    if (incoming.length === 0) return
    setAttachmentError(null)

    const room = MAX_FILES - attachments.length
    if (room <= 0) {
      setAttachmentError(`You can attach up to ${MAX_FILES} files.`)
      return
    }

    const accepted: File[] = []
    let total = attachments.reduce((sum, file) => sum + file.size, 0)
    for (const file of incoming.slice(0, room)) {
      if (file.size > MAX_FILE_BYTES) {
        setAttachmentError(`${file.name} is larger than 10 MB.`)
        continue
      }
      if (total + file.size > MAX_TOTAL_BYTES) {
        setAttachmentError("Attachments are larger than 25 MB in total.")
        break
      }
      total += file.size
      accepted.push(file)
    }
    if (accepted.length === 0) return

    setReading(true)
    try {
      const next = await Promise.all(
        accepted.map(async (file) => ({
          id: crypto.randomUUID(),
          name: file.name || "Attachment",
          mime: file.type || "application/octet-stream",
          size: file.size,
          dataUrl: await readDataUrl(file),
        })),
      )
      setAttachments((current) => [...current, ...next].slice(0, MAX_FILES))
    } catch (cause) {
      setAttachmentError(cause instanceof Error ? cause.message : "Could not attach that file.")
    } finally {
      setReading(false)
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((file) => file.id !== id))
    setAttachmentError(null)
  }

  const send = () => {
    const value = text.trim()
    if ((!value && attachments.length === 0) || reading) return
    onSend(value, attachments)
    setText("")
    setAttachments([])
    setAttachmentError(null)
    setMention(null)
    setCommandMenu(null)
    requestAnimationFrame(() => area.current?.focus())
  }

  return (
    <div className="composer-wrap">
      {commandMenu && commandCandidates.length > 0 ? (
        <div className="mention-menu">
          {commandCandidates.map((candidate, index) => (
            <button
              key={candidate.id}
              className={`mention-item${index === commandMenu.index ? " active" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault()
                chooseCommand(candidate)
              }}
            >
              <span className="command-name">/{candidate.name}</span>
              <span className="command-description">{candidate.description || "Bot command"}</span>
            </button>
          ))}
        </div>
      ) : null}

      {mention && candidates.length > 0 ? (
        <div className="mention-menu">
          {candidates.map((candidate, index) => (
            <button
              key={candidate.id}
              className={`mention-item${index === mention.index ? " active" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault()
                choose(candidate)
              }}
            >
              <Avatar name={candidate.name} color={candidate.color} size={26} />
              <span>{candidate.name}</span>
              <span className="mention-handle">@{candidate.handle}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div
        className={`composer${dragging ? " dragging" : ""}`}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void addFiles([...event.dataTransfer.files])
        }}
      >
        {attachments.length > 0 || attachmentError || reading ? (
          <div className="composer-attachments">
            {attachments.map((file) => (
              <div className="composer-attachment" key={file.id}>
                {file.mime.startsWith("image/") ? (
                  <img className="composer-attachment-image" src={file.dataUrl} alt="" />
                ) : (
                  <span className="composer-attachment-name" title={file.name}>
                    {file.name}
                  </span>
                )}
                <button
                  type="button"
                  className="composer-attachment-remove"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => removeAttachment(file.id)}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
            {reading ? <span className="composer-attachment-reading">Attaching…</span> : null}
            {attachmentError ? <span className="composer-error">{attachmentError}</span> : null}
          </div>
        ) : null}
        <textarea
          ref={area}
          rows={1}
          value={text}
          placeholder={`Message ${bot.name}…`}
          onChange={(event) => {
            const value = event.currentTarget.value
            setText(value)
            detectCommand(value, event.currentTarget.selectionStart ?? value.length)
            detectMention(value, event.currentTarget.selectionStart ?? value.length)
          }}
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files]
            if (pasted.length === 0) return
            event.preventDefault()
            void addFiles(pasted)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "u") {
              event.preventDefault()
              fileInput.current?.click()
              return
            }
            if (
              commandMenu &&
              menuKey(event, commandCandidates, commandMenu.index, {
                move: (index) => setCommandMenu({ ...commandMenu, index }),
                choose: chooseCommand,
                close: () => setCommandMenu(null),
              })
            ) {
              return
            }
            if (
              mention &&
              menuKey(event, candidates, mention.index, {
                move: (index) => setMention({ ...mention, index }),
                choose,
                close: () => setMention(null),
              })
            ) {
              return
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div className="composer-actions">
          <button
            type="button"
            className="composer-attach"
            onClick={() => fileInput.current?.click()}
            title="Add images and files"
            aria-label="Add images and files"
          >
            <Icon name="plus-sm" size={16} />
          </button>
          <button
            className="send-button"
            onClick={send}
            disabled={(!text.trim() && attachments.length === 0) || reading}
            title="Send"
            aria-label="Send"
          >
            <Icon name="send" size={16} />
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])]
            event.currentTarget.value = ""
            void addFiles(files)
          }}
        />
      </div>
    </div>
  )
}
