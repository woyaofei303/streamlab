// Next.js App Router 入口；当前没有逐页面的服务端数据获取，业务路由由 StreamApp/Shell 在客户端分派。
import { Suspense } from "react"
import { StreamApp } from "@/components/app"
export default function Page() {
  return (
    <Suspense>
      <StreamApp />
    </Suspense>
  )
}
