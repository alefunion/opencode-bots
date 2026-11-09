import { useEffect, useMemo, useRef, useState } from "react"
import type { Bot, Group, UiMessage } from "../types"
import { Avatar } from "./Avatar"
import { Icon } from "../icons"

export type Selection = { kind: "bot" | "group"; id: string }

export function Sidebar({
  bots,
  groups,
  selected,
  messages,
  unread,
  typing,
  waiting,
  onSelectBot,
  onSelectGroup,
  onNewBot,
  onSettings,
}: {
  bots: Bot[]
  groups: Group[]
  selected: Selection | null
  messages: Record<string, UiMessage[]>
  unread: Set<string>
  typing: Set<string>
  /** Sessions blocked on a question or permission prompt. */
  waiting: Set<string>
  onSelectBot: (bot: Bot) => void
  onSelectGroup: (group: Group) => void
  onNewBot: () => void
  onSettings: () => void
}) {
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  const value = query.trim().toLowerCase()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const filteredBots = useMemo(() => {
    if (!value) return bots
    return bots.filter(
      (bot) =>
        bot.name.toLowerCase().includes(value) ||
        bot.handle.toLowerCase().includes(value) ||
        bot.role.toLowerCase().includes(value),
    )
  }, [bots, value])

  const filteredGroups = useMemo(() => {
    if (!value) return groups
    return groups.filter((group) => {
      if (group.name.toLowerCase().includes(value)) return true
      if (group.description.toLowerCase().includes(value)) return true
      return group.memberIDs.some((id) => {
        const bot = bots.find((item) => item.id === id)
        return (
          bot &&
          (bot.name.toLowerCase().includes(value) || bot.handle.toLowerCase().includes(value))
        )
      })
    })
  }, [bots, groups, value])

  const empty = filteredBots.length === 0 && filteredGroups.length === 0

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search chats"
            aria-label="Search chats"
          />
          <kbd className="search-key" aria-hidden="true">
            ⌘K
          </kbd>
        </label>
      </div>

      <div className="bot-list">
        {empty ? (
          <div className="empty-list">
            <Icon name="bot" size={28} />
            <p>{bots.length === 0 && groups.length === 0 ? "No chats yet." : "No matches."}</p>
            {bots.length === 0 && groups.length === 0 ? (
              <button className="primary-button" onClick={onNewBot}>
                <Icon name="plus" size={16} /> Create your first bot
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {filteredGroups.length > 0 ? (
              <>
                <div className="list-label">Groups</div>
                {filteredGroups.map((group) => {
                  const list = messages[group.sessionID] ?? []
                  const last = list.at(-1)
                  const host = bots.find((bot) => bot.id === group.hostID)
                  const active = selected?.kind === "group" && selected.id === group.id
                  // A busy group also waits on a member that is asking something.
                  const asking =
                    waiting.has(group.sessionID) ||
                    (typing.has(group.sessionID) &&
                      bots.some(
                        (bot) => group.memberIDs.includes(bot.id) && waiting.has(bot.sessionID),
                      ))
                  return (
                    <button
                      key={group.id}
                      className={`bot-row${active ? " active" : ""}`}
                      onClick={() => onSelectGroup(group)}
                    >
                      <Avatar name={group.name} color={group.color} size={32} />
                      <span className="bot-row-main">
                        <span className="bot-row-top">
                          <span className="bot-row-name">{group.name}</span>
                          <span className="bot-row-time">{last ? timeLabel(last.time) : ""}</span>
                        </span>
                        <span className="bot-row-bottom">
                          <span className="bot-row-preview">
                            {asking ? (
                              <span className="waiting-label">Waiting for your answer</span>
                            ) : typing.has(group.sessionID) ? (
                              "typing…"
                            ) : last ? (
                              preview(last)
                            ) : host ? (
                              `${host.name} hosts · ${group.memberIDs.length} ${group.memberIDs.length === 1 ? "member" : "members"}`
                            ) : (
                              "Group"
                            )}
                          </span>
                          {unread.has(`group:${group.id}`) ? <span className="unread-dot" /> : null}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </>
            ) : null}

            {filteredBots.length > 0 ? (
              <>
                {filteredGroups.length > 0 ? <div className="list-label">Bots</div> : null}
                {filteredBots.map((bot) => {
                  const list = messages[bot.sessionID] ?? []
                  const last = list.at(-1)
                  const active = selected?.kind === "bot" && selected.id === bot.id
                  return (
                    <button
                      key={bot.id}
                      className={`bot-row${active ? " active" : ""}`}
                      onClick={() => onSelectBot(bot)}
                    >
                      <Avatar name={bot.name} color={bot.color} face={bot.face} size={32} />
                      <span className="bot-row-main">
                        <span className="bot-row-top">
                          <span className="bot-row-name">{bot.name}</span>
                          <span className="bot-row-time">{last ? timeLabel(last.time) : ""}</span>
                        </span>
                        <span className="bot-row-bottom">
                          <span className="bot-row-preview">
                            {waiting.has(bot.sessionID) ? (
                              <span className="waiting-label">Waiting for your answer</span>
                            ) : typing.has(bot.sessionID) ? (
                              "typing…"
                            ) : last ? (
                              preview(last)
                            ) : (
                              `@${bot.handle}`
                            )}
                          </span>
                          {unread.has(`bot:${bot.id}`) ? <span className="unread-dot" /> : null}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </>
            ) : null}
          </>
        )}
      </div>

      <footer className="sidebar-footer">
        <span className="sidebar-status">
          <span className="status-dot" />
          <span className="sidebar-counts">
            {bots.length} {bots.length === 1 ? "bot" : "bots"}
            <span className="dot-separator">·</span>
            {groups.length} {groups.length === 1 ? "group" : "groups"}
          </span>
        </span>
        <button className="icon-button" onClick={onSettings} title="Settings" aria-label="Settings">
          <Icon name="settings" />
        </button>
      </footer>
    </aside>
  )
}

function preview(message: UiMessage) {
  const text = message.text.replace(/\s+/g, " ").trim()
  if (!text) return message.role === "assistant" ? "…" : ""
  const prefix =
    message.role === "user"
      ? "You: "
      : message.role === "member"
        ? `@${message.handle ?? "member"}: `
        : ""
  return `${prefix}${text.slice(0, 80)}`
}

function timeLabel(time: number) {
  const date = new Date(time)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
