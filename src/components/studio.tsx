"use client"

import { Copy, Radio } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useEffect, useState } from "react"
import { isPublicMedia, rtmpServer } from "@/lib/media-config"
import { BrowserBroadcast } from "./browser-broadcast"
import { CallPanel } from "./call-panel"
import { Chat } from "./chat"
import { LivePlayer, useMediaStatus } from "./live-player"
import { useApp } from "./providers"
import { Button, cn, Empty, inputClass, Modal } from "./ui/primitives"

export function Studio() {
  const { state, user, t, act, setAuthOpen, toast } = useApp()
  const [endVersion, setEndVersion] = useState(0)
  const [inCall, setInCall] = useState(false)
  const [tab, setTab] = useState("devices")
  const [isEndDialogOpen, setEndDialogOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [isSaving, setSaving] = useState(false)
  const [recordings, setRecordings] = useState<
    { start: string; duration: number; url: string }[]
  >([])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const channel = state?.channels.find(
    (channel) => channel.ownerId === user?.id,
  )
  const media = useMediaStatus(channel?.broadcastId ? "browser" : "live")
  const hasLiveInput = !media.isError && media.data?.ready
  if (!user || !channel)
    return (
      <div className="p-8">
        <Empty
          title={t("你的直播，从这里开始", "Your stage is ready")}
          description={t(
            "切换到 MEI 主播演示身份，即可使用开播页。",
            "Switch to the MEI creator identity to use the studio.",
          )}
        >
          <Button onClick={() => setAuthOpen(true)}>
            {t("选择主播身份", "Choose creator identity")}
          </Button>
        </Empty>
      </div>
    )
  let signalText = t("媒体服务未连接", "Media service unavailable")
  if (hasLiveInput) {
    signalText = t("输入信号正常", "Signal detected")
  } else if (media.data?.online && !media.isError) {
    signalText = t("等待推流信号", "Waiting for signal")
  }

  const saveSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    const form = new FormData(event.currentTarget)
    try {
      await act({
        type: "updateRoom",
        channelId: channel.id,
        title: form.get("title"),
        category: form.get("category"),
        language: form.get("language"),
        access: form.get("access"),
        announcement: form.get("announcement"),
        slowMode: form.get("slow") === "on",
        chatMode: form.get("chatMode"),
        ...(form.get("schedule")
          ? { scheduledAt: new Date(String(form.get("schedule"))).getTime() }
          : {}),
      })
      toast(t("直播设置已保存", "Stream settings saved"))
    } catch {
      // act 已显示错误提示，这里只负责恢复保存按钮。
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-7">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] tracking-widest text-violet-400">
            CREATOR STUDIO
          </p>
          <h1 className="text-2xl font-bold">
            {t("准备好，分享你的世界", "Ready to share your world?")}
          </h1>
        </div>
        <div className="flex gap-2">
          <span
            className={cn(
              "mr-2 flex items-center gap-2 text-xs",
              hasLiveInput ? "text-emerald-300" : "text-zinc-500",
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                hasLiveInput ? "bg-emerald-400" : "bg-zinc-600",
              )}
            />
            {signalText}
          </span>
          <Button variant="secondary" onClick={() => setEndDialogOpen(true)}>
            {t("结束场次", "End session")}
          </Button>
          <Button
            disabled={Boolean(channel.broadcastId && channel.status === "live")}
            onClick={() =>
              void act({ type: "start", channelId: channel.id })
                .then(() =>
                  toast(
                    t(
                      "场次已开始；真实画面需启动 OBS 推流",
                      "Session started. Start OBS for a real live feed.",
                    ),
                  ),
                )
                .catch(() => {})
            }
          >
            <Radio size={15} />
            {t("开始 OBS 场次", "Start OBS session")}
          </Button>
        </div>
      </div>
      {channel.startedAt && (
        <div className="mb-5 flex flex-wrap gap-6 rounded-xl border border-white/10 bg-white/5 p-4 text-xs">
          <span>
            {channel.endedAt
              ? t("本场已结束", "Session ended")
              : t("直播时长", "Live duration")}
            :{" "}
            {Math.max(
              0,
              Math.floor(
                ((channel.endedAt ?? now + (state?.clockOffset ?? 0)) -
                  channel.startedAt) /
                  1000,
              ),
            )}
            s
          </span>
          <span>
            {t("本场消息", "Session messages")}:{" "}
            {
              state?.messages.filter(
                (m) =>
                  m.roomId === channel.id && m.time >= (channel.startedAt ?? 0),
              ).length
            }
          </span>
          <span>
            {t("本场礼物币", "Session gift credits")}:{" "}
            {state?.gifts
              .filter(
                (g) =>
                  g.channelId === channel.id &&
                  g.at >= (channel.startedAt ?? 0),
              )
              .reduce((n, g) => n + g.amount, 0)}
          </span>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0">
          <nav className="mb-5 flex gap-6 border-b border-white/10">
            {[
              ["setup", "直播设置", "Stream setup"],
              ["devices", "设备预览", "Devices"],
              ["preview", "推流预览", "Live preview"],
              ["call", "连麦申请", "Guest requests"],
              ["replays", "本场回放", "Recordings"],
            ].map(([key, zh, en]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab(key)
                  if (key === "replays")
                    void fetch("/api/media/recordings")
                      .then((r) => r.json())
                      .then((d) => setRecordings(d.items ?? []))
                }}
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
          {/* 切换页内标签只隐藏预览，避免卸载采集组件而停播。 */}
          <div hidden={tab !== "devices"}>
            <BrowserBroadcast
              key={`${channel.id}-${user.id}`}
              channel={channel}
            />
          </div>
          <CallPanel
            host
            open={tab === "call"}
            channelId={channel.id}
            onParticipationChange={setInCall}
            endVersion={endVersion}
          />
          {tab === "preview" && (
            <div>
              <LivePlayer
                poster={channel.cover}
                forceMuted={inCall}
                browser={Boolean(channel.broadcastId)}
              />
              <p className="mt-3 text-xs text-zinc-500">
                {t(
                  "这里显示媒体服务实际收到的直播画面；切换标签不会停止网页推流。",
                  "This shows the received live feed. Switching studio tabs keeps browser publishing active.",
                )}
              </p>
            </div>
          )}
          {tab === "replays" && (
            <div className="space-y-4">
              {recordings.length ? (
                recordings.map((r) => (
                  <div
                    key={r.start}
                    className="rounded-xl border border-white/10 p-4"
                  >
                    <p className="mb-3 text-xs">
                      {new Date(r.start).toLocaleString()} ·{" "}
                      {Math.round(r.duration)}s
                    </p>
                    <video
                      controls
                      playsInline
                      src={r.url}
                      className="aspect-video w-full rounded-lg bg-black"
                    />
                  </div>
                ))
              ) : (
                <Empty
                  title={t("暂时没有本地录制", "No local recordings yet")}
                  description={t(
                    "MediaMTX 启动后会录制 live 路径；停止推流后刷新本页。",
                    "MediaMTX records the live path. Stop publishing and revisit this tab.",
                  )}
                />
              )}
            </div>
          )}
          {!["call", "devices", "preview", "replays"].includes(tab) && (
            <form onSubmit={saveSettings} className="space-y-5">
              <div className="flex flex-wrap gap-4 rounded-xl border border-white/8 bg-[#17171b] p-4">
                <Image
                  width={1280}
                  height={720}
                  src={channel.cover}
                  alt="Stream cover"
                  className="aspect-video w-36 rounded-lg object-cover"
                />
                <label className="flex flex-col justify-center gap-2 text-xs font-semibold">
                  {t("直播封面", "Stream cover")}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="max-w-[170px] text-[10px] text-zinc-500"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      if (file.size > 1000000) {
                        toast(
                          t(
                            "请选择 1MB 以内的图片",
                            "Choose an image under 1MB",
                          ),
                        )
                        return
                      }
                      const reader = new FileReader()
                      reader.onload = () =>
                        void act({
                          type: "updateRoom",
                          channelId: channel.id,
                          cover: reader.result,
                        }).catch(() => {})
                      reader.readAsDataURL(file)
                    }}
                  />
                </label>
              </div>
              <label className="block text-xs text-zinc-400">
                {t("直播标题", "Stream title")}
                <input
                  name="title"
                  defaultValue={channel.title}
                  required
                  maxLength={100}
                  className={`${inputClass} mt-2`}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs text-zinc-400">
                  {t("分类", "Category")}
                  <select
                    name="category"
                    defaultValue={channel.category}
                    className={`${inputClass} mt-2`}
                  >
                    {["irl", "gaming", "music", "creative"].map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-zinc-400">
                  {t("语言", "Language")}
                  <select
                    name="language"
                    defaultValue={channel.language}
                    className={`${inputClass} mt-2`}
                  >
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label className="block text-xs text-zinc-400">
                  {t("观看权限", "Viewing access")}
                  <select
                    name="access"
                    defaultValue={channel.access}
                    className={`${inputClass} mt-2`}
                  >
                    <option value="free">{t("免费", "Free")}</option>
                    <option value="member">{t("会员专享", "Members")}</option>
                    <option value="ticket">{t("单场付费", "Ticketed")}</option>
                  </select>
                </label>
                <label className="block text-xs text-zinc-400">
                  {t(
                    "预约时间（留空不修改）",
                    "Schedule (leave empty to keep)",
                  )}
                  <input
                    name="schedule"
                    type="datetime-local"
                    className={`${inputClass} mt-2`}
                  />
                </label>
              </div>
              <label className="block text-xs text-zinc-400">
                {t("频道公告", "Channel announcement")}
                <textarea
                  name="announcement"
                  defaultValue={channel.announcement}
                  maxLength={300}
                  rows={3}
                  className={`${inputClass} mt-2`}
                />
              </label>
              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    name="slow"
                    defaultChecked={channel.slowMode}
                  />
                  {t("慢速聊天（10 秒）", "Slow mode (10 seconds)")}
                </label>
                <select
                  aria-label="Chat permissions"
                  name="chatMode"
                  defaultValue={channel.chatMode}
                  className="rounded-lg bg-zinc-800 p-2 text-xs"
                >
                  <option value="all">
                    {t("所有登录用户", "All signed-in viewers")}
                  </option>
                  <option value="followers">
                    {t("仅关注者", "Followers only")}
                  </option>
                  <option value="members">{t("仅会员", "Members only")}</option>
                </select>
              </div>
              <Button type="submit" busy={isSaving}>
                {t("保存直播设置", "Save stream settings")}
              </Button>
            </form>
          )}
          <div className="mt-6 rounded-xl border border-white/8 bg-[#17171b] p-5">
            <h2 className="mb-4 text-sm font-semibold">
              {t("OBS 推流指引", "OBS connection guide")}
            </h2>
            <p className="mb-3 text-xs leading-6 text-zinc-500">
              {t(
                "在 OBS 选择「自定义」服务。视频 H.264，音频 AAC，关键帧间隔 2 秒。公网推流需使用服务器提供的密码。",
                "Choose Custom in OBS. H.264 video, AAC audio, 2-second keyframes. Public publishing requires your server's password.",
              )}
            </p>
            {[
              ["Server", rtmpServer],
              [
                "Stream key",
                isPublicMedia ? "live?user=publisher&pass=<推流密码>" : "live",
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="mb-2 flex items-center justify-between rounded-lg bg-black/30 p-3"
              >
                <div>
                  <p className="text-[10px] text-zinc-600">{label}</p>
                  <code className="text-xs text-zinc-300">{value}</code>
                </div>
                <button
                  type="button"
                  aria-label={`Copy ${label}`}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(value)
                      .then(() => toast(t("已复制", "Copied")))
                  }
                >
                  <Copy size={14} className="text-zinc-500" />
                </button>
              </div>
            ))}
            <Link
              href="/live/mei?source=local"
              className="mt-3 inline-block text-xs text-violet-300"
            >
              {t("打开真实直播观看页", "Watch the real live stream")} →
            </Link>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const form = new FormData(e.currentTarget)
              void act({
                type: "poll",
                channelId: channel.id,
                question: form.get("question"),
                options: [form.get("option1"), form.get("option2")],
              })
                .then(() => toast(t("投票已发布", "Poll published")))
                .catch(() => {})
            }}
            className="mt-6 space-y-3 rounded-xl border border-white/8 p-5"
          >
            <h2 className="text-sm font-semibold">
              {t("发起互动投票", "Start a poll")}
            </h2>
            <input
              name="question"
              required
              placeholder={t("你想问观众什么？", "Ask your viewers a question")}
              className={inputClass}
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                name="option1"
                required
                placeholder={t("选项一", "Option 1")}
                className={inputClass}
              />
              <input
                name="option2"
                required
                placeholder={t("选项二", "Option 2")}
                className={inputClass}
              />
            </div>
            <Button variant="secondary" type="submit">
              {t("发布投票", "Publish poll")}
            </Button>
          </form>
        </div>
        <aside className="min-w-0 overflow-hidden rounded-xl border border-white/8 xl:sticky xl:top-20 xl:self-start">
          <Chat channel={channel} />
        </aside>
      </div>
      <Modal
        open={isEndDialogOpen}
        onOpenChange={setEndDialogOpen}
        title={t("结束本场直播？", "End this session?")}
        description={t(
          "这会结束场次和本页网页推流。其他标签页会同步停播；OBS 仍需在 OBS 中停止。",
          "Ends the session and browser broadcasts. Stop OBS publishing in OBS separately.",
        )}
      >
        <Button
          variant="danger"
          className="w-full"
          onClick={() =>
            void act({ type: "end", channelId: channel.id })
              .then(() => {
                setEndVersion((version) => version + 1)
                setEndDialogOpen(false)
                setTab("replays")
              })
              .catch(() => {})
          }
        >
          {t("结束场次", "End session")}
        </Button>
      </Modal>
    </div>
  )
}
