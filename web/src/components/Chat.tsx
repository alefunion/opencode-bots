import { Fragment, useEffect, useRef } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Bot, BotCommand, Group, PendingRequest, PromptAttachment, UiMessage } from "../types"
import { Avatar } from "./Avatar"
import { Composer } from "./Composer"
import { Requests } from "./Requests"
import { Icon } from "../icons"

export function Chat({
  bot,
  bots,
  commands,
  group,
  messages,
  typing,
  streaming,
  requests,
  onAnswered,
  onSend,
  onBack,
}: {
  bot: Bot
  bots: Bot[]
  commands: BotCommand[]
  group?: Group
  messages: UiMessage[]
  typing: boolean
  streaming: string
  requests: PendingRequest[]
  onAnswered: () => void
  onSend: (text: string, files: PromptAttachment[]) => void
  onBack: () => void
}) {
  const end = useRef<HTMLDivElement>(null)
  const members = group ? bots.filter((item) => group.memberIDs.includes(item.id)) : bots
  const title = group?.name ?? bot.name
  const color = group?.color ?? bot.color
  const face = group ? undefined : bot.face

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" })
  }, [messages, streaming, typing, requests.length])

  const visible = messages.filter((message) => message.role !== "synthetic" || message.text.trim())

  return (
    <main className="chat">
      <header className="chat-header">
        <button className="icon-button back-button" onClick={onBack} aria-label="Back to chats">
          <Icon name="back" />
        </button>
        <Avatar name={title} color={color} face={face} size={28} />
        <div className="chat-title">
          <div className="chat-name-row">
            <div className="chat-name">{title}</div>
            {group ? <span className="chat-kind">Group</span> : null}
          </div>
          {group ? (
            <div className="chat-subtitle">
              {bot.name} hosting
              <span className="dot-separator">·</span>
              {members.length} {members.length === 1 ? "member" : "members"}
            </div>
          ) : null}
        </div>
      </header>

      <div className="messages">
        {visible.length === 0 ? (
          <div className="chat-empty">
            <Avatar name={title} color={color} face={face} size={48} />
            <h2>{title}</h2>
            <p>
              {group
                ? group.description.trim() || `${bot.name} is hosting this group.`
                : bot.role.trim() || `Start a conversation with @${bot.handle}.`}
            </p>
            {group ? (
              <div className="member-chips">
                {members.map((member) => (
                  <span className="member-chip" key={member.id}>
                    <Avatar name={member.name} color={member.color} face={member.face} size={16} />@
                    {member.handle}
                  </span>
                ))}
              </div>
            ) : null}
            <span className="chat-empty-hint">
              {group
                ? "Mention a member with @handle; the host routes the message."
                : "Mention another bot with @handle to bring it into the conversation."}
              {commands.length > 0 ? " Type / to use a bot command." : ""}
            </span>
          </div>
        ) : (
          visible.map((message, index) => {
            const previous = visible[index - 1]
            const showDay = !previous || dayKey(previous.time) !== dayKey(message.time)
            return (
              <Fragment key={message.id}>
                {showDay ? <DaySeparator time={message.time} /> : null}
                {message.role === "synthetic" && message.scheduled ? (
                  <ScheduledNote message={message} />
                ) : message.role === "synthetic" ? (
                  <div className="system-note">{message.text}</div>
                ) : message.role === "user" ? (
                  <div className="message-row user">
                    <div className="bubble user-bubble">
                      {message.files && message.files.length > 0 ? (
                        <div className="bubble-files">
                          {message.files.map((file, fileIndex) =>
                            file.mime.startsWith("image/") && file.data ? (
                              <img
                                key={`${file.name}-${fileIndex}`}
                                className="bubble-image"
                                src={`data:${file.mime};base64,${file.data}`}
                                alt={file.name}
                              />
                            ) : (
                              <span key={`${file.name}-${fileIndex}`} className="bubble-file">
                                {file.name}
                              </span>
                            ),
                          )}
                        </div>
                      ) : null}
                      {message.text ? <MessageText text={message.text} /> : null}
                      <span className="bubble-time">{timeLabel(message.time)}</span>
                    </div>
                  </div>
                ) : message.role === "member" ? (
                  <MemberBubble message={message} bots={bots} />
                ) : (
                  <div className="message-row assistant">
                    <Avatar name={bot.name} color={bot.color} face={bot.face} size={24} />
                    <div className="bubble assistant-bubble">
                      <span className="bubble-name">
                        {bot.name}
                        <span className="bubble-handle">@{bot.handle}</span>
                      </span>
                      {message.text ? <MessageText text={message.text} /> : null}
                      {message.tools.length > 0 ? <ToolCalls tools={message.tools} /> : null}
                      <span className="bubble-time">{timeLabel(message.time)}</span>
                    </div>
                  </div>
                )}
              </Fragment>
            )
          })
        )}

        <Requests requests={requests} onDone={onAnswered} />

        {typing && requests.length === 0 ? (
          <div className="message-row assistant">
            <Avatar name={bot.name} color={bot.color} face={bot.face} size={24} />
            <div className="bubble assistant-bubble streaming">
              <span className="bubble-name">
                {bot.name}
                <span className="bubble-handle">@{bot.handle}</span>
              </span>
              {streaming ? (
                <MessageText text={streaming} />
              ) : (
                <span className="typing-dots" aria-label={`${bot.name} is typing`}>
                  <span />
                  <span />
                  <span />
                </span>
              )}
            </div>
          </div>
        ) : null}

        <div ref={end} />
      </div>

      <Composer bot={bot} bots={members} commands={commands} onSend={onSend} />
    </main>
  )
}

