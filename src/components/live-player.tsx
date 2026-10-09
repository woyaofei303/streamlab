"use client"

import { useQuery } from "@tanstack/react-query"
import type { ComponentProps } from "react"
import { hlsLiveUrl, isPublicMedia, webrtcBase } from "@/lib/media-config"
import type { Source } from "@/lib/types"
import { useCallRoom } from "./call-panel"
import { Player } from "./player"
import { useApp } from "./providers"

// OBS/FFmpeg 用 HLS 观看，网页开播用 WHEP 观看。
export const localLiveSource: Source = {
  kind: "hls",
  url: hlsLiveUrl,
  live: true,
}
export const browserLiveSource: Source = {
  kind: "webrtc",
  url: `${webrtcBase}/browser/whep`,
  live: true,
}

type MediaStatus = {
  online: boolean
  ready: boolean
  source?: string | null
  sourceId?: string | null
  tracks?: string[]
  bytesReceived?: number
}

// 主播和观众共用真实输入状态；按流名分别缓存。
export function useMediaStatus(path: "live" | "browser" = "live") {
  return useQuery({
    queryKey: ["media-status", path],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        path === "live"
          ? "/api/media/status"
          : "/api/media/status?path=browser",
        {
          signal,
          cache: "no-store",
        },
      )
      if (!response.ok) throw Error("Media status unavailable")
      return response.json() as Promise<MediaStatus>
    },
    // 这里只轮询状态，视频通过自己的连接持续传输。
    refetchInterval: 2000,
    refetchOnWindowFocus: true,
  })
}

export function LivePlayer({
  browser = false,
  ...props
}: Omit<ComponentProps<typeof Player>, "source"> & { browser?: boolean }) {
  const { t } = useApp()
  const calls = useCallRoom()
  const mixed =
    calls.data?.source === (browser ? "browser" : "live") &&
    calls.data.mix.state === "ready"
      ? calls.data.mix.url
      : undefined
  const { data, isPending, isError } = useMediaStatus(
    browser ? "browser" : "live",
  )
  const ready = !isError && data?.ready
  const online = !isError && data?.online

  let statusText: string
  if (isPending) {
    statusText = t("正在检测媒体服务", "Checking media service")
  } else if (!online) {
    statusText = t("媒体服务未连接", "Media service unavailable")
  } else if (ready) {
    statusText = mixed
      ? t(
          "多人连麦直播 · 720p 实时播放",
          "Group call · 720p real-time playback",
        )
      : t("已接收真实直播流", "Receiving a real live stream")
  } else if (browser) {
    statusText = t("等待网页开播", "Waiting for browser broadcast")
  } else {
    statusText = t("等待 RTMP 推流", "Waiting for RTMP input")
  }

  let waitingHint: string
  if (!online) {
    waitingHint = isPublicMedia
      ? t(
          "媒体服务暂时不可用，请稍后重试。",
          "Media service unavailable. Please retry shortly.",
        )
      : t(
          "请启动 Docker Desktop，再运行 pnpm media:up。",
          "Start Docker Desktop, then run pnpm media:up.",
        )
  } else if (browser) {
    waitingHint = t(
      "主播尚未开始网页直播，收到信号后自动播放。",
      "Playback starts when the creator goes live.",
    )
  } else {
    waitingHint = t(
      "在 OBS 开始推流，收到信号后自动播放。",
      "Start streaming in OBS. Playback starts when input arrives.",
    )
  }

  return (
    <div>
      <div className="space-y-2 border-b border-white/10 bg-zinc-900 px-4 py-3 text-xs">
        <p
          role="status"
          data-testid="live-input-status"
          className={ready ? "text-emerald-300" : "text-amber-300"}
        >
          {statusText}
        </p>
        {ready ? (
          <p className="break-words font-mono text-zinc-400">
            {data?.source} · {data?.tracks?.join(" + ")} ·{" "}
            {t("已接收", "Received")}{" "}
            {((data?.bytesReceived ?? 0) / 1024 / 1024).toFixed(2)} MiB
          </p>
        ) : (
          <p className="text-zinc-400">{waitingHint}</p>
        )}
        <p className="break-all text-zinc-500">
          {mixed
            ? "实时连麦合流 → WebRTC"
            : browser
              ? "WebRTC → MediaMTX → WebRTC"
              : "RTMP → MediaMTX → HLS"}{" "}
          → {t("浏览器", "Browser")}
        </p>
      </div>
      {/* 断流时卸载播放器；网页重开时用 sourceId 换掉旧连接。 */}
      {ready ? (
        <Player
          key={mixed || (browser ? data?.sourceId : "rtmp")}
          {...props}
          source={
            mixed
              ? { kind: "webrtc", url: mixed, live: true }
              : browser
                ? browserLiveSource
                : localLiveSource
          }
        />
      ) : (
        <div className="grid aspect-video place-items-center bg-black px-5 text-center text-sm text-zinc-500">
          {t("等待真实画面，当前没有播放测试素材", "Waiting for live video")}
        </div>
      )}
    </div>
  )
}
