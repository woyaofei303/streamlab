// 学习时按链路排查：先看接收服务 API，再看提供给播放器的 HLS 入口。
// API 返回 200 只说明服务可访问；HLS 的 .m3u8 是播放列表，不是视频帧本身。
// 两项都成功后，还需在浏览器确认播放时间增长；此脚本不验证分片解码或声音。
for (const [label, url] of [
  ["MediaMTX API", "http://127.0.0.1:9997/v3/paths/list"],
  ["Live HLS", "http://127.0.0.1:8888/live/index.m3u8"],
]) {
  try {
    // 最多等 5 秒，避免服务未启动时一直卡住；这里只读状态，不会启动推流。
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    console.log(`${label}: HTTP ${response.status}`)
    // 设置退出码而非立即退出，保证后面的检查也会执行；命令行能据此判断是否失败。
    if (!response.ok) process.exitCode = 1
  } catch (e) {
    console.log(`${label}: ${e.message}`)
    process.exitCode = 1
  }
}
