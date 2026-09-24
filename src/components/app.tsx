"use client"

/** 页面外壳与路由分派：Next optional catch-all 提供统一入口，Shell 依据 pathname 选择页面。 */
import {
  Bell,
  Compass,
  FlaskConical,
  Globe2,
  Heart,
  Menu,
  Radio,
  Search,
  Video,
  X,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { AuthDialog } from "./auth"
import { ChannelPage, Home } from "./home"
import { Lab } from "./lab"
import { Library } from "./library"
import { Providers, useApp } from "./providers"
import { Room } from "./room"
import { Studio } from "./studio"
import { Avatar, Button, cn, Empty, Modal } from "./ui/primitives"

function Shell() {
  const {
      state,
      user,
      t,
      locale,
      setLocale,
      setAuthOpen,
      act,
      error,
      refresh,
    } = useApp(),
    nav = useTranslations("nav")
  const pathname = usePathname(),
    router = useRouter(),
    searchParams = useSearchParams(),
    [search, setSearch] = useState(searchParams.get("q") ?? ""),
    [mobile, setMobile] = useState(false),
    [notices, setNotices] = useState(false)
  const query = searchParams.get("q") ?? ""
  // URL 是已提交搜索条件的来源；前进、返回、刷新后，把输入框同步回 URL，避免页面条件不一致。
  useEffect(() => setSearch(query), [query])
  const isRoom = pathname.startsWith("/live/"),
    current = pathname.split("/")[2]
  const route = pathname.split("/")[1]
  const links = [
    { href: "/", icon: Compass, label: nav("discover") },
    { href: "/following", icon: Heart, label: nav("following") },
    { href: "/library", icon: Video, label: nav("library") },
  ]
  const noticeItems = state?.notices.filter((n) => n.userId === user?.id) ?? []
  const channels =
    state?.channels.filter((c) => c.status === "live").slice(0, 6) ?? []
  return (
    <div className="min-h-dvh bg-[#0e0e10] text-zinc-100">
      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between gap-4 border-b border-white/[.07] bg-[#131316]/95 px-4 backdrop-blur-xl lg:px-6">
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            aria-label="Menu"
            onClick={() => setMobile(!mobile)}
            className="rounded p-1 text-zinc-400 lg:hidden"
          >
            {mobile ? <X size={20} /> : <Menu size={20} />}
          </button>
          <Link
            href="/"
            className="flex items-center gap-2 text-xl font-extrabold tracking-tight"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-violet-500">
              <Radio size={21} />
            </span>
            StreamLab<span className="-ml-2 text-violet-400">.</span>
          </Link>
          <span className="hidden rounded border border-white/10 px-1.5 py-0.5 text-[9px] tracking-[.14em] text-zinc-500 xl:block">
            LOCAL DEMO
          </span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            router.push(`/?q=${encodeURIComponent(search)}`)
          }}
          className="hidden w-full max-w-[420px] items-center rounded-lg border border-white/8 bg-white/[.035] sm:flex"
        >
          <Search size={17} className="ml-3 text-zinc-500" />
          <input
            aria-label={t("搜索", "Search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(
              "搜索直播、频道、感兴趣的事物",
              "Search streams, creators, and things you love",
            )}
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-xs outline-none placeholder:text-zinc-500"
          />
          <kbd className="mr-3 rounded border border-white/10 px-1 text-[10px] text-zinc-600">
            ↵
          </kbd>
        </form>
        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <button
            type="button"
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            className="flex items-center gap-1.5 rounded-lg p-2 text-xs text-zinc-400 hover:text-white"
            aria-label="Switch language"
          >
            <Globe2 size={17} />
            <span className="hidden md:inline">
              {locale === "zh" ? "EN" : "中文"}
            </span>
          </button>
          <button
            type="button"
            className="relative rounded-lg p-2 text-zinc-400 hover:text-white"
            aria-label={t("通知", "Notifications")}
            onClick={() => {
              if (!user) {
                setAuthOpen(true)
                return
              }
              setNotices(true)
              void act({ type: "readNotice" }).catch(() => {})
            }}
          >
            <Bell size={19} />
            {noticeItems.some((n) => !n.read) && (
              <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-violet-400" />
            )}
          </button>
          <Link
            href="/studio"
            className="hidden items-center gap-2 text-xs font-semibold text-zinc-300 hover:text-violet-300 md:flex"
          >
            <Video size={17} />
            {nav("studio")}
          </Link>
          {user ? (
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              aria-label={t("切换演示身份", "Switch demo identity")}
            >
              <Avatar src={user.avatar} name={user.name} size="sm" />
            </button>
          ) : (
            <Button
              onClick={() => setAuthOpen(true)}
              className="min-h-8 px-3 py-1.5 text-xs"
            >
              {t("登录", "Sign in")}
            </Button>
          )}
        </div>
      </header>
      {mobile && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className={cn(
          "fixed bottom-0 left-0 top-16 z-30 flex w-56 flex-col border-r border-white/[.06] bg-[#141417] p-3 transition-transform lg:translate-x-0",
          mobile ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <nav className="space-y-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMobile(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium",
                pathname === l.href
                  ? "bg-violet-500/15 text-violet-300"
                  : "text-zinc-400 hover:bg-white/5 hover:text-white",
              )}
            >
              <l.icon size={18} />
              {l.label}
              {l.href === "/" && (
                <span className="ml-auto rounded bg-violet-500/15 px-1.5 text-[10px]">
                  LIVE
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="mx-3 my-5 h-px bg-white/[.07]" />
        <div className="mb-3 flex items-center justify-between px-3 text-[10px] font-semibold tracking-wider text-zinc-500">
          <span>{t("为你推荐的频道", "RECOMMENDED CHANNELS")}</span>
          <span className="size-1 rounded-full bg-violet-400" />
        </div>
        <div className="space-y-1">
          {channels.map((c) => (
            <Link
              key={c.id}
              href={`/live/${c.id}`}
              onClick={() => setMobile(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white/5",
                current === c.id && isRoom && "bg-white/5",
              )}
            >
              <Avatar name={c.name} color={c.color} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">
                  {c.name}
                </span>
                <span className="text-[10px] capitalize text-zinc-500">
                  {c.category}
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                <span className="size-1.5 rounded-full bg-rose-500" />
                {(c.viewers / 1000).toFixed(1)}k
              </span>
            </Link>
          ))}
        </div>
        <Link
          href="/?status=scheduled"
          className="mt-3 px-3 text-[11px] text-violet-400 hover:text-violet-300"
        >
          {t("发现更多频道", "Discover more channels")} →
        </Link>
        <div className="mt-auto rounded-xl border border-violet-400/15 bg-violet-500/[.05] p-4">
          <Radio className="mb-3 text-violet-400" size={22} />
          <p className="text-sm font-semibold">
            {t("你的热爱，值得被看见", "Your passion deserves a stage")}
          </p>
          <p className="mt-1.5 text-[11px] leading-5 text-zinc-500">
            {t(
              "从第一个观众开始，分享你的世界。",
              "Share your world. Start with your first viewer.",
            )}
          </p>
          <Link
            href="/studio"
            className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-violet-300"
          >
            {t("开启我的直播", "Start your stream")} →
          </Link>
        </div>
        <Link
          href="/lab"
          className="mt-3 flex items-center gap-2 px-3 py-2 text-[11px] text-zinc-500 hover:text-zinc-300"
        >
          <FlaskConical size={14} />
          {nav("lab")}
        </Link>
        <p className="px-3 py-2 text-[9px] text-zinc-600">
          StreamLab · {t("本地演示，数据为示例", "Local demo · sample data")}
        </p>
      </aside>
      <main id="main" className="min-h-dvh pt-16 lg:pl-56">
        {error ? (
          <div className="p-8">
            <Empty
              title={t("暂时无法加载", "Unable to load")}
              description={error.message}
            >
              <Button onClick={refresh}>{t("重试", "Retry")}</Button>
            </Empty>
          </div>
        ) : !state ? (
          <div className="space-y-6 p-8">
            <div className="h-72 animate-pulse rounded-2xl bg-white/5" />
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((x) => (
                <div
                  key={x}
                  className="h-40 animate-pulse rounded-xl bg-white/5"
                />
              ))}
            </div>
          </div>
        ) : route === "live" ? (
          <Room key={pathname} channelId={current} />
        ) : route === "channel" ? (
          <ChannelPage id={current} />
        ) : route === "library" ? (
          <Library />
        ) : route === "studio" ? (
          <Studio />
        ) : route === "lab" ? (
          <Lab />
        ) : route === "" || route === "following" ? (
          <Home following={route === "following"} />
        ) : (
          <div className="p-8">
            <Empty
              title="404"
              description={t(
                "这个页面已经离开直播间",
                "This page is off the air",
              )}
            >
              <Link href="/">{t("回到首页", "Back home")}</Link>
            </Empty>
          </div>
        )}
      </main>
      <AuthDialog />
      <Modal
        open={notices}
        onOpenChange={setNotices}
        title={t("你的通知", "Your notifications")}
      >
        <div className="space-y-3">
          {noticeItems.length ? (
            noticeItems.slice(0, 20).map((n) => (
              <Link
                onClick={() => setNotices(false)}
                key={n.id}
                href={n.channelId ? `/live/${n.channelId}` : "/library"}
                className="block rounded-lg border border-white/10 p-3 text-sm"
              >
                <p>{n.text}</p>
                <p className="mt-1 text-[10px] text-zinc-500">
                  {new Date(n.at).toLocaleString()}
                </p>
              </Link>
            ))
          ) : (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("暂时没有新通知", "You are all caught up")}
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}
export function StreamApp() {
  return (
    <Providers>
      <Shell />
    </Providers>
  )
}
