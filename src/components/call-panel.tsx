"use client"

import { useQuery } from "@tanstack/react-query"
import { Mic, MicOff, PhoneOff, Users, Video, VideoOff } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { CallPerson, CallSnapshot } from "@/lib/call-types"
import { captureCamera, isPublicMedia } from "@/lib/media-config"
import { createMediaSession } from "@/lib/media-session"
import { useApp } from "./providers"
import { Button, cn, inputClass } from "./ui/primitives"

const headers = (token: string) => ({ Authorization: `Bearer ${token}` })
async function command(body: object, token = "", keepalive = false) {
  const response = await fetch("/api/calls", {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive,
  })
  const result = await response.json()
  if (!response.ok) throw Error(result.error || "连麦操作失败")
  return result as { token?: string; id?: string }
}
export function useCallRoom(token = "", enabled = true) {
  return useQuery({
    queryKey: ["calls", token],
    enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/calls", {
        headers: headers(token),
        signal,
        cache: "no-store",
      })
      if (!response.ok) throw Error("连麦服务暂时不可用")
      return response.json() as Promise<CallSnapshot>
    },
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
  })
}

function RemoteSpeaker({
  id,
  token,
  name,
  muted,
  microphoneMuted = muted,
  audioOnly = false,
}: {
  id: string
  token: string
  name: string
  muted: boolean
  microphoneMuted?: boolean
  audioOnly?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt rebuilds a failed media connection.
  useEffect(() => {
    const session = createMediaSession(
      `/api/calls/media/${id}/whep`,
      undefined,
      "",
      token,
    )
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    function reconnect() {
      if (disposed || retry) return
      setError("连接中…")
      retry = setTimeout(() => setAttempt((n) => n + 1), 3000)
    }
    session.peer.ontrack = (event) => {
      if (!ref.current) return
      ref.current.srcObject = event.streams[0]
      void ref.current
        .play()
        .then(() => setError(""))
        .catch(() => setError("点击开启声音"))
    }
    session.peer.onconnectionstatechange = () => {
      if (["failed", "disconnected"].includes(session.peer.connectionState))
        reconnect()
    }
    void session.connect().catch(reconnect)
    return () => {
      disposed = true
      clearTimeout(retry)
      session.close()
    }
  }, [id, token, attempt])
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-white/10 bg-black",
        audioOnly ? "flex items-center gap-3 px-4 py-3" : "aspect-video",
      )}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        aria-label={`${name}${audioOnly ? "音频" : "连麦画面"}`}
        className={audioOnly ? "hidden" : "size-full object-cover"}
      />
      {audioOnly &&
        (microphoneMuted ? (
          <MicOff size={18} className="text-amber-300" />
        ) : (
          <Mic size={18} className="text-emerald-300" />
        ))}
      <div
        className={cn(
          "flex items-center gap-2 text-xs",
          !audioOnly && "absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2",
        )}
      >
        {!audioOnly && microphoneMuted && <MicOff size={12} />}
        <span>{name}</span>
        {error && (
          <button
            type="button"
            onClick={() =>
              void ref.current
                ?.play()
                .then(() => setError(""))
                .catch(() => {})
            }
            className="ml-auto text-amber-300"
          >
            {error}
          </button>
        )}
      </div>
    </div>
  )
}

