"use client"

import { Camera, Mic, MonitorUp, Radio, Square, Video } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { action } from "@/lib/api"
import { captureCamera, isPublicMedia } from "@/lib/media-config"
import { createMediaSession } from "@/lib/media-session"
import type { Channel } from "@/lib/types"
import { useApp } from "./providers"
import { Button, inputClass } from "./ui/primitives"

type BroadcastStatus = "idle" | "connecting" | "live" | "stopping"

type BrowserPublication = {
  id: string
  userId: string
  channelId: string
  session?: ReturnType<typeof createMediaSession>
  startRequest?: Promise<unknown>
}

export function BrowserBroadcast({ channel }: { channel: Channel }) {
  const { t, toast, userId, refresh, act } = useApp()

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState("")
  const [microphoneId, setMicrophoneId] = useState("")
  const [hasPreview, setHasPreview] = useState(false)
  const [isMicrophoneMuted, setMicrophoneMuted] = useState(false)
  const [status, setStatus] = useState<BroadcastStatus>("idle")

  const previewRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const publicationRef = useRef<BrowserPublication | null>(null)
  const stopPromiseRef = useRef<Promise<void> | null>(null)
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  // 取消后递增，权限弹窗晚返回时便能识别并释放旧设备。
  const captureVersionRef = useRef(0)
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  async function startPreview(screen = false): Promise<void> {
    let media: MediaStream | undefined
    const stopping = stopBroadcast()
    const token = captureVersionRef.current
    try {
      await stopping
      if (token !== captureVersionRef.current) return
      media = screen
        ? await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          })
        : await captureCamera(
            microphoneId ? { deviceId: { exact: microphoneId } } : true,
            cameraId,
          )
      if (token !== captureVersionRef.current) {
        media.getTracks().forEach((track) => {
          track.stop()
        })
        return
      }
      streamRef.current = media
      media.getVideoTracks()[0].onended = () => {
        void stopBroadcast()
      }
      // 分享画面时另取麦克风；本项目不采集系统声音。
      if (screen) {
        const audio = await navigator.mediaDevices.getUserMedia({
          audio: microphoneId ? { deviceId: { exact: microphoneId } } : true,
        })
        for (const track of audio.getTracks()) media.addTrack(track)
      }
      if (token !== captureVersionRef.current) {
        media.getTracks().forEach((track) => {
          track.stop()
        })
        return
      }
      if (previewRef.current) previewRef.current.srcObject = media
      setHasPreview(true)
      setMicrophoneMuted(false)
      setDevices(await navigator.mediaDevices.enumerateDevices())
    } catch (error) {
      media?.getTracks().forEach((track) => {
        track.stop()
      })
      if (token === captureVersionRef.current) {
        await stopBroadcast()
        toast(error instanceof Error ? error.message : "Permission denied")
      }
    }
  }

  async function startBroadcast(): Promise<void> {
    if (publicationRef.current || stopPromiseRef.current) return
    captureVersionRef.current++
    const broadcast: BrowserPublication = {
      id: crypto.randomUUID(),
      userId,
      channelId: channel.id,
    }
    publicationRef.current = broadcast
    setStatus("connecting")
    try {
      const inputStatus = await fetch("/api/media/status?path=browser", {
        signal: AbortSignal.timeout(3000),
      }).then((response) => response.json())
      if (publicationRef.current !== broadcast) return
      if (!inputStatus.online)
        throw Error(
          t(
            isPublicMedia
              ? "媒体服务暂时不可用，请稍后重试"
              : "请先启动 Docker Desktop 并运行 pnpm media:up",
            isPublicMedia
              ? "Media service unavailable"
              : "Start Docker Desktop and run pnpm media:up",
          ),
        )
      if (inputStatus.ready)
        throw Error(
          t(
            "已有网页直播，请先在原主播标签页停播",
            "Another browser is broadcasting; stop it first",
          ),
        )
      const captured =
        streamRef.current ??
        (await captureCamera(
          microphoneId ? { deviceId: { exact: microphoneId } } : true,
          cameraId,
        ))
      if (publicationRef.current !== broadcast) {
        captured.getTracks().forEach((track) => {
          track.stop()
        })
        return
      }
      streamRef.current = captured
      setMicrophoneMuted(
        captured.getAudioTracks().every((track) => !track.enabled),
      )
      if (previewRef.current) previewRef.current.srcObject = captured
      setHasPreview(true)
      captured.getVideoTracks()[0].onended = () => {
        void stopBroadcast()
      }
      const session = createMediaSession("/api/media/publish", captured)
      broadcast.session = session
      session.peer.onconnectionstatechange = () => {
        if (publicationRef.current !== broadcast) return
        clearTimeout(disconnectTimerRef.current)
        const stopAfterDisconnect = () => {
          if (publicationRef.current !== broadcast) return
          toast(
            "网页直播连接中断，已停止发送；可重新开播 / Broadcast disconnected",
          )
          void stopBroadcast()
        }
        if (session.peer.connectionState === "failed") {
          stopAfterDisconnect()
        } else if (session.peer.connectionState === "disconnected") {
          // 短暂断连留 5 秒恢复；新的连接事件会清掉这个计时器。
          disconnectTimerRef.current = setTimeout(stopAfterDisconnect, 5000)
        }
      }
      await session.connect()
      // 连接建立后，还要确认服务端收到字节，才能把房间标为直播中。
      let received = false
      for (let attempt = 0; attempt < 20; attempt++) {
        if (publicationRef.current !== broadcast) return
        const input = await fetch("/api/media/status?path=browser", {
          signal: AbortSignal.timeout(3000),
        }).then((response) => response.json())
        if (
          input.ready &&
          input.source === "webRTCSession" &&
          input.bytesReceived > 0
        ) {
          received = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      if (publicationRef.current !== broadcast) return
      if (!received)
        throw Error("媒体服务尚未收到音视频，请重试 / No media received")
      broadcast.startRequest = act({
        type: "start",
        channelId: channel.id,
        broadcastId: broadcast.id,
      })
      await broadcast.startRequest
      if (publicationRef.current !== broadcast) return
      refreshRef.current()
      setStatus("live")
    } catch (error) {
      if (publicationRef.current !== broadcast) return
      await stopBroadcast()
      toast(error instanceof Error ? error.message : "Unable to publish")
    }
  }

  const stopBroadcast = useCallback((): Promise<void> => {
    // 多个退出事件可能一起到达，只执行一次停播。
    if (stopPromiseRef.current) return stopPromiseRef.current
    captureVersionRef.current++
    clearTimeout(disconnectTimerRef.current)
    const broadcast = publicationRef.current
    publicationRef.current = null
    broadcast?.session?.close()
    streamRef.current?.getTracks().forEach((track) => {
      track.stop()
    })
    streamRef.current = null
    if (previewRef.current) previewRef.current.srcObject = null
    setHasPreview(false)
    setStatus(broadcast ? "stopping" : "idle")
    const task = (async () => {
      if (broadcast?.startRequest) {
        // 先等开播请求结束，避免结束场次后又被迟到的开播响应覆盖。
        await broadcast.startRequest.catch(() => {})
        try {
          await action({
            type: "end",
            userId: broadcast.userId,
            channelId: broadcast.channelId,
            broadcastId: broadcast.id,
          })
          refreshRef.current()
        } catch {
          toast(
            "音视频已停止；场次同步失败，请点击「结束场次」重试 / Media stopped; retry End session",
          )
        }
      }
    })()
    stopPromiseRef.current = task
    void task.finally(() => {
      stopPromiseRef.current = null
      setStatus("idle")
    })
    return task
  }, [toast])

  useEffect(() => {
    const leave = () => {
      void stopBroadcast()
    }
    window.addEventListener("pagehide", leave)
    return () => {
      window.removeEventListener("pagehide", leave)
      void stopBroadcast()
    }
  }, [stopBroadcast])
  useEffect(() => {
    if (
      status === "live" &&
      (channel.status !== "live" ||
        channel.broadcastId !== publicationRef.current?.id)
    )
      void stopBroadcast()
  }, [channel.status, channel.broadcastId, status, stopBroadcast])

  const statusText: Record<BroadcastStatus, string> = {
    idle: t("未开播", "Not broadcasting"),
    connecting: t("正在连接并确认输入…", "Connecting and checking input…"),
    live: t("网页直播中", "Broadcasting"),
    stopping: t("正在结束直播…", "Stopping…"),
  }
  const isBusy = status !== "idle"
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-400/20 bg-violet-500/5 p-4">
        <div>
          <p
            data-testid="broadcast-status"
            aria-live="polite"
            className="text-sm font-semibold"
          >
            {statusText[status]}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            {t(
              "公开演示，无需推流密码。直接使用摄像头开播，或先预览并选择屏幕；离开主播页会停播。",
              "Public demo, no publish password needed. Go live with your camera, or preview a screen first. Leaving the studio stops the broadcast.",
            )}
          </p>
        </div>
        {isBusy ? (
          <Button
            variant="danger"
            disabled={status === "stopping"}
            onClick={() => void stopBroadcast()}
          >
            {t("停止网页直播", "Stop browser broadcast")}
          </Button>
        ) : (
          <Button onClick={() => void startBroadcast()}>
            <Radio size={15} />
            {t("网页开播", "Go live in browser")}
          </Button>
        )}
      </div>
      {status === "live" && (
        <Link
          href={`/live/${channel.id}?source=browser`}
          target="_blank"
          rel="noreferrer"
          className="mb-3 inline-block text-xs text-violet-300"
        >
          {t("打开观众观看页 ↗", "Open viewer page ↗")}
        </Link>
      )}
      <div className="relative grid aspect-video place-items-center overflow-hidden rounded-xl border border-white/10 bg-black">
        {/* 预览固定静音，防止本机扬声器回授；它不影响实际发送的麦克风轨道。 */}
        <video
          ref={previewRef}
          autoPlay
          muted
          playsInline
          className="size-full object-contain"
        />
        {!hasPreview && (
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
        <Button
          variant="secondary"
          disabled={isBusy}
          onClick={() => void startPreview()}
        >
          <Camera size={15} />
          {t("摄像头", "Camera")}
        </Button>
        <Button
          variant="secondary"
          disabled={isBusy}
          onClick={() => void startPreview(true)}
        >
          <MonitorUp size={15} />
          {t("共享屏幕", "Share screen")}
        </Button>
        <Button
          variant="secondary"
          disabled={!hasPreview}
          onClick={() => {
            streamRef.current?.getAudioTracks().forEach((track) => {
              track.enabled = isMicrophoneMuted
            })
            setMicrophoneMuted(!isMicrophoneMuted)
          }}
        >
          <Mic size={15} />
          {isMicrophoneMuted ? t("取消静音", "Unmute") : t("静音", "Mute")}
        </Button>
        <Button
          variant="danger"
          disabled={!hasPreview || isBusy}
          onClick={() => void stopBroadcast()}
        >
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
              value={cameraId}
              disabled={isBusy}
              onChange={(e) => setCameraId(e.target.value)}
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
              value={microphoneId}
              disabled={isBusy}
              onChange={(e) => setMicrophoneId(e.target.value)}
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
