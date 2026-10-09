"use client"

/** 观众页：选择播放来源，再组合播放器、聊天和互动入口。 */
import {
  Bell,
  Bookmark,
  Check,
  Crown,
  Gift,
  Heart,
  LockKeyhole,
  Share2,
  Users,
} from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { hasAccess } from "@/lib/domain"
import type { ChatMessage, Source } from "@/lib/types"
import { CallPanel, useCallRoom } from "./call-panel"
import { Chat } from "./chat"
import { Commerce, type PurchaseProduct } from "./commerce"
import { LivePlayer, localLiveSource } from "./live-player"
import { type PlaybackMetrics, Player } from "./player"
import { useApp } from "./providers"
import { Avatar, Badge, Button, cn, Empty } from "./ui/primitives"
export function Room({ channelId }: { channelId: string }) {
  const { state, user, act, t, locale, toast } = useApp()
  const params = useSearchParams()
  const calls = useCallRoom("", channelId === "mei")
  const [lastCallSource, setLastCallSource] = useState("")
  useEffect(() => {
    if (calls.data?.enabled)
      setLastCallSource(calls.data.source === "browser" ? "browser" : "local")
  }, [calls.data?.enabled, calls.data?.source])
  const channel = state?.channels.find((channel) => channel.id === channelId)

  const [product, setProduct] = useState<PurchaseProduct | null>(
    params.get("purchase") === "membership" ? "membership" : null,
  )
  const [inCall, setInCall] = useState(false)
  const [theater, setTheater] = useState(false)
  const [mediaTime, setMediaTime] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [metrics, setMetrics] = useState<PlaybackMetrics | null>(null)
  const [sourceMode, setSourceMode] = useState(params.get("source") ?? "")
  const [recordings, setRecordings] = useState<
    { start: string; duration: number; url: string }[]
  >([])
  const [recording, setRecording] = useState("")
  const [giftNotice, setGiftNotice] = useState("")
  const [tab, setTab] = useState(
    params.get("tab") === "call" ? "call" : "about",
  )

  const viewerId = user?.id
  const roomId = channel?.id
  useEffect(() => {
    if (viewerId && roomId)
      void act({ type: "history", channelId: roomId }).catch(() => {})
  }, [viewerId, roomId, act])
  const roomStatus = channel?.status
  useEffect(() => {
    if (roomStatus !== "ended" || roomId !== "mei") return
    const controller = new AbortController()
    void fetch("/api/media/recordings", { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setRecordings(d.items ?? []))
      .catch(() => {})
    return () => controller.abort()
  }, [roomStatus, roomId])
  const latestGift = state?.gifts.find((g) => g.channelId === channelId)
  const giftId = latestGift?.id
  useEffect(() => {
    if (!giftId) return
    setGiftNotice(giftId)
    const timer = setTimeout(() => setGiftNotice(""), 3500)
    return () => clearTimeout(timer)
  }, [giftId])
  const onMetrics = useCallback((m: PlaybackMetrics) => setMetrics(m), [])
  if (!channel || !state)
    return (
      <div className="p-8">
        <Empty title={t("频道不存在", "Channel not found")} />
      </div>
    )
  // 手动选择优先。网页停播后仍保留该来源，等待重新开播。
  const playbackMode =
    sourceMode ||
    (calls.data?.enabled
      ? calls.data.source === "browser"
        ? "browser"
        : "local"
      : lastCallSource || (channel.broadcastId ? "browser" : "demo"))
  let source: Source = channel.source
  if (recording) {
    source = { kind: "file", url: recording, live: false }
  } else if (playbackMode === "local") {
    source = localLiveSource
  } else if (playbackMode === "youtube") {
    source = { kind: "youtube", url: "jfKfPfyJRdk", live: true }
  } else if (playbackMode === "twitch") {
    source = { kind: "twitch", url: "twitchdev", live: true }
  }

  const external = source.kind === "twitch" || source.kind === "youtube"
  const isLiveSource = ["local", "browser"].includes(playbackMode) && !recording
  // 真实直播先等输入信号；点播和回放直接播放。
  const RoomPlayer = isLiveSource ? LivePlayer : Player
  const hasViewingAccess =
    external || hasAccess(state, user?.id, channel.id, channel.access)
  // 15 秒试看只是前端状态演示；生产付费内容还要由服务端鉴权、签名播放地址或 DRM 控制。
  const locked = !hasViewingAccess && mediaTime >= 15
  const gifts = state.gifts.filter((g) => g.channelId === channel.id)
  const ranks = Object.entries(
    gifts.reduce<Record<string, number>>((sum, g) => {
      sum[g.userId] = (sum[g.userId] ?? 0) + g.amount
      return sum
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  const combo = latestGift
    ? gifts.filter(
        (g) => g.userId === latestGift.userId && latestGift.at - g.at < 10000,
      ).length
    : 0
  return (
    <div
      className={cn(
        "grid min-w-0",
        !theater && "xl:grid-cols-[minmax(0,1fr)_330px]",
      )}
    >
      <div className="min-w-0">
        <label className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-zinc-900 px-4 py-3 text-xs text-zinc-400">
          {t("播放来源", "Playback source")}
          <select
            className="rounded-lg bg-zinc-800 p-2 text-xs text-zinc-100"
            value={playbackMode}
            onChange={(e) => {
              setRecording("")
              setSourceMode(e.target.value)
            }}
          >
            <option value="demo">
              {t("测试素材 · 本地点播", "Test footage · local VOD")}
            </option>
            <option value="local">
              {t("OBS / FFmpeg · 真实直播", "OBS / FFmpeg · live")}
            </option>
            <option value="browser">
              {t("网页开播 · 真实直播", "Browser · live")}
            </option>
            <option value="youtube">YouTube official embed</option>
            <option value="twitch">Twitch official embed</option>
          </select>
        </label>
        {roomStatus === "ended" && recordings.length > 0 && (
          <label className="block bg-violet-500/10 px-5 py-3 text-xs">
            {t("本场录制回放", "Session recordings")}
            <select
              aria-label="本场录制回放"
              value={recording}
              onChange={(e) => setRecording(e.target.value)}
              className="ml-3 max-w-full rounded bg-zinc-800 p-2"
            >
              <option value="">
                {t("选择真实录制", "Choose a recording")}
              </option>
              {recordings.map((r) => (
                <option value={r.url} key={r.start}>
                  {new Date(r.start).toLocaleString()} ·{" "}
                  {Math.round(r.duration)}s
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="relative">
          <RoomPlayer
            key={`${channel.id}-${playbackMode}-${recording}`}
            browser={playbackMode === "browser"}
            source={source}
            poster={channel.cover}
            messages={messages}
            onTime={setMediaTime}
            onMetrics={onMetrics}
            locked={locked}
            forceMuted={inCall}
            theater={theater}
            onTheater={() => setTheater(!theater)}
          />
          {giftNotice && latestGift && !external && (
            <div
              className="pointer-events-none absolute bottom-20 left-5 rounded-full border border-violet-400/30 bg-zinc-900/90 px-5 py-3 text-sm text-violet-200 shadow-xl motion-safe:animate-bounce"
              role="status"
            >
              ✨ {state.users.find((u) => u.id === latestGift.userId)?.name} ·{" "}
              {latestGift.amount} ✦ {combo > 1 ? `× ${combo}` : ""}
            </div>
          )}
          {locked && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/80 p-5 text-center backdrop-blur-sm">
              <LockKeyhole size={30} className="text-violet-300" />
              <h2 className="text-xl font-bold">
                {t("精彩继续，解锁后观看", "Unlock the rest of the story")}
              </h2>
              <p className="text-xs text-zinc-400">
                {t(
                  "15 秒试看已结束 · 本地权益演示",
                  "Your 15-second preview ended · simulated entitlement",
                )}
              </p>
              <Button
                onClick={() =>
                  setProduct(
                    channel.access === "member" ? "membership" : "ticket",
                  )
                }
              >
                {t("解锁观看", "Unlock access")}
              </Button>
            </div>
          )}
        </div>
        <div className="p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <Link href={`/channel/${channel.id}`}>
                <Avatar name={channel.name} color={channel.color} />
              </Link>
              <div className="min-w-0">
                <Link
                  href={`/channel/${channel.id}`}
                  className="flex items-center gap-2 text-lg font-bold"
                >
                  {channel.name}
                  <Check size={13} className="rounded-full bg-violet-500" />
                  <Badge live={channel.status === "live"}>
                    {channel.status === "live"
                      ? t("直播演示", "LIVE DEMO")
                      : channel.status === "scheduled"
                        ? t("预约中", "UPCOMING")
                        : t("回放", "REPLAY")}
                  </Badge>
                </Link>
                <h1 className="mt-1 text-sm text-zinc-200">
                  {locale === "zh" ? channel.title : channel.titleEn}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                  <Link
                    href={`/?category=${channel.category}`}
                    className="text-violet-400"
                  >
                    {channel.category}
                  </Link>
                  <span>·</span>
                  <span>{channel.tags.join(" · ")}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  void act({ type: "follow", channelId: channel.id }).catch(
                    () => {},
                  )
                }
              >
                <Heart
                  size={15}
                  fill={
                    user?.follows.includes(channel.id) ? "currentColor" : "none"
                  }
                />
                {user?.follows.includes(channel.id)
                  ? t("已关注", "Following")
                  : t("关注", "Follow")}
              </Button>
              <Button
                disabled={external}
                onClick={() => setProduct("membership")}
              >
                <Crown size={15} />
                {t("订阅", "Subscribe")}
              </Button>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
            <div className="flex items-center gap-4 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1.5 text-rose-400">
                <Users size={13} />
                {channel.viewers.toLocaleString()}{" "}
                {t("示例观众", "sample viewers")}
              </span>
              <button
                type="button"
                className="flex items-center gap-1"
                onClick={() =>
                  void act({ type: "like", channelId: channel.id }).catch(
                    () => {},
                  )
                }
              >
                <Heart
                  size={13}
                  fill={
                    state.likes[channel.id]?.includes(user?.id ?? "")
                      ? "currentColor"
                      : "none"
                  }
                />
                {state.likes[channel.id]?.length ?? 0}
              </button>
              <button
                type="button"
                aria-label={t("收藏", "Bookmark")}
                onClick={() =>
                  void act({ type: "bookmark", channelId: channel.id }).catch(
                    () => {},
                  )
                }
              >
                <Bookmark
                  size={14}
                  fill={
                    user?.bookmarks.includes(channel.id)
                      ? "currentColor"
                      : "none"
                  }
                />
              </button>
              <button
                type="button"
                aria-label={t("分享", "Share")}
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(window.location.href)
                    .then(() => toast(t("链接已复制", "Link copied")))
                    .catch(() => toast(window.location.href))
                }}
              >
                <Share2 size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setProduct("credits")}
                className="mr-2 text-xs text-zinc-400"
              >
                ✦ {user?.credits ?? 0}{" "}
                <span className="text-violet-400">+</span>
              </button>
              <Button
                variant="secondary"
                className="min-h-8 px-3 py-1 text-xs"
                disabled={external}
                onClick={() => setProduct("gift")}
              >
                <Gift size={14} />
                {t("送礼物", "Send a gift")}
              </Button>
            </div>
          </div>
          {channel.status === "scheduled" && (
            <div className="mt-5 flex items-center justify-between rounded-lg bg-violet-500/10 p-4">
              <p className="text-xs text-violet-200">
                {new Date(channel.scheduledAt).toLocaleString()}
              </p>
              <Button
                onClick={() =>
                  void act({ type: "reserve", channelId: channel.id }).catch(
                    () => {},
                  )
                }
              >
                <Bell size={14} />
                {user?.reservations.includes(channel.id)
                  ? t("已预约", "Reserved")
                  : t("预约直播", "Remind me")}
              </Button>
            </div>
          )}
          <nav className="mt-5 flex gap-6">
            {[
              ["about", "关于频道", "About"],
              ["call", "连麦", "Call"],
              ["support", "本场支持", "Supporters"],
              ["quality", "播放信息", "Playback info"],
            ].map(([key, zh, en]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "border-b-2 pb-3 text-xs",
                  tab === key
                    ? "border-violet-400 text-white"
                    : "border-transparent text-zinc-500",
                )}
              >
                {t(zh, en)}
              </button>
            ))}
          </nav>
          {tab === "about" ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-white/[.06] bg-[#18181d] p-5">
                <h2 className="text-sm font-bold">
                  {t("关于", "About")} {channel.name}
                </h2>
                <p className="mt-3 text-xs leading-6 text-zinc-400">
                  {locale === "zh"
                    ? channel.description
                    : "Sharing moments worth slowing down for. Explore, create, and connect with us."}
                </p>
                <Link
                  className="mt-4 inline-block text-xs text-violet-300"
                  href={`/channel/${channel.id}`}
                >
                  {t("查看频道主页", "Visit channel")} →
                </Link>
              </div>
              <div className="rounded-xl border border-violet-400/10 bg-violet-500/[.04] p-5">
                <Crown size={21} className="text-violet-300" />
                <h2 className="mt-3 text-sm font-bold">
                  {t("让热爱持续发生", "Keep the good moments coming")}
                </h2>
                <p className="mt-2 text-xs leading-6 text-zinc-500">
                  {t(
                    "成为会员，解锁专属直播与更多交流。",
                    "Join the channel for exclusive streams and more connection.",
                  )}
                </p>
                <button
                  type="button"
                  className="mt-3 text-xs text-violet-300"
                  disabled={external}
                  onClick={() => setProduct("membership")}
                >
                  {t("了解会员权益", "Explore membership")} →
                </button>
              </div>
            </div>
          ) : tab === "call" ? (
            <p className="mt-4 text-xs text-zinc-500">
              上麦后请使用下方连麦区实时对话，直播播放器保持静音。
            </p>
          ) : tab === "support" ? (
            <div className="mt-5 space-y-3">
              {gifts.length ? (
                ranks.map(([userId, amount]) => (
                  <div
                    key={userId}
                    className="flex justify-between rounded-lg bg-white/5 p-3 text-xs"
                  >
                    <span>
                      {state.users.find((u) => u.id === userId)?.name}
                    </span>
                    <span className="text-amber-300">{amount} ✦</span>
                  </div>
                ))
              ) : (
                <p className="py-8 text-center text-xs text-zinc-500">
                  {t(
                    "成为第一个送出星光的人",
                    "Be the first to show some love",
                  )}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-4 rounded-xl border border-white/10 p-4">
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <p className="text-zinc-500">{t("首帧", "First frame")}</p>
                  <p className="mt-1">
                    {external
                      ? "N/A"
                      : metrics?.startupMs
                        ? `${metrics.startupMs} ms`
                        : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">{t("缓冲", "Buffer")}</p>
                  <p className="mt-1">
                    {external ? "N/A" : `${metrics?.buffer ?? 0}s`}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">{t("卡顿次数", "Stalls")}</p>
                  <p className="mt-1">
                    {external ? "N/A" : (metrics?.stalls ?? 0)}
                  </p>
                </div>
              </div>
              <Link
                href="/lab"
                className="inline-block text-xs text-violet-300"
              >
                {t("打开播放实验室", "Open playback lab")} →
              </Link>
            </div>
          )}
          <CallPanel
            open={tab === "call"}
            channelId={channel.id}
            onParticipationChange={setInCall}
            onOpen={() => setTab("call")}
          />
        </div>
      </div>
      {!theater && (
        <aside className="min-w-0 xl:sticky xl:top-16 xl:self-start">
          <Chat
            key={channel.id}
            channel={channel}
            mediaTime={mediaTime}
            onMessages={setMessages}
          />
        </aside>
      )}
      <Commerce
        channel={channel}
        product={product}
        onClose={() => setProduct(null)}
      />
    </div>
  )
}
