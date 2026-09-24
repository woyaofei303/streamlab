// 扩展自有 wrapper 来接管新标签；mockServiceWorker.js 保持 MSW 官方生成内容，便于依赖升级后重新生成。
importScripts("/mockServiceWorker.js")

// An already active worker must also claim newly opened, initially uncontrolled tabs.
self.addEventListener("message", (event) => {
  if (event.data === "STREAMLAB_CLAIM") event.waitUntil(self.clients.claim())
})
