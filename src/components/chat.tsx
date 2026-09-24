"use client"

/** JD 重点：消息 ID/seq、ACK、重连补拉和有界展示。MSW 模拟传输故障，React Virtual 控制 DOM 数量。 */
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  MessageCircle,
  MoreHorizontal,
  Send,
  Shield,
  Smile,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { canModerate, mergeMessages } from "@/lib/domain"
import type { Channel, ChatMessage } from "@/lib/types"
import { useApp } from "./providers"
import { Button, cn, inputClass, Modal } from "./ui/primitives"
export function Chat({
  channel,
  mediaTime = 0,
  onMessages,
}: {
  channel: Channel
  mediaTime?: number
  onMessages?: (m: ChatMessage[]) => void
}) {
  const { state, user, t, act, setAuthOpen, toast } = useApp(),
    [messages, setMessages] = useState<ChatMessage[]>([]),
    [text, setText] = useState(""),
    [connection, setConnection] = useState("connecting"),
    [pending, setPending] = useState<
      Record<string, { text: string; status: "sending" | "failed"; at: number }>
    >({}),
    [reply, setReply] = useState<ChatMessage | null>(null),
    [selected, setSelected] = useState<ChatMessage | null>(null),
    [tab, setTab] = useState("chat"),
    [emoji, setEmoji] = useState(false),
    [newMessages, setNewMessages] = useState(0),
    [older, setOlder] = useState(false),
    [reconnectKey, setReconnectKey] = useState(0)
  const socket = useRef<WebSocket | null>(null),
    scrollRef = useRef<HTMLDivElement>(null),
    // after 是已见最大序号，并非“最大连续序号”；当前协议不解决任意丢包造成的中间缺口。
    after = useRef(0),
    atBottom = useRef(true),
    onMessagesRef = useRef(onMessages)
  onMessagesRef.current = onMessages
  useEffect(() => {
    onMessagesRef.current?.(messages)
  }, [messages])
  const receive = useCallback((incoming: ChatMessage[]) => {
    setMessages((old) => mergeMessages(old, incoming))
    if (incoming.length)
      after.current = Math.max(after.current, ...incoming.map((m) => m.seq))
    if (!atBottom.current)
      setNewMessages((n) => Math.min(500, n + incoming.length))
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reconnectKey intentionally recreates the connection.
  useEffect(() => {
    let disposed = false,
      tries = 0,
      reconnect: ReturnType<typeof setTimeout>,
      pongAt = Date.now()
    after.current = 0
    setMessages([])
    setPending({})
    setOlder(false)
    const connect = () => {
      if (disposed) return
      setConnection("connecting")
      const ws = new WebSocket("ws://localhost:3000/chat")
      socket.current = ws
      ws.onopen = () => {
        if (disposed) {
          ws.close()
          return
        }
        pongAt = Date.now()
        setConnection("connected")
        ws.send(
          JSON.stringify({
            type: "join",
            roomId: channel.id,
            after: after.current,
          }),
        )
      }
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data)
        pongAt = Date.now()
        // 收到业务心跳才重置重试计数，避免“连接刚打开就断开”的场景无限自动重试。
        if (data.type === "pong") tries = 0
        if (data.type === "messages") receive(data.messages)
        if (data.type === "reset") {
          after.current = Math.max(
            0,
            ...data.messages.map((m: ChatMessage) => m.seq),
          )
          setMessages(mergeMessages([], data.messages))
          setPending({})
        }
        if (data.type === "ack") {
          receive([data.message])
          setPending((p) => {
            const next = { ...p }
            delete next[data.message.id]
            return next
          })
        }
        if (data.type === "error") {
          toast(data.error)
          setPending((p) =>
            data.id && p[data.id]
              ? { ...p, [data.id]: { ...p[data.id], status: "failed" } }
              : p,
          )
        }
      }
      ws.onclose = () => {
        if (disposed) return
        setConnection("disconnected")
        setPending((p) =>
          Object.fromEntries(
            Object.entries(p).map(([id, v]) => [
              id,
              { ...v, status: "failed" },
            ]),
          ),
        )
        // 退避 0.5/1/2/4/8 秒，最多 5 次；之后让用户手动重连。本地演示未加多客户端抖动 jitter。
        if (tries < 5)
          reconnect = setTimeout(connect, Math.min(500 * 2 ** tries++, 8000))
        else setConnection("failed")
      }
      ws.onerror = () => ws.close()
    }
    connect()
    // 每 5 秒检查 ACK 超时（>8秒）和连接活性（>15秒未收消息）；因此超时显示有采样粒度。
    const heartbeat = setInterval(() => {
      setPending((p) =>
        Object.fromEntries(
          Object.entries(p).map(([id, v]) => [
            id,
            v.status === "sending" && Date.now() - v.at > 8000
              ? { ...v, status: "failed" }
              : v,
          ]),
        ),
      )
      const ws = socket.current
      if (ws?.readyState === WebSocket.OPEN) {
        if (Date.now() - pongAt > 15000) {
          ws.close()
          return
        }
        ws.send(JSON.stringify({ type: "ping" }))
      }
    }, 5000)
    return () => {
      disposed = true
      clearTimeout(reconnect)
      clearInterval(heartbeat)
      socket.current?.close()
      socket.current = null
    }
  }, [channel.id, receive, toast, reconnectKey])
  useEffect(() => {
    const room = state?.messages.filter((m) => m.roomId === channel.id)
    // Query 只修补已收到消息的删除等管理状态；新消息必须经过 WS，否则断线演示会被缓存刷新绕过。
    if (room)
      setMessages((old) => {
        const updates = new Map(room.map((m) => [m.id, m]))
        return old.map((m) => updates.get(m.id) ?? m)
      })
  }, [state?.messages, channel.id])
  // 新消息生成 ID，失败项重试传回原 ID；pending 与已确认消息分开存储，ACK 到达后移除 pending。
  const send = (messageText = text, id = crypto.randomUUID()) => {
    if (!user) {
      setAuthOpen(true)
      return
    }
    if (!messageText.trim()) return
    if (socket.current?.readyState !== WebSocket.OPEN) {
      toast(t("连接已断开，请稍后重试", "Disconnected. Please retry shortly."))
      return
    }
    setPending((p) => ({
      ...p,
      [id]: { text: messageText, status: "sending", at: Date.now() },
    }))
    socket.current.send(
      JSON.stringify({
        type: "message",
        id,
        userId: user.id,
        text: messageText,
        mediaTime,
        replyTo: reply?.id,
        kind: tab === "questions" ? "question" : "chat",
      }),
    )
    setText("")
    setReply(null)
  }
  // 合并窗口 500 条，默认显示最近 100 条；“更早消息”只展开已有窗口，并非服务端历史分页。
  const visible = messages
    .filter(
      (m) =>
        !user?.blocked.includes(m.userId) &&
        (tab !== "questions" || m.kind === "question"),
    )
    .slice(older ? 0 : -100)
  const virtual = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 8,
  })
  useEffect(() => {
    if (atBottom.current && visible.length)
      virtual.scrollToIndex(visible.length - 1, { align: "end" })
  }, [visible.length, virtual])
  const poll = state?.polls[channel.id],
    pinned = messages.find((m) => m.id === channel.pinnedId && !m.deleted),
    moderator = canModerate(user, channel.ownerId)
  const run = (a: Record<string, unknown> & { type: string }) => {
    void act({ ...a, channelId: channel.id })
      .then(() => setSelected(null))
      .catch(() => {})
  }
  return (
    <section
      className="flex h-[650px] min-h-0 flex-col border-l border-white/[.06] bg-[#141417] xl:h-[calc(100dvh-64px)]"
      aria-label={t("直播聊天", "Live chat")}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[.06] px-4">
        <h2 className="flex items-center gap-2 text-xs font-semibold">
          <MessageCircle size={16} className="text-violet-400" />
          {t("直播聊天", "Stream chat")}
        </h2>
        <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
          <span
            className={cn(
              "size-1.5 rounded-full",
              connection === "connected" ? "bg-emerald-400" : "bg-amber-400",
            )}
          />
          {connection === "connected"
            ? t("已连接", "Connected")
            : t("重连中", "Reconnecting")}
        </span>
      </div>
      {connection === "failed" && (
        <Button
          variant="secondary"
          onClick={() => setReconnectKey((v) => v + 1)}
        >
          {t("重新连接", "Reconnect")}
        </Button>
      )}
      <div className="flex border-b border-white/[.06] px-4">
        {[
          ["chat", "聊天", "Chat"],
          ["poll", "投票", "Poll"],
          ["questions", "问答", "Q&A"],
        ].map(([key, zh, en]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 border-b-2 py-3 text-[11px]",
              tab === key
                ? "border-violet-400 text-white"
                : "border-transparent text-zinc-500",
            )}
          >
            {t(zh, en)}
          </button>
        ))}
      </div>
      <div className="mx-3 mt-3 rounded-lg border border-violet-400/15 bg-violet-500/[.06] px-3 py-2.5 text-[11px] leading-5 text-violet-200/80">
        <span className="mb-1 flex items-center gap-1.5 font-semibold">
          <Shield size={12} />
          {t("频道公告", "CHANNEL NOTICE")}
        </span>
        {channel.announcement}
      </div>
      {pinned && (
        <div className="mx-3 mt-2 rounded-lg bg-amber-400/5 p-2 text-[11px] text-amber-200">
          📌 {pinned.name}: {pinned.text}
        </div>
      )}
      {tab === "poll" ? (
        <div className="flex-1 p-4">
          {poll ? (
            <>
              <h3 className="mb-4 text-sm font-semibold">{poll.question}</h3>
              <div className="space-y-3">
                {poll.options.map((o, i) => {
                  const count = Object.values(poll.votes).filter(
                    (v) => v === i,
                  ).length
                  return (
                    <button
                      key={o}
                      type="button"
                      onClick={() => run({ type: "vote", option: i })}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg border p-3 text-xs",
                        poll.votes[user?.id ?? ""] === i
                          ? "border-violet-400 bg-violet-500/10"
                          : "border-white/10",
                      )}
                    >
                      <span>{o}</span>
                      <span className="text-zinc-500">{count}</span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-4 text-[10px] text-zinc-600">
                {Object.keys(poll.votes).length}{" "}
                {t("票 · 每人一票，可更改", "votes · one vote per person")}
              </p>
            </>
          ) : (
            <p className="py-10 text-center text-xs text-zinc-500">
              {t("主播还未发起投票", "No poll yet")}
            </p>
          )}
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget
              atBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 60
              if (atBottom.current) setNewMessages(0)
            }}
            className="min-h-0 flex-1 overflow-auto px-3 py-3"
            aria-live="off"
          >
            <button
              type="button"
              className="mb-3 w-full text-[10px] text-zinc-500"
              onClick={() => setOlder(true)}
            >
              {older
                ? t("已加载保留的历史消息", "Retained history loaded")
                : t("加载更早消息", "Load earlier messages")}
            </button>
            <ul
              style={{ height: virtual.getTotalSize(), position: "relative" }}
            >
              {virtual.getVirtualItems().map((item) => {
                const m = visible[item.index]
                return (
                  <li
                    key={m.id}
                    data-index={item.index}
                    ref={virtual.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                    }}
                    className="group flex items-start gap-1 pb-3 text-xs leading-5"
                  >
                    <div className="min-w-0 flex-1 break-words">
                      {m.replyTo && (
                        <span className="mr-1 text-zinc-600">↳</span>
                      )}
                      <span
                        className={cn(
                          "mr-1.5 font-semibold",
                          m.kind === "gift"
                            ? "text-amber-300"
                            : m.userId === user?.id
                              ? "text-violet-300"
                              : [
                                  "text-cyan-300",
                                  "text-pink-300",
                                  "text-emerald-300",
                                  "text-orange-300",
                                ][m.seq % 4],
                        )}
                      >
                        {m.name}
                      </span>
                      <span
                        className={
                          m.deleted ? "text-zinc-600 italic" : "text-zinc-300"
                        }
                      >
                        {m.deleted
                          ? t("消息已删除", "Message removed")
                          : m.text}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Message actions ${m.id}`}
                      onClick={() => setSelected(m)}
                      className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 hover:bg-white/10 focus:opacity-100 group-hover:opacity-100"
                    >
                      <MoreHorizontal size={13} />
                    </button>
                  </li>
                )
              })}
            </ul>
            {Object.entries(pending).map(([id, p]) => (
              <div key={id} className="mb-2 text-xs text-zinc-500">
                {p.text}
                <span className="ml-2 text-[10px]">
                  {p.status === "sending" ? (
                    t("发送中…", "Sending…")
                  ) : (
                    <button
                      type="button"
                      onClick={() => send(p.text, id)}
                      className="text-red-300"
                    >
                      {t("失败，点击重试", "Failed. Retry")}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
          {newMessages > 0 && (
            <button
              type="button"
              onClick={() => {
                virtual.scrollToIndex(visible.length - 1, { align: "end" })
                atBottom.current = true
                setNewMessages(0)
              }}
              className="mx-3 rounded bg-violet-500/20 py-1 text-[11px] text-violet-300"
            >
              {t("查看新消息", "Jump to latest")} ↓
            </button>
          )}
        </>
      )}
      <div className="shrink-0 border-t border-white/[.06] p-3">
        {reply && (
          <div className="mb-2 flex items-center justify-between text-[10px] text-zinc-400">
            <span>
              ↳ {reply.name}: {reply.text.slice(0, 25)}
            </span>
            <button type="button" onClick={() => setReply(null)}>
              ×
            </button>
          </div>
        )}
        {emoji && (
          <div className="mb-2 flex gap-2">
            {["✨", "💜", "👏", "🔥", "🎧", "🎉"].map((v) => (
              <button
                type="button"
                key={v}
                onClick={() => {
                  setText((s) => s + v)
                  setEmoji(false)
                }}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <input
            aria-label={t("发送消息", "Send a message")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            className={cn(inputClass, "text-xs")}
            placeholder={
              user
                ? t("说点什么，和大家打个招呼…", "Say hello to the community…")
                : t("登录后加入聊天", "Sign in to join the conversation")
            }
          />
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Emoji"
                onClick={() => setEmoji(!emoji)}
                className="text-zinc-500"
              >
                <Smile size={18} />
              </button>
              <span className="text-[10px] text-zinc-600">
                {channel.slowMode
                  ? t("慢速 10s", "Slow 10s")
                  : t("保持友善，享受此刻", "Be kind. Enjoy the moment.")}
              </span>
            </div>
            <Button type="submit" className="min-h-8 px-3 py-1 text-[11px]">
              <Send size={12} />
              {t("发送", "Chat")}
            </Button>
          </div>
        </form>
      </div>
      <Modal
        open={!!selected}
        onOpenChange={() => setSelected(null)}
        title={selected?.name ?? ""}
        description={selected?.text}
      >
        <div className="grid gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setReply(selected)
              setSelected(null)
            }}
          >
            {t("回复", "Reply")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => run({ type: "block", target: selected?.userId })}
          >
            {t("屏蔽 / 取消屏蔽用户", "Block / unblock user")}
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              run({
                type: "report",
                target: selected?.id,
                reason: "Inappropriate chat message",
              })
            }
          >
            {t("举报消息", "Report message")}
          </Button>
          {moderator && (
            <>
              <Button
                variant="secondary"
                onClick={() =>
                  run({
                    type: "moderate",
                    operation: "pin",
                    target: selected?.id,
                  })
                }
              >
                {t("置顶消息", "Pin message")}
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  run({
                    type: "moderate",
                    operation: "mute",
                    target: selected?.userId,
                  })
                }
              >
                {t("禁言 / 解除禁言", "Mute / unmute")}
              </Button>
              <Button
                variant="danger"
                onClick={() =>
                  run({
                    type: "moderate",
                    operation: "delete",
                    target: selected?.id,
                  })
                }
              >
                {t("删除消息", "Remove message")}
              </Button>
            </>
          )}
        </div>
      </Modal>
    </section>
  )
}