function MemberBubble({ message, bots }: { message: UiMessage; bots: Bot[] }) {
  const member = bots.find((bot) => bot.handle === message.handle)
  const name = member?.name ?? (message.handle ? `@${message.handle}` : "Member")
  const color = member?.color ?? "#64748b"
  return (
    <div className="message-row assistant member-row">
      <Avatar name={name} color={color} face={member?.face} size={24} />
      <div className="bubble assistant-bubble member-bubble">
        <span className="bubble-name">
          {name}
          {message.handle ? <span className="bubble-handle">@{message.handle}</span> : null}
          <span className="bubble-tag">member</span>
        </span>
        <MessageText text={message.text} />
        <span className="bubble-time">{timeLabel(message.time)}</span>
      </div>
    </div>
  )
}

/** A job run or task reminder: its first line is the header, the rest is what the bot received. */
function ScheduledNote({ message }: { message: UiMessage }) {
  const [header = "", ...rest] = message.text.split("\n")
  const body = rest.join("\n").trim()
  return (
    <details className="scheduled-note">
      <summary>
        <span className="scheduled-note-kind">
          {message.scheduled === "job" ? "Scheduled" : "Reminder"}
        </span>
        <span className="scheduled-note-title">{header}</span>
        <span className="scheduled-note-time">{timeLabel(message.time)}</span>
      </summary>
      {body ? <div className="scheduled-note-body">{body}</div> : null}
    </details>
  )
}

function DaySeparator({ time }: { time: number }) {
  return (
    <div className="day-separator" role="separator">
      <span className="day-separator-line" />
      <span className="day-separator-label">{dayLabel(time)}</span>
      <span className="day-separator-line" />
    </div>
  )
}

function dayKey(time: number) {
  const date = new Date(time)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dayLabel(time: number) {
  const date = new Date(time)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return "Today"
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  })
}

function MessageText({ text }: { text: string }) {
  return (
    <div className="message-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function ToolCalls({ tools }: { tools: UiMessage["tools"] }) {
  return (
    <details className="tool-call">
      <summary>
        {tools.length} tool {tools.length === 1 ? "call" : "calls"}
      </summary>
      {tools.map((tool, index) => (
        <div key={`${tool.name}-${index}`} className="tool-call-item">
          <div className="tool-call-name">
            {tool.name} <span>{tool.status}</span>
          </div>
          {tool.input ? <pre>{pretty(tool.input)}</pre> : null}
          {tool.output ? <pre>{tool.output}</pre> : null}
        </div>
      ))}
    </details>
  )
}

function pretty(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function timeLabel(time: number) {
  return new Date(time).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })
}
