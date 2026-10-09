// 公网走站点 HTTPS 代理；本地继续使用 media/compose.yml 的端口。
const host = process.env.NEXT_PUBLIC_MEDIA_HOST
export const isPublicMedia = Boolean(host)
export const webrtcBase = host ? "" : "http://127.0.0.1:8889"
export const hlsLiveUrl = host
  ? "/hls/live/index.m3u8"
  : "http://127.0.0.1:8888/live/index.m3u8"
export const rtmpServer = `rtmp://${host || "127.0.0.1"}:1935`

// 房主与嘉宾共用采集比例，避免同一摄像头在合流里出现不同的放大倍数。
const cameraConstraints: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  aspectRatio: { ideal: 16 / 9 },
  frameRate: { ideal: 24, max: 24 },
}

export async function captureCamera(
  audio: boolean | MediaTrackConstraints = true,
  deviceId?: string,
): Promise<MediaStream> {
  const video = {
    ...cameraConstraints,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  }
  try {
    // ideal 可能静默返回 640×480；优先要求真实 720p，旧设备再回退。
    return await navigator.mediaDevices.getUserMedia({
      audio,
      video: { ...video, width: { exact: 1280 }, height: { exact: 720 } },
    })
  } catch (error) {
    if (
      !(error instanceof DOMException) ||
      error.name !== "OverconstrainedError"
    )
      throw error
    return navigator.mediaDevices.getUserMedia({ audio, video })
  }
}
