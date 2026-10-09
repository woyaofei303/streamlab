"use client"

/** 开发实验入口：媒体故障作用于真实 TS 请求；业务故障作用于 MSW。两种故障不要混为网络模拟。 */
import { Download, RefreshCcw, RotateCcw } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import type { Scenario } from "@/lib/types"
import { LivePlayer, localLiveSource } from "./live-player"
import { type PlaybackMetrics, Player, playerResources } from "./player"
import { useApp } from "./providers"
import { MediaRtc, RtcLab } from "./rtc-lab"
import { Button, cn, inputClass, Modal } from "./ui/primitives"
export function Lab() {
  const { state, t, act, toast, refresh } = useApp(),
    [tab, setTab] = useState("playback"),
    [source, setSource] = useState("/media/master.m3u8"),
    [metrics, setMetrics] = useState<PlaybackMetrics | null>(null),
    [reset, setReset] = useState(false),
    [resources, setResources] = useState({ ...playerResources }),
    [sessions, setSessions] = useState<
      {
        id: string
        at: number
        url: string
        startupMs: number
        stalls: number
      }[]
    >([]),
    [stress, setStress] = useState(0),
    timer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (window.location.hash === "#rtc") setTab("rtc")
    setSessions(JSON.parse(localStorage.getItem("streamlab-playback") ?? "[]"))
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [])
  useEffect(() => {
    if (tab === "records") setResources({ ...playerResources })
  }, [tab])
  const download = (data: unknown) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    )
    const a = document.createElement("a")
    a.href = url
    a.download = `streamlab-metrics-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const startStress = () => {
    if (timer.current) return
    let seconds = 0
    setStress(1)
    timer.current = setInterval(() => {
      seconds++
      setStress(seconds)
      void act({ type: "burst", channelId: "mei", count: 100 }).catch(() => {})
      if (seconds >= 60 && timer.current) {
        clearInterval(timer.current)
        timer.current = null
        setStress(0)
        toast(
          t(
            "6000 条消息压测已发送，请检查聊天与指标。",
            "6,000 test messages sent. Inspect chat and metrics.",
          ),
        )
      }
    }, 1000)
  }
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[10px] tracking-widest text-violet-400">
            DEVELOPER PLAYGROUND
          </p>
          <h1 className="text-2xl font-bold">
            {t("看见每一帧背后的故事", "See what happens behind every frame")}
          </h1>
          <p className="mt-3 text-xs leading-6 text-zinc-500">
            {t(
              "真实播放指标、可复现故障与本地实时音视频。实验结果不代表生产 CDN 性能。",
              "Real playback metrics, reproducible failures, and local realtime media. Results do not represent production CDN performance.",
            )}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setReset(true)}>
          <RotateCcw size={14} />
          {t("重置演示", "Reset demo")}
        </Button>
      </div>
      <nav className="mb-6 flex gap-6 overflow-x-auto border-b border-white/10">
        {[
          ["playback", "播放诊断", "Playback"],
          ["scenarios", "业务故障", "Scenarios"],
          ["rtc", "WebRTC 实训", "WebRTC"],
          ["records", "会话记录", "Sessions"],
          ["guide", "实验指引", "Guide"],
        ].map(([key, zh, en]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "shrink-0 border-b-2 pb-3 text-xs",
              tab === key
                ? "border-violet-400 text-white"
                : "border-transparent text-zinc-500",
            )}
          >
            {t(zh, en)}
          </button>
        ))}
      </nav>
      {tab === "playback" && (
        <div className="space-y-5">
          <label className="block text-xs text-zinc-400">
            {t("测试播放源", "Test source")}
            <select
              className={`${inputClass} mt-2`}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="/media/master.m3u8">
                {t("本地多码率 HLS", "Local multi-bitrate HLS")}
              </option>
              <option value={localLiveSource.url}>
                OBS / FFmpeg · RTMP → LL-HLS
              </option>
              <option value="/api/media/fault/master.m3u8?mode=slow">
                {t("慢分片：额外 1500ms", "Slow segments: +1500ms")}
              </option>
              <option value="/api/media/fault/master.m3u8?mode=bandwidth">
                {t("分片限速：约 0.5 Mbps", "Segment throttle: ~0.5 Mbps")}
              </option>
              <option value="/api/media/fault/master.m3u8?mode=fail">
                {t(
                  "分片故障：固定序号返回 503",
                  "Segment failure: deterministic 503",
                )}
              </option>
              <option value="/api/media/fault/missing.m3u8">
                {t("不存在的流：404", "Missing stream: 404")}
              </option>
            </select>
          </label>
          {source === localLiveSource.url ? (
            <LivePlayer onMetrics={setMetrics} />
          ) : (
            <Player
              source={{
                kind: "hls",
                url: source,
                live: source.includes(":8888"),
              }}
              onMetrics={setMetrics}
            />
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [
                t("首帧", "First frame"),
                metrics?.startupMs ? `${metrics.startupMs}ms` : "—",
              ],
              [t("缓冲", "Buffer"), `${metrics?.buffer ?? 0}s`],
              [
                t("卡顿", "Stalls"),
                `${metrics?.stalls ?? 0} / ${Math.round(metrics?.stallMs ?? 0)}ms`,
              ],
              [t("掉帧", "Dropped frames"), metrics?.dropped ?? 0],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-xl border border-white/10 bg-[#17171b] p-4"
              >
                <p className="text-xs text-zinc-500">{label}</p>
                <p className="mt-2 font-mono text-xl">{value}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-white/10 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                {t("事件时间线", "Event timeline")}
              </h2>
              <Button variant="ghost" onClick={() => download(metrics)}>
                <Download size={14} />
                {t("导出", "Export")}
              </Button>
            </div>
            <div className="max-h-60 overflow-auto font-mono text-[10px]">
              {metrics?.events
                .slice()
                .reverse()
                .map((e) => (
                  <div
                    key={`${e.time}-${e.type}`}
                    className="flex gap-4 border-b border-white/5 py-2"
                  >
                    <span className="w-16 shrink-0 text-zinc-600">
                      {Math.round(e.time)}ms
                    </span>
                    <span className="w-28 shrink-0 text-violet-300">
                      {e.type}
                    </span>
                    <span className="break-all text-zinc-400">{e.value}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
      {tab === "scenarios" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 p-5">
            <h2 className="mb-4 text-sm font-semibold">
              {t("模拟接口场景", "Mock API scenario")}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  "normal",
                  "slow",
                  "error",
                  "disconnect",
                  "duplicate",
                  "reorder",
                  "expired",
                  "timeout",
                ] as Scenario[]
              ).map((s) => (
                <Button
                  key={s}
                  variant={state?.scenario === s ? "primary" : "secondary"}
                  onClick={() =>
                    void act({ type: "scenario", value: s }).catch(() => {})
                  }
                >
                  {s}
                </Button>
              ))}
            </div>
            <p className="mt-4 text-xs text-zinc-500">
              {t(
                "影响模拟商业接口与消息。恢复 normal 后继续正常操作。",
                "Affects simulated business APIs and messages. Select normal to restore.",
              )}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 p-5">
            <h2 className="mb-4 text-sm font-semibold">
              {t(
                "会员到期与高频消息",
                "Expiration and high-frequency messages",
              )}
            </h2>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() =>
                  void act({ type: "clock", days: 31 })
                    .then(() =>
                      toast(
                        t(
                          "演示时钟已前进 31 天",
                          "Demo clock advanced 31 days",
                        ),
                      ),
                    )
                    .catch(() => {})
                }
              >
                {t("前进 31 天", "Advance 31 days")}
              </Button>
              <Button
                variant="secondary"
                disabled={stress > 0}
                onClick={startStress}
              >
                {stress
                  ? `${stress}/60s`
                  : t(
                      "MEI：100 条/秒，持续 60 秒",
                      "MEI: 100 messages/s for 60s",
                    )}
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void act({
                    type: "burst",
                    channelId: "mei",
                    count: 100,
                  }).catch(() => {})
                }
              >
                {t("发送 100 条测试消息", "Send 100 test messages")}
              </Button>
            </div>
            <p className="mt-4 text-xs text-zinc-500">
              {t(
                "在另一标签页打开 MEI 直播间观察。测试消息和历史均有保留上限。",
                "Watch MEI in another tab. Test messages and history have retention caps.",
              )}
            </p>
          </div>
        </div>
      )}
      {tab === "rtc" && (
        <div id="rtc" className="space-y-6">
          <RtcLab />
          <MediaRtc />
        </div>
      )}
      {tab === "records" && (
        <div className="space-y-3">
          <Button
            variant="secondary"
            onClick={() =>
              setSessions(
                JSON.parse(localStorage.getItem("streamlab-playback") ?? "[]"),
              )
            }
          >
            <RefreshCcw size={14} />
            {t("刷新记录", "Refresh")}
          </Button>
          <p className="text-xs text-zinc-500">
            {t("当前播放器实例", "Active players")}:{" "}
            <span data-testid="player-count">{resources.instances}</span> · HLS:{" "}
            {resources.hls}
          </p>
          {sessions.map((s) => (
            <div key={s.id} className="rounded-xl border border-white/10 p-4">
              <p className="truncate font-mono text-xs text-violet-300">
                {s.url}
              </p>
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-zinc-500">
                <span>{new Date(s.at).toLocaleString()}</span>
                <span>
                  First frame: {s.startupMs ?? "N/A"} ms · Stalls: {s.stalls}
                </span>
              </div>
            </div>
          ))}
          <Button variant="ghost" onClick={() => download(sessions)}>
            <Download size={14} />
            {t("导出全部记录", "Export sessions")}
          </Button>
        </div>
      )}
      {tab === "guide" && (
        <div className="space-y-5 rounded-xl border border-white/10 p-6 text-sm leading-7 text-zinc-400">
          <h2 className="font-semibold text-white">
            {t("三个可复现的实验", "Three reproducible experiments")}
          </h2>
          <p>
            1.{" "}
            {t(
              "正常 HLS 与慢分片各播放三次，比较首帧和缓冲。DevTools Network 限速后观察自动码率，保留相同设备与播放源。",
              "Play normal and slow HLS three times each. Compare startup and buffer. Throttle Network in DevTools and inspect ABR under identical conditions.",
            )}
          </p>
          <p>
            2.{" "}
            {t(
              "MEI 聊天中发送消息，在这里切换 duplicate / reorder / disconnect，恢复 normal 后检查消息顺序和重复情况。",
              "Send chat messages, select duplicate / reorder / disconnect, restore normal, and inspect replay and deduplication.",
            )}
          </p>
          <p>
            3.{" "}
            {t(
              "使用两个标签页建立 WebRTC 通话，观察实际 getStats。挂断后确认摄像头指示灯关闭。",
              "Establish a two-tab WebRTC call, inspect getStats, then hang up and verify device release.",
            )}
          </p>
          <h3 className="text-white">
            {t("指标口径", "Measurement definitions")}
          </h3>
          <p>
            {t(
              "首帧：播放器初始化到首个视频帧回调；不支持时以 playing 近似并标记。卡顿：已起播、未暂停且未 seek 时的等待区间。计时使用 performance.now。",
              "First frame: initialization to video frame callback, with a labeled playing-event approximation when unavailable. Stalls: waiting after startup, excluding pause and seek. Timing uses performance.now.",
            )}
          </p>
          <p>
            {t(
              "第三方嵌入不提供完整底层指标。本地实验不证明跨境性能，也不模拟真实支付安全。",
              "Third-party embeds do not expose complete low-level metrics. Local experiments do not prove cross-border performance or payment security.",
            )}
          </p>
        </div>
      )}
      <Modal
        open={reset}
        onOpenChange={setReset}
        title={t("重置本项目演示数据？", "Reset this project’s demo data?")}
        description={t(
          "只清理 StreamLab 的本地订单、聊天、关注和场景设置，恢复初始数据。",
          "Resets StreamLab orders, chat, follows, and scenarios to the initial seed.",
        )}
      >
        <Button
          variant="danger"
          className="w-full"
          onClick={() =>
            void api("reset", {}).then(() => {
              localStorage.removeItem("streamlab-playback")
              refresh()
              setReset(false)
              toast(t("演示数据已重置", "Demo reset"))
            })
          }
        >
          {t("确认重置", "Reset demo")}
        </Button>
      </Modal>
    </div>
  )
}
