"use client"

/** 直播间组合层：协调 Player、Chat、Commerce、RtcLab；媒体时钟用于试看和发送消息的 mediaTime。 */
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
import { Chat } from "./chat"
import { Commerce, type PurchaseProduct } from "./commerce"
import { type PlaybackMetrics, Player } from "./player"
import { useApp } from "./providers"
import { RtcLab } from "./rtc-lab"
import { Avatar, Badge, Button, cn, Empty } from "./ui/primitives"
export function Room({ channelId }: { channelId: string }) {
  const { state, user, act, t, locale, toast } = useApp(),
    params = useSearchParams(),
    c = state?.channels.find((c) => c.id === channelId)
  const [product, setProduct] = useState<PurchaseProduct | null>(
      params.get("purchase") === "membership" ? "membership" : null,
    ),
    [theater, setTheater] = useState(false),
    [mediaTime, setMediaTime] = useState(0),
    [messages, setMessages] = useState<ChatMessage[]>([]),
    [metrics, setMetrics] = useState<PlaybackMetrics | null>(null),
    [sourceMode, setSourceMode] = useState("demo"),
    [recordings, setRecordings] = useState<
      { start: string; duration: number; url: string }[]
    >([]),
    [recording, setRecording] = useState(""),
    [giftNotice, setGiftNotice] = useState(""),
    [tab, setTab] = useState(params.get("tab") === "call" ? "call" : "about")
  const viewerId = user?.id,
    roomId = c?.id
  useEffect(() => {
    if (viewerId && roomId)
      void act({ type: "history", channelId: roomId }).catch(() => {})
  }, [viewerId, roomId, act])
  const roomStatus = c?.status
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
  if (!c || !state)
    return (
      <div className="p-8">
        <Empty title={t("频道不存在", "Channel not found")} />
      </div>
    )
  // 三种独立来源：本地测试点播、MediaMTX 实际直播/录制、第三方官方 iframe；业务直播标记不等于推流信号。
  const source: Source = recording
    ? { kind: "file", url: recording, live: false }
    : sourceMode === "local"
      ? {
          kind: "hls",
          url: "http://localhost:8888/live/index.m3u8",
          live: true,
        }
      : sourceMode === "youtube"
        ? { kind: "youtube", url: "jfKfPfyJRdk", live: true }
        : sourceMode === "twitch"
          ? { kind: "twitch", url: "twitchdev", live: true }
          : c.source
  const external = source.kind === "twitch" || source.kind === "youtube"
  const access = external || hasAccess(state, user?.id, c.id, c.access)
  // 15 秒试看只是前端状态演示；生产付费内容还要由服务端鉴权、签名播放地址或 DRM 控制。
  const locked = !access && mediaTime >= 15
  const gifts = state.gifts.filter((g) => g.channelId === c.id)
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
          <Player
            key={`${c.id}-${sourceMode}-${recording}`}
            source={source}
            poster={c.cover}
            messages={messages}
            onTime={setMediaTime}
            onMetrics={onMetrics}
            locked={locked}
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
                  setProduct(c.access === "member" ? "membership" : "ticket")
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
              <Link href={`/channel/${c.id}`}>
                <Avatar name={c.name} color={c.color} />
              </Link>
              <div className="min-w-0">
                <Link
                  href={`/channel/${c.id}`}
                  className="flex items-center gap-2 text-lg font-bold"
                >
                  {c.name}
                  <Check size={13} className="rounded-full bg-violet-500" />
                  <Badge live={c.status === "live"}>
                    {c.status === "live"
                      ? t("直播演示", "LIVE DEMO")
                      : c.status === "scheduled"
                        ? t("预约中", "UPCOMING")
                        : t("回放", "REPLAY")}
                  </Badge>
                </Link>
                <h1 className="mt-1 text-sm text-zinc-200">
                  {locale === "zh" ? c.title : c.titleEn}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                  <Link
                    href={`/?category=${c.category}`}
                    className="text-violet-400"
                  >
                    {c.category}
                  </Link>
                  <span>·</span>
                  <span>{c.tags.join(" · ")}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  void act({ type: "follow", channelId: c.id }).catch(() => {})
                }
              >
                <Heart
                  size={15}
                  fill={user?.follows.includes(c.id) ? "currentColor" : "none"}
                />
                {user?.follows.includes(c.id)
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
                {c.viewers.toLocaleString()} {t("示例观众", "sample viewers")}
              </span>
              <button
                type="button"
                className="flex items-center gap-1"
                onClick={() =>
                  void act({ type: "like", channelId: c.id }).catch(() => {})
                }
              >
                <Heart
                  size={13}
                  fill={
                    state.likes[c.id]?.includes(user?.id ?? "")
                      ? "currentColor"
                      : "none"
                  }
                />
                {state.likes[c.id]?.length ?? 0}
              </button>
              <button
                type="button"
                aria-label={t("收藏", "Bookmark")}
                onClick={() =>
                  void act({ type: "bookmark", channelId: c.id }).catch(
                    () => {},
                  )
                }
              >
                <Bookmark
                  size={14}
                  fill={
                    user?.bookmarks.includes(c.id) ? "currentColor" : "none"
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
          {c.status === "scheduled" && (
            <div className="mt-5 flex items-center justify-between rounded-lg bg-violet-500/10 p-4">
              <p className="text-xs text-violet-200">
                {new Date(c.scheduledAt).toLocaleString()}
              </p>
              <Button
                onClick={() =>
                  void act({ type: "reserve", channelId: c.id }).catch(() => {})
                }
              >
                <Bell size={14} />
                {user?.reservations.includes(c.id)
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
                  {t("关于", "About")} {c.name}
                </h2>
                <p className="mt-3 text-xs leading-6 text-zinc-400">
                  {locale === "zh"
                    ? c.description
                    : "Sharing moments worth slowing down for. Explore, create, and connect with us."}
                </p>
                <Link
                  className="mt-4 inline-block text-xs text-violet-300"
                  href={`/channel/${c.id}`}
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
            <div className="mt-5 space-y-4">
              <p className="text-xs text-zinc-400">
                {t(
                  "申请后等待主播接受；双方打开连麦页后发起邀请。",
                  "Request to join; after approval, both participants open this tab and invite.",
                )}
              </p>
              <Button
                onClick={() =>
                  void act({ type: "requestCall", channelId: c.id }).catch(
                    () => {},
                  )
                }
              >
                {t("申请连麦", "Request to join")}
              </Button>
              <p className="text-xs text-violet-300">
                {user ? c.callRequests?.[user.id] : ""}
              </p>
              {(user?.id === c.ownerId ||
                c.callRequests?.[user?.id ?? ""] === "accepted") && (
                <RtcLab roomId={c.id} />
              )}
            </div>
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
              <label className="block text-xs text-zinc-400">
                {t("播放来源", "Playback source")}
                <select
                  className="mt-2 w-full rounded-lg bg-zinc-800 p-2 text-xs"
                  value={sourceMode}
                  onChange={(e) => {
                    setRecording("")
                    setSourceMode(e.target.value)
                  }}
                >
                  <option value="demo">
                    {t("本地多码率 HLS 演示", "Local multi-bitrate HLS")}
                  </option>
                  <option value="local">
                    {t("OBS 本地真实直播", "OBS local live stream")}
                  </option>
                  <option value="youtube">YouTube official embed</option>
                  <option value="twitch">Twitch official embed</option>
                </select>
              </label>
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
        </div>
      </div>
      {!theater && (
        <aside className="min-w-0 xl:sticky xl:top-16 xl:self-start">
          <Chat
            key={c.id}
            channel={c}
            mediaTime={mediaTime}
            onMessages={setMessages}
          />
        </aside>
      )}
      <Commerce
        channel={c}
        product={product}
        onClose={() => setProduct(null)}
      />
    </div>
  )
}
