"use client"

/**
 * 两条真实 WebRTC 实训链路：RtcLab 用 BroadcastChannel 交换双标签信令；MediaRtc 用 HTTP SDP 接 MediaMTX。
 * 信令不承载音视频；音视频走 RTCPeerConnection。未接公网信令、STUN/TURN 或 SFU。
 */
import { Camera, Mic, Phone, PhoneOff, Video } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useApp } from "./providers"
import { Button } from "./ui/primitives"

type Signal = {
  from: string
  to?: string
  type: "invite" | "accept" | "offer" | "answer" | "ice" | "end"
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}
export function RtcLab({ roomId = "lab" }: { roomId?: string }) {
  const { t, toast } = useApp(),
    local = useRef<HTMLVideoElement>(null),
    remote = useRef<HTMLVideoElement>(null),
    pc = useRef<RTCPeerConnection | null>(null),
    media = useRef<MediaStream | null>(null),
    bus = useRef<BroadcastChannel | null>(null),
    self = useRef(""),
    other = useRef(""),
    generation = useRef(0),
    candidates = useRef<RTCIceCandidateInit[]>([]),
    [status, setStatus] = useState("idle"),
    [incoming, setIncoming] = useState(""),
    [stats, setStats] = useState({ packets: 0, lost: 0, jitter: 0 }),
    [muted, setMuted] = useState(false)
  const send = useCallback(
    (data: Omit<Signal, "from">) =>
      bus.current?.postMessage({ ...data, from: self.current }),
    [],
  )
  const cleanup = useCallback(() => {
    generation.current++
    pc.current?.close()
    pc.current = null
    media.current?.getTracks().forEach((track) => {
      track.stop()
    })
    media.current = null
    if (local.current) local.current.srcObject = null
    if (remote.current) remote.current.srcObject = null
    other.current = ""
    candidates.current = []
    setStatus("idle")
    setIncoming("")
  }, [])
  const prepare = useCallback(async () => {
    // 用户可能在设备授权弹窗返回前挂断。代次变化后必须停止迟到的轨道，避免摄像头残留占用。
    const token = ++generation.current
    setStatus("requesting")
    const captured = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    })
    if (token !== generation.current) {
      captured.getTracks().forEach((t) => {
        t.stop()
      })
      throw Error("Call canceled")
    }
    media.current = captured
    if (local.current) local.current.srcObject = media.current
    // 只验证同机可达候选；空 iceServers 不具备公网 NAT 穿透/中继保障。
    const peer = new RTCPeerConnection({ iceServers: [] })
    pc.current = peer
    for (const track of media.current.getTracks())
      peer.addTrack(track, media.current)
    peer.onicecandidate = (e) => {
      if (e.candidate)
        send({
          type: "ice",
          to: other.current,
          candidate: e.candidate.toJSON(),
        })
    }
    peer.ontrack = (e) => {
      if (remote.current) remote.current.srcObject = e.streams[0]
    }
    peer.onconnectionstatechange = () => {
      if (pc.current === peer) setStatus(peer.connectionState)
    }
    return peer
  }, [send])
  useEffect(() => {
    self.current = crypto.randomUUID()
    const channel = new BroadcastChannel(`streamlab-call-${roomId}`)
    bus.current = channel
    // ICE 可能先于远端 SDP 到达，先排队，setRemoteDescription 成功后再逐个 addIceCandidate。
    const flush = async () => {
      if (pc.current?.remoteDescription) {
        for (const c of candidates.current) await pc.current.addIceCandidate(c)
        candidates.current = []
      }
    }
    channel.onmessage = async (e: MessageEvent<Signal>) => {
      const d = e.data
      if (d.from === self.current || (d.to && d.to !== self.current)) return
      if (other.current && d.from !== other.current) return
      try {
        if (d.type === "invite") {
          if (pc.current || other.current) return
          other.current = d.from
          setIncoming(d.from)
          setStatus("incoming")
        } else if (d.type === "accept" && pc.current) {
          other.current = d.from
          const offer = await pc.current.createOffer()
          await pc.current.setLocalDescription(offer)
          send({ type: "offer", to: d.from, sdp: offer })
        } else if (d.type === "offer" && d.sdp && pc.current) {
          await pc.current.setRemoteDescription(d.sdp)
          await flush()
          const answer = await pc.current.createAnswer()
          await pc.current.setLocalDescription(answer)
          send({ type: "answer", to: d.from, sdp: answer })
        } else if (d.type === "answer" && d.sdp && pc.current) {
          await pc.current.setRemoteDescription(d.sdp)
          await flush()
        } else if (d.type === "ice" && d.candidate) {
          if (pc.current?.remoteDescription)
            await pc.current.addIceCandidate(d.candidate)
          else candidates.current.push(d.candidate)
        } else if (d.type === "end") {
          cleanup()
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : "WebRTC error")
        cleanup()
      }
    }
    // inbound-rtp 的 packets 是累计包数，jitter 单位为秒；这里没有计算区间丢包率或端到端延迟。
    const timer = setInterval(async () => {
      if (pc.current?.connectionState === "connected") {
        const reports = await pc.current.getStats()
        reports.forEach((r) => {
          if (r.type === "inbound-rtp" && r.kind === "video")
            setStats({
              packets: r.packetsReceived ?? 0,
              lost: r.packetsLost ?? 0,
              jitter: r.jitter ?? 0,
            })
        })
      }
    }, 1000)
    return () => {
      generation.current++
      if (other.current) send({ type: "end", to: other.current })
      clearInterval(timer)
      channel.close()
      pc.current?.close()
      media.current?.getTracks().forEach((track) => {
        track.stop()
      })
    }
  }, [cleanup, send, toast, roomId])
  const call = async () => {
    try {
      await prepare()
      setStatus("calling")
      send({ type: "invite" })
    } catch (e) {
      toast(String(e))
      cleanup()
    }
  }
  const accept = async () => {
    try {
      await prepare()
      send({ type: "accept", to: incoming })
      setIncoming("")
      setStatus("connecting")
    } catch (e) {
      toast(String(e))
      cleanup()
    }
  }
  return (
    <div className="rounded-xl border border-white/10 bg-[#17171b] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {t("一对一真实连麦", "Real peer-to-peer call")}
        </h2>
        <span className="text-xs text-violet-300" data-testid="rtc-status">
          {status}
        </span>
      </div>
      <p className="mb-4 text-xs leading-6 text-zinc-500">
        {t(
          "在同一浏览器打开两个标签页。一端发起邀请，另一端接听。音视频通过 WebRTC 真实传输，信令仅在本机共享。",
          "Open two tabs in this browser. Invite from one, accept in the other. Media uses real WebRTC; signaling stays on this device.",
        )}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="relative aspect-video rounded-lg bg-black">
          <video
            ref={local}
            autoPlay
            muted
            playsInline
            className="size-full rounded-lg object-cover"
          />
          <span className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 text-[10px]">
            {t("你", "You")}
          </span>
        </div>
        <div className="relative aspect-video rounded-lg bg-black">
          <video
            ref={remote}
            autoPlay
            playsInline
            className="size-full rounded-lg object-cover"
          />
          <span className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 text-[10px]">
            {t("对方", "Guest")}
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={status !== "idle"} onClick={() => void call()}>
          <Phone size={15} />
          {t("发起邀请", "Invite")}
        </Button>
        {incoming && (
          <>
            <Button onClick={() => void accept()}>{t("接听", "Accept")}</Button>
            <Button
              variant="secondary"
              onClick={() => {
                send({ type: "end", to: incoming })
                cleanup()
              }}
            >
              {t("拒绝", "Decline")}
            </Button>
          </>
        )}
        <Button
          variant="secondary"
          disabled={!media.current}
          onClick={() => {
            media.current?.getAudioTracks().forEach((track) => {
              track.enabled = muted
            })
            setMuted(!muted)
          }}
        >
          <Mic size={15} />
          {muted ? t("取消静音", "Unmute") : t("静音", "Mute")}
        </Button>
        <Button
          variant="danger"
          disabled={status === "idle"}
          onClick={() => {
            send({ type: "end", to: other.current || undefined })
            cleanup()
          }}
        >
          <PhoneOff size={15} />
          {t("挂断", "Hang up")}
        </Button>
        <a
          href={roomId === "lab" ? "/lab#rtc" : `/live/${roomId}?tab=call`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center px-3 text-xs text-violet-300"
        >
          {t("打开另一端 ↗", "Open another tab ↗")}
        </a>
      </div>
      <div className="mt-4 flex flex-wrap gap-5 border-t border-white/5 pt-3 font-mono text-[10px] text-zinc-500">
        <span>received: {stats.packets}</span>
        <span>lost: {stats.lost}</span>
        <span>jitter: {stats.jitter.toFixed(4)}s</span>
      </div>
    </div>
  )
}
/** WHIP 发布与 WHEP 订阅：当前只实现 MediaMTX 本机基础握手和删除会话，未实现 PATCH ICE restart。 */
export function MediaRtc() {
  const { t, toast } = useApp(),
    video = useRef<HTMLVideoElement>(null),
    peer = useRef<RTCPeerConnection | null>(null),
    media = useRef<MediaStream | null>(null),
    sessionUrl = useRef(""),
    abort = useRef<AbortController | null>(null),
    [status, setStatus] = useState("idle")
  const stop = useCallback(() => {
    abort.current?.abort()
    peer.current?.close()
    peer.current = null
    media.current?.getTracks().forEach((t) => {
      t.stop()
    })
    media.current = null
    if (video.current) video.current.srcObject = null
    if (sessionUrl.current) {
      void fetch(sessionUrl.current, { method: "DELETE" }).catch(() => {})
      sessionUrl.current = ""
    }
    setStatus("idle")
  }, [])
  useEffect(
    () => () => {
      stop()
    },
    [stop],
  )
  const connect = async (publish: boolean) => {
    stop()
    setStatus("connecting")
    const controller = new AbortController()
    abort.current = controller
    try {
      const pc = new RTCPeerConnection({ iceServers: [] })
      peer.current = pc
      if (publish) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        })
        if (controller.signal.aborted) {
          stream.getTracks().forEach((t) => {
            t.stop()
          })
          return
        }
        media.current = stream
        if (video.current) {
          video.current.srcObject = stream
          video.current.muted = true
        }
        for (const track of stream.getTracks()) pc.addTrack(track, stream)
        const codecs = RTCRtpSender.getCapabilities("video")?.codecs.filter(
          (c) => c.mimeType.toLowerCase() === "video/h264",
        )
        for (const transceiver of pc.getTransceivers())
          if (transceiver.sender.track?.kind === "video" && codecs?.length)
            transceiver.setCodecPreferences(codecs)
      } else {
        pc.addTransceiver("video", { direction: "recvonly" })
        pc.addTransceiver("audio", { direction: "recvonly" })
        pc.ontrack = (e) => {
          if (video.current) {
            video.current.srcObject = e.streams[0]
            video.current.muted = false
          }
        }
      }
      pc.onconnectionstatechange = () => {
        if (peer.current === pc) setStatus(pc.connectionState)
      }
      // 本版等待 ICE 收集完成或最多 3 秒，把已有候选随 SDP 一次提交；不是完整 trickle ICE 客户端。
      await pc.setLocalDescription(await pc.createOffer())
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve()
          return
        }
        const timer = setTimeout(resolve, 3000)
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === "complete") {
            clearTimeout(timer)
            resolve()
          }
        }
      })
      if (controller.signal.aborted) return
      const url = `http://localhost:8889/rtc/${publish ? "whip" : "whep"}`
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: pc.localDescription?.sdp,
        signal: controller.signal,
      })
      if (!r.ok) throw Error(`MediaMTX ${r.status}: ${await r.text()}`)
      // 服务返回会话资源 URL；stop() 要 DELETE 远端资源，单 close 本地 peer 不代表服务端会话已删除。
      const location = r.headers.get("Location")
      if (location) sessionUrl.current = new URL(location, url).href
      await pc.setRemoteDescription({ type: "answer", sdp: await r.text() })
    } catch (e) {
      // 旧 WHIP 请求取消后可能才抛错，不能用它的 catch 关闭当前新建的 WHEP 会话。
      if (abort.current !== controller || controller.signal.aborted) return
      toast(String(e))
      stop()
    }
  }
  return (
    <div className="rounded-xl border border-white/10 bg-[#17171b] p-5">
      <h2 className="mb-3 text-sm font-semibold">MediaMTX · WHIP / WHEP</h2>
      <p className="mb-4 text-xs text-zinc-500">
        {t(
          "一个标签页发布摄像头，另一个订阅 rtc 路径。需先启动媒体服务。",
          "Publish in one tab and subscribe to the rtc path in another. Start the media service first.",
        )}
      </p>
      <video
        ref={video}
        autoPlay
        playsInline
        className="aspect-video w-full rounded-lg bg-black"
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void connect(true)}>
          <Camera size={15} />
          WHIP {t("发布", "Publish")}
        </Button>
        <Button variant="secondary" onClick={() => void connect(false)}>
          <Video size={15} />
          WHEP {t("订阅", "Subscribe")}
        </Button>
        <Button variant="danger" onClick={stop}>
          {t("停止", "Stop")}
        </Button>
        <span
          data-testid="media-rtc-status"
          className="self-center text-xs text-zinc-500"
        >
          {status}
        </span>
      </div>
    </div>
  )
}
