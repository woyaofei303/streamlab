"use client"

/**
 * JD 重点：播放器接入、生命周期、异常恢复和 QoE。这里只封装 hls.js/原生 video，不是自研解码内核。
 * React 管理低频 UI；媒体对象与 Canvas 动画用 ref/effect 持有。详见 docs/ARCHITECTURE.md 的播放链路。
 */
import Hls from "hls.js"
import {
  AlertCircle,
  Captions,
  Maximize,
  MessageSquare,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Radio,
  RotateCcw,
  Settings2,
  Volume2,
  VolumeX,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { ChatMessage, Metric, Source } from "@/lib/types"
import { useApp } from "./providers"
import { Button, cn } from "./ui/primitives"
// 开发用实例计数辅助验证切房清理；归零不等于已经证明所有网络请求或浏览器堆内存无泄漏。
export const playerResources = { instances: 0, hls: 0 }
export type PlaybackMetrics = {
  state: string
  startupMs: number | null
  buffer: number
  stalls: number
  stallMs: number
  dropped: number
  level: string
  events: Metric[]
}
const initial: PlaybackMetrics = {
  state: "loading",
  startupMs: null,
  buffer: 0,
  stalls: 0,
  stallMs: 0,
  dropped: 0,
  level: "auto",
  events: [],
}
export function Player({
  source,
  poster,
  messages = [],
  onMetrics,
  onTime,
  locked = false,
  theater = false,
  onTheater,
}: {
  source: Source
  poster?: string
  messages?: ChatMessage[]
  onMetrics?: (m: PlaybackMetrics) => void
  onTime?: (n: number) => void
  locked?: boolean
  theater?: boolean
  onTheater?: () => void
}) {
  const { t } = useApp(),
    videoRef = useRef<HTMLVideoElement>(null),
    container = useRef<HTMLDivElement>(null),
    hls = useRef<Hls | null>(null),
    metrics = useRef<PlaybackMetrics>({ ...initial, events: [] }),
    metricsCallback = useRef(onMetrics),
    timeCallback = useRef(onTime)
  // 回调取最新引用，避免仅因父组件回调变化而重新创建整个播放器。
  metricsCallback.current = onMetrics
  timeCallback.current = onTime
  const [status, setStatus] = useState("loading"),
    [error, setError] = useState(""),
    [paused, setPaused] = useState(true),
    [muted, setMuted] = useState(true),
    [progress, setProgress] = useState(0),
    [duration, setDuration] = useState(0),
    [quality, setQuality] = useState(-1),
    [levels, setLevels] = useState<number[]>([]),
    [retry, setRetry] = useState(0),
    [danmu, setDanmu] = useState(true),
    [settings, setSettings] = useState(false),
    [speed, setSpeed] = useState(1),
    [captions, setCaptions] = useState(false),
    [pipAvailable, setPipAvailable] = useState(false),
    [danmakuSettings, setDanmakuSettings] = useState({
      speed: 1,
      font: 17,
      opacity: 0.85,
      density: 8,
    })
  const embedded = source.kind === "youtube" || source.kind === "twitch"
  const play = () => {
    const v = videoRef.current
    if (!v || locked) return
    v.play().catch(() => {
      setStatus("blocked")
      setError(t("点击播放开始观看", "Click play to start watching"))
    })
  }
  const toggle = () => {
    const v = videoRef.current
    if (v?.paused) play()
    else v?.pause()
  }
  const emit = useCallback((type: string, value?: number | string) => {
    const m = metrics.current
    m.events = [...m.events, { time: performance.now(), type, value }].slice(
      -200,
    )
    metricsCallback.current?.({ ...m })
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry intentionally rebuilds the media instance.
  useEffect(() => {
    if (embedded || source.kind === "webrtc") return
    const video = videoRef.current
    if (!video) return
    setPipAvailable(Boolean(document.pictureInPictureEnabled))
    // live 是当前 effect 是否仍有效的标记，不是 source.live 的“直播/点播”含义。
    let live = true,
      seenFrame = false,
      stallStart = 0,
      seeking = false,
      retries = 0,
      frame = 0
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const started = performance.now(),
      session = crypto.randomUUID()
    playerResources.instances++
    metrics.current = { ...initial, events: [] }
    setStatus("loading")
    setError("")
    setQuality(-1)
    setLevels([])
    const save = () => {
      try {
        const old = JSON.parse(
          localStorage.getItem("streamlab-playback") ?? "[]",
        )
        localStorage.setItem(
          "streamlab-playback",
          JSON.stringify(
            [
              {
                id: session,
                url: source.url,
                at: Date.now(),
                ...metrics.current,
              },
              ...old.filter((x: { id: string }) => x.id !== session),
            ].slice(0, 30),
          ),
        )
      } catch {}
    }
    // 首帧从播放器实例初始化计时；优先视频帧回调，不支持时用 playing 近似。它不等于完整页面起播耗时。
    const first = () => {
      if (seenFrame || !live) return
      seenFrame = true
      metrics.current.startupMs = Math.round(performance.now() - started)
      emit("first_frame", metrics.current.startupMs)
    }
    const finishStall = () => {
      if (stallStart) {
        metrics.current.stallMs += performance.now() - stallStart
        stallStart = 0
      }
    }
    const playing = () => {
      finishStall()
      setPaused(false)
      setError("")
      setStatus("playing")
      metrics.current.state = "playing"
      if (!("requestVideoFrameCallback" in video)) {
        first()
        emit("first_frame_approximate")
      }
      emit("playing")
    }
    // 只在首帧后、非主动暂停、非 seek 时计卡顿，并去重连续 waiting；初始加载不算播放中卡顿。
    const waiting = () => {
      if (seenFrame && !video.paused && !seeking && !stallStart) {
        stallStart = performance.now()
        metrics.current.stalls++
        emit("stall_start")
      }
      setStatus("buffering")
      metrics.current.state = "buffering"
    }
    const pause = () => {
      finishStall()
      setPaused(true)
      metrics.current.state = "paused"
      emit("pause")
    }
    const seekStart = () => {
      seeking = true
      finishStall()
      emit("seeking")
    }
    const seekEnd = () => {
      seeking = false
      emit("seeked")
    }
    const time = () => {
      setProgress(video.currentTime)
      setDuration(Number.isFinite(video.duration) ? video.duration : 0)
      timeCallback.current?.(video.currentTime)
    }
    const ended = () => {
      finishStall()
      setStatus("ended")
      setPaused(true)
      metrics.current.state = "ended"
      emit("ended")
      save()
    }
    const mediaError = () => {
      setStatus("error")
      setError(`Media error ${video.error?.code ?? ""}`)
      metrics.current.state = "error"
      emit("media_error", video.error?.message)
      save()
    }
    const handlers = {
      playing,
      waiting,
      pause,
      seeking: seekStart,
      seeked: seekEnd,
      timeupdate: time,
      ended,
      error: mediaError,
    }
    for (const [name, fn] of Object.entries(handlers))
      video.addEventListener(name, fn)
    if ("requestVideoFrameCallback" in video)
      frame = video.requestVideoFrameCallback(first)
    // 实际选择顺序：普通文件 → hls.js/MSE → 原生 HLS。解码由浏览器完成，hls.js 处理清单、分片和 ABR。
    if (source.kind === "file") {
      video.src = source.url
      video.play().catch(() => setStatus("blocked"))
    } else if (Hls.isSupported()) {
      // lowLatencyMode 需要源支持 LL-HLS 才有意义；开启此开关不会把普通点播改造成低延迟直播。
      const engine = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 20,
      })
      hls.current = engine
      playerResources.hls++
      engine.on(Hls.Events.MANIFEST_PARSED, () => {
        setLevels(engine.levels.map((l) => l.height))
        emit("manifest")
        video.play().catch(() => {
          if (live) {
            setStatus("blocked")
            setError("点击播放 / Click to play")
          }
        })
      })
      engine.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        metrics.current.level = `${engine.levels[data.level]?.height ?? "?"}p`
        emit("level_switch", metrics.current.level)
      })
      // 区分网络与媒体错误；这里限两次“应用层 fatal 恢复”，hls.js 内部请求重试不计入这两个次数。
      engine.on(Hls.Events.ERROR, (_, data) => {
        emit(data.fatal ? "fatal_error" : "hls_warning", data.details)
        if (!data.fatal) return
        if (
          retries++ < 2 &&
          (data.type === Hls.ErrorTypes.NETWORK_ERROR ||
            data.type === Hls.ErrorTypes.MEDIA_ERROR)
        ) {
          setStatus("retrying")
          const timer = setTimeout(
            () => {
              timers.delete(timer)
              if (!live) return
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                if (
                  // 初始 manifest 失败没有可加载的 level，单调用 startLoad 无法恢复，必须重新 loadSource。
                  !engine.levels.length ||
                  data.details.startsWith("manifest")
                )
                  engine.loadSource(source.url)
                else engine.startLoad()
              } else engine.recoverMediaError()
            },
            500 * 2 ** retries,
          )
          timers.add(timer)
        } else {
          setStatus("error")
          setError(data.details)
          metrics.current.state = "error"
          save()
        }
      })
      engine.loadSource(source.url)
      engine.attachMedia(video)
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source.url
      video.play().catch(() => setStatus("blocked"))
    } else {
      setStatus("error")
      setError("HLS is not supported in this browser")
    }
    // 1 秒汇总一次 QoE，缓冲只取包含 currentTime 的区间；其他不连续区间不能简单相加。
    const tick = setInterval(() => {
      if (!live) return
      let buffer = 0
      for (let i = 0; i < video.buffered.length; i++)
        if (
          video.buffered.start(i) <= video.currentTime &&
          video.buffered.end(i) >= video.currentTime
        )
          buffer = video.buffered.end(i) - video.currentTime
      metrics.current.buffer = Math.round(buffer * 10) / 10
      // 当前未支持该 API 时回落为 0；学习/面试中需说明它不是“已确认零掉帧”的证据。
      metrics.current.dropped =
        video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0
      metricsCallback.current?.({
        ...metrics.current,
        stallMs:
          metrics.current.stallMs +
          (stallStart ? performance.now() - stallStart : 0),
      })
    }, 1000)
    emit("load_start", source.url)
    return () => {
      // 卸载/切源按生命周期释放：阻止旧回调 → 落盘指标 → 清 timer/监听 → destroy HLS → 清 video src。
      live = false
      finishStall()
      save()
      clearInterval(tick)
      timers.forEach(clearTimeout)
      if (frame) video.cancelVideoFrameCallback(frame)
      for (const [name, fn] of Object.entries(handlers))
        video.removeEventListener(name, fn)
      video.pause()
      if (hls.current) {
        hls.current.destroy()
        hls.current = null
        playerResources.hls--
      }
      video.removeAttribute("src")
      video.load()
      playerResources.instances--
    }
  }, [source.url, source.kind, embedded, retry, emit])
  useEffect(() => {
    if (locked) {
      videoRef.current?.pause()
      setPaused(true)
    }
  }, [locked])
  useEffect(() => {
    const el = container.current
    const key = (e: KeyboardEvent) => {
      if (
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(
          (e.target as HTMLElement).tagName,
        )
      )
        return
      if (e.key === " ") {
        e.preventDefault()
        const v = videoRef.current
        if (v?.paused && !locked) void v.play().catch(() => {})
        else v?.pause()
      }
      if (e.key === "m") setMuted((v) => !v)
      if (e.key === "f") void el?.requestFullscreen().catch(() => {})
    }
    el?.addEventListener("keydown", key)
    return () => el?.removeEventListener("keydown", key)
  }, [locked])
  const format = (v: number) =>
    `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, "0")}`
  // iframe 自带控制能力且跨域；不要读取底层播放地址，也不要把自有播放器指标套到第三方内容。
  if (embedded) {
    const url =
      source.kind === "youtube"
        ? `https://www.youtube.com/embed/${encodeURIComponent(source.url)}?playsinline=1&rel=0`
        : `https://player.twitch.tv/?channel=${encodeURIComponent(source.url)}&parent=${typeof window === "undefined" ? "localhost" : window.location.hostname}&autoplay=false`
    return (
      <div className="aspect-video bg-black">
        <iframe
          className="size-full"
          src={url}
          title={`${source.kind} official player`}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
        <p className="p-2 text-xs text-zinc-500">
          {t(
            "官方嵌入，底层指标不可获取；受平台与网络限制。",
            "Official embed. Low-level metrics unavailable; platform/network restrictions apply.",
          )}
        </p>
      </div>
    )
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: scoped keyboard region for media controls.
    <div
      ref={container}
      className={cn(
        "group/player relative isolate aspect-video w-full overflow-hidden bg-black outline-none",
        theater && "max-h-[78dvh]",
      )}
      role="region"
      aria-label={t("视频播放器", "Video player")}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus scopes Space, M, and arrow media shortcuts.
      tabIndex={0}
      data-player-status={status}
    >
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        muted={muted}
        className="size-full object-contain"
        onClick={toggle}
        crossOrigin="anonymous"
      >
        <track
          kind="captions"
          src={source.subtitles ?? "/media/captions.vtt"}
          srcLang="en"
          label="English"
          default={false}
        />
      </video>
      {danmu && !locked && (
        <Danmaku
          videoRef={videoRef}
          messages={messages}
          settings={danmakuSettings}
        />
      )}
      <div className="pointer-events-none absolute left-4 top-4 flex gap-2">
        <span className="rounded bg-black/50 px-2 py-1 text-[10px] font-semibold tracking-wider text-white/70">
          {source.live ? "LOCAL LIVE" : "LOCAL DEMO"}
        </span>
      </div>
      {["loading", "buffering", "retrying"].includes(status) && !locked && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <span className="inline-block size-9 animate-spin rounded-full border-2 border-white/20 border-t-violet-400" />
            <p className="mt-3 text-xs text-white/70">
              {status === "retrying"
                ? t("正在重新连接…", "Reconnecting…")
                : t("正在缓冲…", "Buffering…")}
            </p>
          </div>
        </div>
      )}
      {(paused || status === "blocked") &&
        !locked &&
        status !== "error" &&
        status !== "loading" && (
          <button
            type="button"
            aria-label={t("播放视频", "Play video")}
            onClick={play}
            className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/30 bg-black/40 backdrop-blur"
          >
            <Play size={26} fill="white" />
          </button>
        )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80">
          <AlertCircle className="text-rose-400" />
          <p className="text-sm">{t("暂时无法播放", "Playback unavailable")}</p>
          <p className="max-w-[80%] truncate text-xs text-zinc-500">{error}</p>
          <Button onClick={() => setRetry((v) => v + 1)} variant="secondary">
            <RotateCcw size={15} />
            {t("重新加载", "Try again")}
          </Button>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 to-transparent px-3 pb-2 pt-10 sm:px-4">
        {!source.live && (
          <input
            aria-label={t("播放进度", "Playback position")}
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={progress}
            onChange={(e) => {
              if (videoRef.current)
                videoRef.current.currentTime = Number(e.target.value)
            }}
            className="mb-1 h-1 w-full"
          />
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggle}
              aria-label={paused ? "Play" : "Pause"}
            >
              {paused ? <Play size={18} /> : <Pause size={18} />}
            </button>
            <button
              type="button"
              onClick={() => setMuted(!muted)}
              aria-label="Toggle mute"
            >
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              className="hidden h-1 w-14 sm:block"
              aria-label="Volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              defaultValue={1}
              onChange={(e) => {
                if (videoRef.current)
                  videoRef.current.volume = Number(e.target.value)
                setMuted(false)
              }}
            />
            {source.live ? (
              <button
                type="button"
                className="flex items-center gap-1.5 text-[10px]"
                onClick={() => {
                  const v = videoRef.current
                  if (v && hls.current?.liveSyncPosition)
                    v.currentTime = hls.current.liveSyncPosition
                }}
              >
                <span className="size-1.5 rounded-full bg-rose-500" />
                LIVE
              </button>
            ) : (
              <span className="text-[10px] tabular-nums text-zinc-300">
                {format(progress)} / {format(duration)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Toggle captions"
              className={captions ? "text-violet-300" : "text-white/60"}
              onClick={() => {
                const on = !captions
                setCaptions(on)
                if (videoRef.current?.textTracks[0])
                  videoRef.current.textTracks[0].mode = on
                    ? "showing"
                    : "hidden"
              }}
            >
              <Captions size={18} />
            </button>
            <button
              type="button"
              aria-label="Toggle danmaku"
              onClick={() => setDanmu(!danmu)}
              className={danmu ? "text-violet-300" : "text-white/50"}
            >
              <MessageSquare size={17} />
            </button>
            <div className="relative">
              <button
                type="button"
                aria-label="Player settings"
                onClick={() => setSettings(!settings)}
              >
                <Settings2 size={17} />
              </button>
              {settings && (
                <div className="absolute bottom-9 right-0 w-44 space-y-3 rounded-lg border border-white/10 bg-zinc-900 p-3 text-xs">
                  {levels.length > 0 && (
                    <label className="block">
                      {t("画质", "Quality")}
                      <select
                        aria-label="Quality"
                        className="mt-1 w-full rounded bg-zinc-800 p-1"
                        value={quality}
                        onChange={(e) => {
                          const value = Number(e.target.value)
                          setQuality(value)
                          if (hls.current) hls.current.currentLevel = value
                        }}
                      >
                        <option value={-1}>{t("自动", "Auto")}</option>
                        {levels.map((l, i) => (
                          <option key={l} value={i}>
                            {l}p
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {(
                    [
                      ["speed", "弹幕速度", "Danmaku speed", 0.5, 2, 0.25],
                      ["font", "弹幕字号", "Danmaku font", 12, 24, 1],
                      ["opacity", "弹幕透明度", "Danmaku opacity", 0.2, 1, 0.1],
                      ["density", "弹幕密度", "Danmaku lanes", 1, 8, 1],
                    ] as const
                  ).map(([key, zh, en, min, max, step]) => (
                    <label key={key} className="block">
                      {t(zh, en)}
                      <input
                        type="range"
                        aria-label={en}
                        min={min}
                        max={max}
                        step={step}
                        value={danmakuSettings[key]}
                        onChange={(e) =>
                          setDanmakuSettings((s) => ({
                            ...s,
                            [key]: Number(e.target.value),
                          }))
                        }
                        className="mt-1 w-full"
                      />
                    </label>
                  ))}
                  {!source.live && (
                    <label className="block">
                      {t("倍速", "Speed")}
                      <select
                        aria-label="Playback speed"
                        value={speed}
                        onChange={(e) => {
                          setSpeed(Number(e.target.value))
                          if (videoRef.current)
                            videoRef.current.playbackRate = Number(
                              e.target.value,
                            )
                        }}
                        className="mt-1 w-full rounded bg-zinc-800 p-1"
                      >
                        {[0.5, 1, 1.25, 1.5, 2].map((v) => (
                          <option key={v} value={v}>
                            {v}×
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>
            {pipAvailable && (
              <button
                type="button"
                className="hidden sm:block"
                aria-label="Picture in picture"
                onClick={() => {
                  void videoRef.current
                    ?.requestPictureInPicture?.()
                    .catch(() => setError("Picture-in-picture unavailable"))
                }}
              >
                <PictureInPicture2 size={17} />
              </button>
            )}
            {onTheater && (
              <button
                type="button"
                className="hidden sm:block"
                aria-label="Theater mode"
                onClick={onTheater}
              >
                {theater ? <Minimize size={17} /> : <Radio size={17} />}
              </button>
            )}
            <button
              type="button"
              aria-label="Fullscreen"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen()
                else void container.current?.requestFullscreen().catch(() => {})
              }}
            >
              <Maximize size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
/** 弹幕渲染以媒体时间为基准：暂停会冻结坐标，seek 会清理旧轨迹；不按每帧 setState 驱动 React。 */
function Danmaku({
  videoRef,
  messages,
  settings,
}: {
  settings: { speed: number; font: number; opacity: number; density: number }
  videoRef: React.RefObject<HTMLVideoElement | null>
  messages: ChatMessage[]
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    latest = useRef(messages)
  latest.current = messages
  useEffect(() => {
    const el = canvas.current,
      video = videoRef.current
    if (!el || !video) return
    const ctx = el.getContext("2d")
    if (!ctx) return
    let raf = 0,
      lastTime = -1
    const seen = new Set<string>()
    let active: {
      text: string
      x: number
      lane: number
      at: number
      width: number
    }[] = []
    const lanes = Array(settings.density).fill(-100)
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
    const draw = () => {
      const width = el.clientWidth,
        height = el.clientHeight
      if (el.width !== width || el.height !== height) {
        el.width = width
        el.height = height
      }
      const now = video.currentTime
      // 当前用时间跳变推断 seek/恢复后台，属于简化调度；真实回放应接入专门的弹幕时间索引。
      if (now < lastTime - 0.5 || now > lastTime + 2) {
        active = []
        seen.clear()
        lanes.fill(-100)
      }
      lastTime = now
      ctx.clearRect(0, 0, width, height)
      ctx.font = `600 ${width < 500 ? Math.min(15, settings.font) : settings.font}px sans-serif`
      const velocity = (width / 8) * settings.speed
      // 每帧最多扫描最近 200 条，屏幕最多 40 条；超出窗口的消息允许丢弃展示，优先保证可操作性。
      for (const m of latest.current.slice(-200)) {
        if (m.deleted || seen.has(m.id)) continue
        const at = m.mediaTime ?? 0
        if (now < at || now - at > 1.5) continue
        const lane = lanes.findIndex((v) => now >= v)
        if (lane < 0 || active.length >= 40) continue
        const text = m.text.slice(0, 60),
          tw = ctx.measureText(text).width
        seen.add(m.id)
        // 同轨弹幕同速：前一条尾部离开入口并留出 50px 后再入轨，避免后一条追上。
        lanes[lane] = now + (tw + 50) / velocity
        active.push({ text, x: width, lane, at: now, width: tw })
      }
      active = active.filter(
        (m) => width - (now - m.at) * velocity + m.width > 0,
      )
      if (seen.size > 500) {
        for (const id of [...seen].slice(0, 200)) seen.delete(id)
      }
      ctx.globalAlpha = settings.opacity
      if (!reduce) {
        for (const m of active) {
          const x = width - (now - m.at) * velocity
          ctx.lineWidth = 3
          ctx.strokeStyle = "#0009"
          ctx.strokeText(m.text, x, 38 + m.lane * (settings.font + 10))
          ctx.fillStyle = "#fff"
          ctx.fillText(m.text, x, 38 + m.lane * (settings.font + 10))
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [videoRef, settings])
  return (
    <canvas
      ref={canvas}
      tabIndex={-1}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full"
    />
  )
}
