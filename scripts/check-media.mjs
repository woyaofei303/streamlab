for (const [label, url] of [
  ["MediaMTX API", "http://127.0.0.1:9997/v3/paths/list"],
  ["Live HLS", "http://127.0.0.1:8888/live/index.m3u8"],
]) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    console.log(`${label}: HTTP ${response.status}`)
    if (!response.ok) process.exitCode = 1
  } catch (e) {
    console.log(`${label}: ${e.message}`)
    process.exitCode = 1
  }
}
