"use client"

/** 轻量主播页：管理业务场次与房间互动，媒体信号单独查询 MediaMTX；不是运营管理后台。 */
import {
  Camera,
  Copy,
  Mic,
  MonitorUp,
  Radio,
  Square,
  Video,
} from "lucide-react"
import Image from "next/image"
import { useCallback, useEffect, useRef, useState } from "react"
import { Chat } from "./chat"
import { Player } from "./player"
import { useApp } from "./providers"
import { RtcLab } from "./rtc-lab"
import { Button, cn, Empty, inputClass, Modal } from "./ui/primitives"

function DevicePreview() {
  const { t, toast } = useApp(),
    video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [camera, setCamera] = useState(""),
    [mic, setMic] = useState(""),
    [active, setActive] = useState(false),
    [muted, setMuted] = useState(false)
  const generation = useRef(0)
  const stop = useCallback(() => {
    generation.current++
    stream.current?.getTracks().forEach((track) => {
      track.stop()
    })
    stream.current = null
    if (video.current) video.current.srcObject = null
    setActive(false)
  }, [])
  useEffect(
    () => () => {
      generation.current++
      stream.current?.getTracks().forEach((track) => {
        track.stop()
      })
    },
    [],
  )
  const start = async (screen = false) => {
    try {
      stop()
      // 设备请求是异步的；停止/切设备会推进代次，迟到结果必须 stop，不能重新占用摄像头。
      const token = generation.current
      const media = screen
        ? await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          })
        : await navigator.mediaDevices.getUserMedia({
            video: camera ? { deviceId: { exact: camera } } : true,
            audio: mic ? { deviceId: { exact: mic } } : true,
          })
      if (token !== generation.current) {
        media.getTracks().forEach((track) => {
          track.stop()
        })
        return
      }
      stream.current = media
      if (video.current) video.current.srcObject = media
      setActive(true)
      setMuted(false)
      media.getVideoTracks()[0].onended = stop
      setDevices(await navigator.mediaDevices.enumerateDevices())
    } catch (e) {
      toast(e instanceof Error ? e.message : "Permission denied")
    }
  }
  return (
    <div>
      <div className="relative grid aspect-video place-items-center overflow-hidden rounded-xl border border-white/10 bg-black">
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          className="size-full object-contain"
        />
        {!active && (
          <div className="absolute text-center">
            <Video size={32} className="mx-auto text-zinc-600" />
            <p className="mt-3 text-sm text-zinc-500">
              {t("开启设备，预览你的画面", "Enable your devices to preview")}
            </p>
            <p className="mt-1 text-[10px] text-zinc-600">
              {t(
                "仅在本机预览，不会自动发布",
                "Local preview only. Nothing is published automatically.",
              )}
            </p>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void start()}>
          <Camera size={15} />
          {t("摄像头", "Camera")}
        </Button>
        <Button variant="secondary" onClick={() => void start(true)}>
          <MonitorUp size={15} />
          {t("共享屏幕", "Share screen")}
        </Button>
        <Button
          variant="secondary"
          disabled={!active}
          onClick={() => {
            stream.current?.getAudioTracks().forEach((track) => {
              track.enabled = muted
            })
            setMuted(!muted)
          }}
        >
          <Mic size={15} />
          {muted ? t("取消静音", "Unmute") : t("静音", "Mute")}
        </Button>
        <Button variant="danger" disabled={!active} onClick={stop}>
          <Square size={13} />
          {t("停止预览", "Stop")}
        </Button>
      </div>
      {devices.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-zinc-500">
            {t("摄像头（选择后重新开启）", "Camera (restart to apply)")}
            <select
              className={`${inputClass} mt-1`}
              value={camera}
              onChange={(e) => setCamera(e.target.value)}
            >
              <option value="">Default</option>
              {devices
                .filter((d) => d.kind === "videoinput")
                .map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs text-zinc-500">
            {t("麦克风", "Microphone")}
            <select
              className={`${inputClass} mt-1`}
              value={mic}
              onChange={(e) => setMic(e.target.value)}
            >
              <option value="">Default</option>
              {devices
                .filter((d) => d.kind === "audioinput")
                .map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
export function Studio() {
  const { state, user, t, act, setAuthOpen, toast } = useApp(),
    [tab, setTab] = useState("setup"),
    [end, setEnd] = useState(false),
    [signal, setSignal] = useState(false),
    [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [recordings, setRecordings] = useState<
      { start: string; duration: number; url: string }[]
    >([])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const c = state?.channels.find((c) => c.ownerId === user?.id)
  const roomId = c?.id
  useEffect(() => {
    if (!roomId) return
    let live = true
    const check = () =>
      fetch("/api/media/status")
        .then((r) => r.json())
        .then((d) => {
          if (live) setSignal(!!d.ready)
        })
        .catch(() => {
          if (live) setSignal(false)
        })
    void check()
    // 5 秒轮询实际输入信号，与 channel.status（用户控制的业务场次）分开；开播按钮不负责启动 OBS。
    const timer = setInterval(check, 5000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [roomId])
  if (!user || !c)
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
  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true)
    const f = new FormData(e.currentTarget)
    try {
      await act({
        type: "updateRoom",
        channelId: c.id,
        title: f.get("title"),
        category: f.get("category"),
        language: f.get("language"),
        access: f.get("access"),
        announcement: f.get("announcement"),
        slowMode: f.get("slow") === "on",
        chatMode: f.get("chatMode"),
        ...(f.get("schedule")
          ? { scheduledAt: new Date(String(f.get("schedule"))).getTime() }
          : {}),
      })
      toast(t("直播设置已保存", "Stream settings saved"))
    } catch {
    } finally {
      setBusy(false)
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
              signal ? "text-emerald-300" : "text-zinc-500",
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                signal ? "bg-emerald-400" : "bg-zinc-600",
              )}
            />
            {signal
              ? t("输入信号正常", "Signal detected")
              : t("等待推流信号", "Waiting for signal")}
          </span>
          <Button variant="secondary" onClick={() => setEnd(true)}>
            {t("结束场次", "End session")}
          </Button>
          <Button
            onClick={() =>
              void act({ type: "start", channelId: c.id })
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
            {t("开始场次", "Start session")}
          </Button>
        </div>
      </div>
      {c.startedAt && (
        <div className="mb-5 flex flex-wrap gap-6 rounded-xl border border-white/10 bg-white/5 p-4 text-xs">
          <span>
            {c.endedAt
              ? t("本场已结束", "Session ended")
              : t("直播时长", "Live duration")}
            :{" "}
            {Math.max(
              0,
              Math.floor(
                ((c.endedAt ?? now + (state?.clockOffset ?? 0)) - c.startedAt) /
                  1000,
              ),
            )}
            s
          </span>
          <span>
            {t("本场消息", "Session messages")}:{" "}
            {
              state?.messages.filter(
                (m) => m.roomId === c.id && m.time >= (c.startedAt ?? 0),
              ).length
            }
          </span>
          <span>
            {t("本场礼物币", "Session gift credits")}:{" "}
            {state?.gifts
              .filter((g) => g.channelId === c.id && g.at >= (c.startedAt ?? 0))
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
          {tab === "call" ? (
            <div className="space-y-4">
              {Object.entries(c.callRequests ?? {})
                .filter(([, status]) => status !== "ended")
                .map(([id, status]) => (
                  <div
                    key={id}
                    className="flex flex-wrap items-center gap-3 rounded-lg bg-white/5 p-3 text-xs"
                  >
                    <span>
                      {state?.users.find((u) => u.id === id)?.name} · {status}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void act({
                          type: "answerCall",
                          channelId: c.id,
                          target: id,
                          value: "accepted",
                        }).catch(() => {})
                      }
                    >
                      {t("接受申请", "Accept request")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void act({
                          type: "answerCall",
                          channelId: c.id,
                          target: id,
                          value: "rejected",
                        }).catch(() => {})
                      }
                    >
                      {t("拒绝", "Decline")}
                    </Button>
                  </div>
                ))}
              <RtcLab roomId={c.id} />
            </div>
          ) : tab === "devices" ? (
            <DevicePreview />
          ) : tab === "preview" ? (
            <div>
              <Player
                source={{
                  kind: "hls",
                  url: "http://localhost:8888/live/index.m3u8",
                  live: true,
                }}
                poster={c.cover}
              />
              <p className="mt-3 text-xs text-zinc-500">
                {t(
                  "启动 MediaMTX 并从 OBS 推流后，预览会显示真实画面。",
                  "Start MediaMTX and publish from OBS to view the live feed.",
                )}
              </p>
            </div>
          ) : tab === "replays" ? (
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
          ) : (
            <form onSubmit={save} className="space-y-5">
              <div className="flex flex-wrap gap-4 rounded-xl border border-white/8 bg-[#17171b] p-4">
                <Image
                  width={1280}
                  height={720}
                  src={c.cover}
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
                          channelId: c.id,
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
                  defaultValue={c.title}
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
                    defaultValue={c.category}
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
                    defaultValue={c.language}
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
                    defaultValue={c.access}
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
                  defaultValue={c.announcement}
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
                    defaultChecked={c.slowMode}
                  />
                  {t("慢速聊天（10 秒）", "Slow mode (10 seconds)")}
                </label>
                <select
                  aria-label="Chat permissions"
                  name="chatMode"
                  defaultValue={c.chatMode}
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
              <Button type="submit" busy={busy}>
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
                "先运行 pnpm media:up，再在 OBS 选择「自定义」服务。视频 H.264，音频 AAC，关键帧间隔 2 秒。",
                "Run pnpm media:up, choose Custom in OBS. H.264 video, AAC audio, 2-second keyframes.",
              )}
            </p>
            {[
              ["Server", "rtmp://127.0.0.1:1935"],
              ["Stream key", "live"],
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
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              void act({
                type: "poll",
                channelId: c.id,
                question: f.get("question"),
                options: [f.get("option1"), f.get("option2")],
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
          <Chat channel={c} />
        </aside>
      </div>
      <Modal
        open={end}
        onOpenChange={setEnd}
        title={t("结束本场直播？", "End this session?")}
        description={t(
          "这会结束本地场次状态。OBS 推流需要在 OBS 中停止，录制随后完成。",
          "This ends the local session state. Stop publishing in OBS separately to finalize the recording.",
        )}
      >
        <Button
          variant="danger"
          className="w-full"
          onClick={() =>
            void act({ type: "end", channelId: c.id })
              .then(() => {
                setEnd(false)
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
