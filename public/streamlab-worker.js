// 扩展自有 wrapper 来接管新标签；mockServiceWorker.js 保持 MSW 官方生成内容，便于依赖升级后重新生成。
// 外部媒体走浏览器原生网络，避免 MSW 重放跨源 HLS 重定向；本地业务接口仍由 MSW 处理。
self.addEventListener("fetch", (event) => {
  if (new URL(event.request.url).origin !== self.location.origin)
    event.stopImmediatePropagation()
})
importScripts("/mockServiceWorker.js")

// An already active worker must also claim newly opened, initially uncontrolled tabs.
self.addEventListener("message", (event) => {
  if (event.data === "STREAMLAB_CLAIM") event.waitUntil(self.clients.claim())
})
