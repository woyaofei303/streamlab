"use client"

/** 应用数据入口：MSW 就绪 → Query 拉业务快照 → Context 暴露身份、动作和展示状态。 */
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { NextIntlClientProvider } from "next-intl"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { action, getState } from "@/lib/api"
import type { Action, Locale, State, User } from "@/lib/types"

const messages = {
  zh: {
    nav: {
      discover: "发现",
      following: "正在关注",
      library: "我的空间",
      studio: "开始直播",
      lab: "播放实验室",
    },
  },
  en: {
    nav: {
      discover: "Discover",
      following: "Following",
      library: "Your library",
      studio: "Go live",
      lab: "Playback lab",
    },
  },
}
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000, retry: 1, refetchOnWindowFocus: false },
  },
})
type AppContextValue = {
  state: State | undefined
  user: User | undefined
  userId: string
  locale: Locale
  t: (zh: string, en: string) => string
  setLocale: (l: Locale) => void
  login: (id: string) => void
  act: (a: Action) => Promise<unknown>
  toast: (s: string) => void
  authOpen: boolean
  setAuthOpen: (v: boolean) => void
  error: Error | null
  refresh: () => void
}
const Context = createContext<AppContextValue | null>(null)
export function useApp() {
  const v = useContext(Context)
  if (!v) throw Error("Missing App provider")
  return v
}
function ContextProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState(""),
    [locale, setLocaleState] = useState<Locale>("zh"),
    [authOpen, setAuthOpen] = useState(false),
    [notification, setNotification] = useState("")
  const {
    data: state,
    error,
    refetch,
  } = useQuery({ queryKey: ["state"], queryFn: getState })
  const client = useQueryClient()
  // 只保留关注/收藏/预约等低风险动作；登录后不会自动重放购买或送礼。
  const pendingIntent = useRef<Action | null>(null)
  useEffect(() => {
    // 每个标签页各自选择身份；业务库按 origin 共享，因此同一浏览器能同时扮演观众和主播。
    setUserId(sessionStorage.getItem("streamlab-user") ?? "")
    setLocaleState(
      localStorage.getItem("streamlab-locale") === "en" ? "en" : "zh",
    )
    const bus = new BroadcastChannel("streamlab-state")
    // 广播只表示“数据过期”，重新查询才获得事务提交后的状态；不在广播载荷里传整份业务数据。
    bus.onmessage = () => {
      void client.invalidateQueries({ queryKey: ["state"] })
    }
    return () => bus.close()
  }, [client])
  useEffect(() => {
    if (!notification) return
    const timer = setTimeout(() => setNotification(""), 4500)
    return () => clearTimeout(timer)
  }, [notification])
  const login = useCallback(
    (id: string) => {
      sessionStorage.setItem("streamlab-user", id)
      setUserId(id)
      setAuthOpen(false)
      const intent = pendingIntent.current
      pendingIntent.current = null
      if (id && intent)
        void action({ ...intent, userId: id })
          .then(() => client.invalidateQueries({ queryKey: ["state"] }))
          .catch((e) => setNotification(String(e)))
    },
    [client],
  )
  const act = useCallback(
    async (a: Action) => {
      if (
        !userId &&
        !["scenario", "clock", "register", "burst"].includes(a.type)
      ) {
        if (["follow", "bookmark", "reserve"].includes(a.type))
          pendingIntent.current = a
        setAuthOpen(true)
        throw Error(locale === "zh" ? "请先登录" : "Please sign in")
      }
      try {
        // 用本标签身份覆盖调用方传入的 userId；这是演示隔离，并不能替代服务端认证。
        const result = await action({ ...a, userId })
        await client.invalidateQueries({ queryKey: ["state"] })
        return result
      } catch (e) {
        setNotification(
          e instanceof Error && e.name === "TimeoutError"
            ? "响应超时，可安全重试 / Timed out; safe to retry"
            : e instanceof Error
              ? e.message
              : "Request failed",
        )
        throw e
      }
    },
    [userId, client, locale],
  )
  const t = (zh: string, en: string) => (locale === "zh" ? zh : en)
  const setLocale = (l: Locale) => {
    setLocaleState(l)
    localStorage.setItem("streamlab-locale", l)
    document.documentElement.lang = l === "zh" ? "zh-CN" : "en"
  }
  return (
    <Context.Provider
      value={{
        state,
        user: state?.users.find((u) => u.id === userId),
        userId,
        locale,
        t,
        setLocale,
        login,
        act,
        toast: setNotification,
        authOpen,
        setAuthOpen,
        error,
        refresh: () => {
          void refetch()
        },
      }}
    >
      <NextIntlClientProvider
        locale={locale}
        messages={messages[locale]}
        timeZone="UTC"
      >
        {children}
        {notification && (
          <div
            role="status"
            className="fixed bottom-8 left-1/2 z-[100] max-w-[90vw] -translate-x-1/2 rounded-xl border border-white/15 bg-zinc-800 px-5 py-3 text-sm shadow-2xl"
          >
            {notification}
          </div>
        )}
      </NextIntlClientProvider>
    </Context.Provider>
  )
}
export function Providers({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false),
    [error, setError] = useState("")
  useEffect(() => {
    let live = true
    // 浏览器业务页等 MSW 初始化后才挂载；服务端只输出外壳，不会向不存在的 /api/v1 服务发请求。
    import("@/mocks/browser")
      .then(({ startMocks }) => startMocks())
      .then(() => {
        if (live) setReady(true)
      })
      .catch((e) => setError(String(e)))
    return () => {
      live = false
    }
  }, [])
  if (!ready)
    return (
      <div className="grid min-h-dvh place-items-center bg-[#0e0e10]">
        <div className="text-center">
          <div className="mb-4 text-2xl font-black tracking-tight text-violet-400">
            StreamLab<span className="text-white">.</span>
          </div>
          <p className="text-sm text-zinc-400">
            {error || "准备你的直播空间 / Preparing your space…"}
          </p>
        </div>
      </div>
    )
  return (
    <QueryClientProvider client={queryClient}>
      <ContextProvider>{children}</ContextProvider>
    </QueryClientProvider>
  )
}
