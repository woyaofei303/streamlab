/** 传入本机流时通过 WHIP 发布；不传时通过 WHEP 接收。 */
export function createMediaSession(
  url: string,
  stream?: MediaStream,
  password = "",
  bearerToken = "",
) {
  // ponytail: 公网直连媒体服务器；限制 UDP/TCP 的网络仍需另配 TURN。
  const endpoint = new URL(url, window.location.href)
  const headers: Record<string, string> = bearerToken
    ? { Authorization: `Bearer ${bearerToken}` }
    : stream && password
      ? { Authorization: `Basic ${btoa(`publisher:${password}`)}` }
      : {}
  const peer = new RTCPeerConnection({ iceServers: [] })
  const abort = new AbortController()
  let sessionUrl = ""
  function removeSession(): void {
    if (!sessionUrl) return
    const target = sessionUrl
    sessionUrl = ""
    void fetch(target, {
      method: "DELETE",
      headers,
      credentials: "omit",
      redirect: "error",
      keepalive: true,
      signal: AbortSignal.timeout(5000),
    }).catch(() => {})
  }
  function close(): void {
    // 断开连接不会自动释放摄像头，轨道也要停止。
    abort.abort()
    peer.close()
    stream?.getTracks().forEach((track) => {
      track.stop()
    })
    removeSession()
  }

  if (stream) {
    for (const track of stream.getTracks()) peer.addTrack(track, stream)
    const videoCodecs = RTCRtpSender.getCapabilities("video")?.codecs.filter(
      (codec) => codec.mimeType.toLowerCase() === "video/h264",
    )
    for (const transceiver of peer.getTransceivers())
      if (transceiver.sender.track?.kind === "video" && videoCodecs?.length)
        transceiver.setCodecPreferences(videoCodecs)
  } else {
    peer.addTransceiver("video", { direction: "recvonly" })
    peer.addTransceiver("audio", { direction: "recvonly" })
  }

  async function connect(): Promise<void> {
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15000)])
    function waitForState(
      event: string,
      isReady: () => boolean,
    ): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const check = () => {
          const hasFailed = ["failed", "closed"].includes(peer.connectionState)
          if (!signal.aborted && !hasFailed && !isReady()) return
          peer.removeEventListener(event, check)
          signal.removeEventListener("abort", check)
          if (signal.aborted) reject(signal.reason)
          else if (hasFailed) reject(Error("WebRTC connection failed"))
          else resolve()
        }
        peer.addEventListener(event, check)
        signal.addEventListener("abort", check, { once: true })
        check()
      })
    }

    try {
      // 先收齐 ICE 候选，再把完整的连接说明发给服务器。
      await peer.setLocalDescription(await peer.createOffer())
      await waitForState(
        "icegatheringstatechange",
        () => peer.iceGatheringState === "complete",
      )
      // POST 单独限时：即使用户取消，也先拿到 Location，以便删除迟到的服务器会话。
      const response = await fetch(endpoint.href, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/sdp" },
        // 仅使用页面提供的凭证，避免 401 触发浏览器原生登录框。
        credentials: "omit",
        redirect: "error",
        body: peer.localDescription?.sdp,
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok)
        throw Error(
          `媒体连接失败 / Media connection failed (${response.status}): ${await response.text()}`,
        )
      const location = response.headers.get("Location")
      if (!location) throw Error("Missing media session URL")
      const target = new URL(location, endpoint)
      // 清理地址来自网络，必须属于当前服务和发布/订阅入口。
      if (
        target.origin !== endpoint.origin ||
        !target.pathname.startsWith(`${endpoint.pathname}/`)
      )
        throw Error("Invalid media session URL")
      sessionUrl = target.href
      // 先保存地址再检查取消，catch 才能清理服务器会话。
      signal.throwIfAborted()
      // 使用服务器的答复建立连接；是否收到媒体，由调用方继续确认。
      await peer.setRemoteDescription({
        type: "answer",
        sdp: await response.text(),
      })
      await waitForState(
        "connectionstatechange",
        () => peer.connectionState === "connected",
      )
    } catch (error) {
      close()
      throw error
    }
  }
  return { peer, connect, close }
}