export function CallPanel({
  host = false,
  open = true,
  channelId,
  onParticipationChange,
  endVersion = 0,
  onOpen,
}: {
  host?: boolean
  open?: boolean
  channelId: string
  onOpen?: () => void
  endVersion?: number
  onParticipationChange?: (value: boolean) => void
}) {
  const { user } = useApp()
  const [now, setNow] = useState(Date.now())
  const [token, setToken] = useState("")
  const [name, setName] = useState(user?.name ?? "")
  const [role, setRole] = useState<"主播" | "观众">("观众")
  const [source, setSource] = useState<CallSnapshot["sourceMode"]>("auto")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [publishing, setPublishing] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const session = useRef<ReturnType<typeof createMediaSession> | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const preview = useRef<HTMLVideoElement>(null)
  const auth = useRef("")
  const mounted = useRef(true)
  const { data, isError, refetch } = useCallRoom(token, channelId === "mei")
  const self = data?.self
  const ticking =
    self?.status === "pending" ||
    self?.status === "accepted" ||
    Boolean(data?.pending?.length)
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking])
  const joined = Boolean(
    token && self && ["accepted", "joined"].includes(self.status),
  )
  const stopMedia = useCallback(() => {
    session.current?.close()
    session.current = null
    stream.current?.getTracks().forEach((track) => {
      track.stop()
    })
    stream.current = null
    setPublishing(false)
  }, [])
  const leave = useCallback(() => {
    const oldToken = auth.current
    auth.current = ""
    stopMedia()
    setToken("")
    if (oldToken)
      void command({ action: host ? "close" : "leave" }, oldToken, true).catch(
        () => {},
      )
  }, [host, stopMedia])
  useEffect(() => {
    if (endVersion > 0) leave()
  }, [endVersion, leave])
  useEffect(() => {
    mounted.current = true
    window.addEventListener("pagehide", leave)
    return () => {
      mounted.current = false
      window.removeEventListener("pagehide", leave)
      leave()
    }
  }, [leave])
  useEffect(() => {
    if (
      data &&
      token &&
      (!self || !["pending", "accepted", "joined"].includes(self.status))
    )
      stopMedia()
  }, [data, token, self, stopMedia])
  useEffect(() => {
    if (!publishing) return
    stream.current?.getAudioTracks().forEach((track) => {
      track.enabled = !self?.muted
    })
  }, [self?.muted, publishing])

  useEffect(() => {
    onParticipationChange?.(publishing)
    return () => onParticipationChange?.(false)
  }, [publishing, onParticipationChange])

  const run = async (body: object) => {
    setBusy(true)
    setError("")
    try {
      await command(body, auth.current)
      await refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }
  const publish = async (id: string, credential: string) => {
    const audio = { echoCancellation: true, noiseSuppression: true }
    const media = host
      ? await navigator.mediaDevices.getUserMedia({ audio, video: false })
      : await captureCamera(audio)
    if (!mounted.current || credential !== auth.current) {
      media.getTracks().forEach((track) => {
        track.stop()
      })
      return
    }
    stream.current = media
    if (preview.current) preview.current.srcObject = media
    const connection = createMediaSession(
      `/api/calls/media/${id}/whip`,
      media,
      "",
      credential,
    )
    session.current = connection
    media.getTracks().forEach((track) => {
      track.onended = () => {
        setError("设备已断开，请重新加入")
        leave()
      }
    })
    connection.peer.onconnectionstatechange = () => {
      if (connection.peer.connectionState === "failed") {
        setError("连麦连接断开，请重新加入")
        leave()
      }
    }
    await connection.connect()
    if (mounted.current && credential === auth.current) setPublishing(true)
  }
  const enable = async () => {
    setBusy(true)
    setError("")
    try {
      const result = await command(
        host
          ? { action: "open", source, password }
          : { action: "request", name, role },
        auth.current,
      )
      if (!result.token || !result.id) throw Error("连麦凭证缺失")
      auth.current = result.token
      setToken(result.token)
      if (!mounted.current) {
        leave()
        return
      }
      if (host) {
        await publish(result.id, result.token)
        setPassword("")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "开启失败")
      if (host) leave()
    } finally {
      setBusy(false)
    }
  }
  const join = async () => {
    if (!self) return
    setBusy(true)
    setError("")
    try {
      await publish(self.id, token)
      await refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : "设备连接失败")
      leave()
    } finally {
      setBusy(false)
    }
  }
  if (channelId !== "mei")
    return open ? (
      <p className="mt-4 text-sm text-zinc-400">
        真实连麦目前在 MEI 直播间开放。
      </p>
    ) : null
  const pending = data?.pending ?? []
  const first = pending[0]
  const status = self?.status
  const ended = Boolean(
    status && ["rejected", "expired", "ended"].includes(status),
  )
  const remote = (data?.participants ?? []).filter(
    (p) => p.id !== self?.id && p.status === "joined",
  )
  const mainSource = data?.source === "live" ? "OBS / FFmpeg" : "网页开播"
  const waitingForMain =
    data?.sourceMode === "auto"
      ? "等待房主开启网页直播或 OBS 推流"
      : data?.source === "live"
        ? "等待房主在 OBS 开始推流"
        : "等待房主开启网页直播"
  const buttons = (person: CallPerson) => (
    <div className="flex gap-2">
      <Button
        disabled={busy || (data?.participants.length ?? 4) >= 4}
        onClick={() => void run({ action: "accept", id: person.id })}
      >
        接受上麦
      </Button>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => void run({ action: "reject", id: person.id })}
      >
        拒绝
      </Button>
    </div>
  )
  return (
    <>
      <section
        hidden={!open}
        aria-label="多人连麦"
        className="space-y-4 rounded-2xl border border-white/10 bg-zinc-900 p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <Users size={18} className="text-violet-300" />
            多人连麦
          </h2>
          <span className="text-xs text-zinc-400">
            {data?.participants.length ?? 0} / 4 麦位
          </span>
        </div>
        <p className="text-xs leading-6 text-zinc-400">
          主播和观众都可以申请上麦，由房主统一接受。请佩戴耳机，连麦时避免播放观众端的声音。
        </p>
        {(error || isError) && (
          <p
            role="alert"
            className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300"
          >
            {error || "连麦服务连接失败，请稍后重试"}
          </p>
        )}
        {host && (
          <label className="block text-xs text-zinc-400">
            房主画面来源
            <select
              value={joined ? data?.sourceMode : source}
              disabled={busy}
              onChange={(e) => {
                const value = e.target.value as CallSnapshot["sourceMode"]
                setSource(value)
                if (joined) void run({ action: "source", source: value })
              }}
              className={`${inputClass} mt-2`}
            >
              <option value="auto">自动识别正在直播的画面</option>
              <option value="live">OBS / FFmpeg</option>
              <option value="browser">网页开播</option>
            </select>
            {joined && (
              <span className="mt-2 block" role="status">
                {data?.input.ready ? `当前画面：${mainSource}` : waitingForMain}
              </span>
            )}
          </label>
        )}
        {!joined && status !== "pending" && (
          <div className="space-y-3">
            {ended && (
              <p role="status" className="text-sm text-amber-300">
                {status === "rejected"
                  ? "房主暂未接受你的申请"
                  : status === "expired"
                    ? "申请或连接已超时，请重新申请"
                    : "本次连麦已结束"}
              </p>
            )}
            {host ? (
              <>
                {isPublicMedia && (
                  <label className="block text-xs text-zinc-400">
                    房主验证：推流密码
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="off"
                      className={`${inputClass} mt-2`}
                    />
                  </label>
                )}
                <p className="text-xs leading-6 text-zinc-400">
                  先启动主直播，再开启连麦。网页麦克风用于实时对话；OBS
                  请关闭桌面音频或排除本网页声音，避免嘉宾声音被重复推送。
                </p>
                <Button busy={busy} onClick={() => void enable()}>
                  <Mic size={15} />
                  开启麦克风与连麦
                </Button>
              </>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                  <label className="text-xs text-zinc-400">
                    连麦昵称
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={30}
                      className={`${inputClass} mt-2`}
                    />
                  </label>
                  <label className="text-xs text-zinc-400">
                    本次身份
                    <select
                      value={role}
                      onChange={(e) =>
                        setRole(e.target.value as "主播" | "观众")
                      }
                      className={`${inputClass} mt-2`}
                    >
                      <option>观众</option>
                      <option>主播</option>
                    </select>
                  </label>
                </div>
                <Button
                  disabled={!data?.enabled || !name.trim() || isError}
                  busy={busy}
                  onClick={() => void enable()}
                >
                  申请连麦
                </Button>
                {!data?.enabled && (
                  <p className="text-xs text-zinc-500">等待房主开启连麦</p>
                )}
              </>
            )}
          </div>
        )}
        {status === "pending" && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-xl bg-violet-500/10 p-4 text-sm"
          >
            <span>
              申请已送达，等待房主接受 ·{" "}
              {Math.max(0, Math.ceil(((self?.expiresAt ?? 0) - now) / 1000))} 秒
            </span>
            <Button variant="secondary" onClick={leave}>
              取消申请
            </Button>
          </div>
        )}
        {joined && (
          <>
            {!host && !publishing && (
              <div className="rounded-xl bg-emerald-500/10 p-4">
                <p role="status" className="mb-3 text-sm text-emerald-300">
                  房主已接受，开启设备后加入直播 ·{" "}
                  {Math.max(
                    0,
                    Math.ceil(((self?.expiresAt ?? 0) - now) / 1000),
                  )}{" "}
                  秒
                </p>
                <Button busy={busy} onClick={() => void join()}>
                  开启摄像头并加入
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {publishing && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  aria-pressed={self?.muted ?? false}
                  onClick={() =>
                    void run({ action: "mute", muted: !self?.muted })
                  }
                >
                  {self?.muted ? <MicOff size={15} /> : <Mic size={15} />}
                  {self?.muted
                    ? "麦克风已静音 · 点击开启"
                    : "麦克风已开启 · 点击静音"}
                </Button>
              )}
              {publishing && !host && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    stream.current?.getVideoTracks().forEach((track) => {
                      track.enabled = cameraOff
                    })
                    setCameraOff(!cameraOff)
                  }}
                >
                  {cameraOff ? <VideoOff size={15} /> : <Video size={15} />}
                  {cameraOff ? "开启摄像头" : "关闭摄像头"}
                </Button>
              )}
              <Button variant="danger" onClick={leave}>
                <PhoneOff size={15} />
                {host ? "关闭全房连麦" : "退出连麦"}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {publishing &&
                (data?.input.ready ? (
                  <RemoteSpeaker
                    key={`main-${data.source}-${data.input.sourceId}`}
                    id="main"
                    token={token}
                    name={
                      host
                        ? `房主 · 自己（${mainSource}，本机不回放声音）`
                        : `房主 · ${mainSource}（声音来自房主麦克风）`
                    }
                    muted
                    microphoneMuted={
                      data.participants.find((p) => p.role === "房主")?.muted ??
                      false
                    }
                  />
                ) : (
                  <div
                    role="status"
                    className="flex aspect-video flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-black p-5 text-center"
                  >
                    <VideoOff size={24} className="text-zinc-500" />
                    <p className="text-sm text-zinc-300">{waitingForMain}</p>
                    <p className="text-xs leading-6 text-zinc-500">
                      {host
                        ? "在开播设备中开始网页直播，或用 OBS 推流；已有画面时可切换上方来源。"
                        : "房主开始推流后，画面会自动出现。"}
                    </p>
                  </div>
                ))}
              {!host && (
                <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black">
                  <video
                    ref={preview}
                    autoPlay
                    muted
                    playsInline
                    aria-label="我的连麦预览"
                    className="size-full object-cover"
                  />
                  <p className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-xs">
                    {name} · 自己（本机不回放声音）
                  </p>
                </div>
              )}
              {publishing &&
                remote
                  .filter((p) => p.role !== "房主")
                  .map((p) => (
                    <RemoteSpeaker
                      key={p.id}
                      id={p.id}
                      token={token}
                      name={`${p.name} · ${p.role}`}
                      muted={p.muted}
                    />
                  ))}
            </div>
            {publishing &&
              remote
                .filter((p) => p.role === "房主")
                .map((p) => (
                  <RemoteSpeaker
                    key={p.id}
                    id={p.id}
                    token={token}
                    name="房主麦克风 · 实时语音"
                    muted={p.muted}
                    audioOnly
                  />
                ))}
            <p role="status" className="text-xs text-zinc-400">
              {data?.mix.state === "ready"
                ? "多人画面已合成，观众正在观看连麦直播"
                : data?.mix.message || "等待嘉宾加入"}
            </p>
            {host && (
              <div className="space-y-2">
                {data?.participants
                  .filter((p) => p.id !== self?.id)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl bg-white/5 p-3 text-xs"
                    >
                      <span className="mr-auto">
                        {p.name} · {p.role} ·{" "}
                        {p.status === "joined" ? "已上麦" : "等待设备"}
                        {p.muted ? " · 已静音" : ""}
                      </span>
                      <Button
                        variant="secondary"
                        disabled={p.muted || busy}
                        onClick={() =>
                          void run({ action: "mute", id: p.id, muted: true })
                        }
                      >
                        静音
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void run({ action: "leave", id: p.id })}
                      >
                        移出
                      </Button>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
        {host && joined && (
          <div className="space-y-3 border-t border-white/10 pt-4">
            <h3 className="text-sm">连麦申请 · {pending.length}</h3>
            {pending.length ? (
              pending.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/5 p-3"
                >
                  <p className="text-sm">
                    {p.name}
                    <span className="ml-2 text-xs text-zinc-400">{p.role}</span>
                  </p>
                  {buttons(p)}
                </div>
              ))
            ) : (
              <p className="text-xs text-zinc-500">
                暂无待处理申请，收到申请时会在右下角提醒
              </p>
            )}
          </div>
        )}
      </section>
      {host && first && (
        <aside
          role="status"
          aria-label="新的连麦申请"
          className="fixed right-4 bottom-5 z-50 w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-violet-400/40 bg-zinc-900 p-5 shadow-2xl shadow-black/60"
        >
          <div className="mb-3 flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-violet-500/20 text-violet-300">
              <Mic size={19} />
            </span>
            <div>
              <h3 className="text-sm font-semibold">
                收到连麦申请{" "}
                <span className="text-violet-300">
                  {pending.length > 1 ? `+${pending.length - 1}` : ""}
                </span>
              </h3>
              <p className="mt-1 text-xs text-zinc-400">
                {first.name} · {first.role} ·{" "}
                {Math.max(0, Math.ceil((first.expiresAt - now) / 1000))}{" "}
                秒后过期
              </p>
            </div>
          </div>
          {buttons(first)}
          {error && (
            <p role="alert" className="mt-3 text-xs text-red-300">
              {error}
            </p>
          )}
        </aside>
      )}
      {!host &&
        !open &&
        token &&
        self &&
        ["pending", "accepted", "joined"].includes(self.status) && (
          <aside
            role="status"
            className="fixed right-4 bottom-5 z-50 max-w-sm rounded-2xl border border-violet-400/40 bg-zinc-900 p-4 shadow-2xl"
          >
            <p className="mb-3 text-sm">
              {publishing
                ? "你正在连麦"
                : self.status === "pending"
                  ? "连麦申请已送达，等待房主接受"
                  : "房主已接受，请进入连麦区开启设备"}
            </p>
            <div className="flex gap-2">
              <Button onClick={onOpen}>返回连麦</Button>
              <Button variant="secondary" onClick={leave}>
                {self.status === "pending" ? "取消申请" : "退出连麦"}
              </Button>
            </div>
          </aside>
        )}
    </>
  )
}
