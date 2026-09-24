"use client"

/** 发现页/频道页：预置频道顺序 + URL 筛选，没有个性化推荐服务；频道卡片复用于个人中心。 */
import {
  ArrowRight,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Gamepad2,
  Heart,
  Music2,
  Palette,
  Play,
  Radio,
  Search,
  Sparkles,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import type { Channel } from "@/lib/types"
import { useApp } from "./providers"
import { Avatar, Badge, Button, cn, Empty, inputClass } from "./ui/primitives"

const categoryData = [
  { id: "all", zh: "为你推荐", en: "For you", icon: Sparkles },
  { id: "irl", zh: "户外与生活", en: "IRL & lifestyle", icon: Compass },
  { id: "gaming", zh: "游戏世界", en: "Gaming", icon: Gamepad2 },
  { id: "music", zh: "音乐现场", en: "Music", icon: Music2 },
  { id: "creative", zh: "创意工坊", en: "Creative", icon: Palette },
]
export function ChannelCard({ channel: c }: { channel: Channel }) {
  const { t, locale } = useApp()
  return (
    <article className="group min-w-0">
      <Link
        href={`/live/${c.id}`}
        className="relative block aspect-video overflow-hidden rounded-xl bg-zinc-900"
      >
        <Image
          width={1280}
          height={720}
          src={c.cover}
          alt={locale === "zh" ? c.title : c.titleEn}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/10" />
        <div className="absolute left-3 top-3">
          <Badge live={c.status === "live"}>
            {c.status === "live"
              ? t("直播演示", "LIVE DEMO")
              : c.status === "scheduled"
                ? t("即将开始", "UPCOMING")
                : t("回放", "REPLAY")}
          </Badge>
        </div>
        <div className="absolute bottom-3 left-3 text-[11px] font-medium text-white">
          {c.status === "live"
            ? `${(c.viewers / 1000).toFixed(1)}k ${t("示例观众", "sample viewers")}`
            : c.status === "scheduled"
              ? new Date(c.scheduledAt).toLocaleDateString()
              : t("精彩时刻 · 02:00", "Highlights · 02:00")}
        </div>
        <div className="absolute bottom-3 right-3 rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-white/80">
          {c.language.toUpperCase()}
        </div>
        <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="grid size-11 place-items-center rounded-full bg-white/20 backdrop-blur">
            <Play size={20} fill="white" />
          </span>
        </span>
      </Link>
      <div className="mt-3 flex gap-2.5">
        <Link href={`/channel/${c.id}`}>
          <Avatar name={c.name} color={c.color} size="sm" />
        </Link>
        <div className="min-w-0">
          <Link
            href={`/live/${c.id}`}
            className="line-clamp-1 text-[13px] font-semibold text-zinc-100 hover:text-violet-300"
          >
            {locale === "zh" ? c.title : c.titleEn}
          </Link>
          <Link
            href={`/channel/${c.id}`}
            className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500"
          >
            {c.name}
            <Check
              size={10}
              className="rounded-full bg-violet-500 text-white"
            />
          </Link>
          <div className="mt-2 flex gap-1.5">
            {c.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded bg-white/[.045] px-2 py-0.5 text-[10px] text-zinc-500"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </article>
  )
}
export function Home({ following = false }: { following?: boolean }) {
  const { state, user, t, locale, setAuthOpen } = useApp(),
    params = useSearchParams(),
    router = useRouter()
  const [featured, setFeatured] = useState(0)
  if (!state) return null
  const category = params.get("category") ?? "all",
    status = params.get("status") ?? "all",
    q = params.get("q") ?? "",
    language = params.get("language") ?? "all"
  // 类别、状态、语言均写入 query string，方便刷新恢复和分享；只在组件 state 里保存轮播等临时 UI。
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value === "all" || !value) next.delete(key)
    else next.set(key, value)
    router.push(`${following ? "/following" : "/"}?${next.toString()}`)
  }
  const filtered = state.channels.filter(
    (c) =>
      (!following || user?.follows.includes(c.id)) &&
      (category === "all" || c.category === category) &&
      (status === "all" || c.status === status) &&
      (language === "all" || c.language === language) &&
      `${c.title} ${c.titleEn} ${c.name} ${c.tags.join(" ")}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  )
  const hero = state.channels[[0, 2, 4][featured]],
    isFiltered =
      q ||
      category !== "all" ||
      status !== "all" ||
      language !== "all" ||
      following
  return (
    <div className="mx-auto max-w-[1800px] px-4 py-7 sm:px-7 xl:px-9">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-medium tracking-wide text-zinc-500">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            {t("此刻，总有人与你同频", "THERE’S A WORLD WAITING FOR YOU")}
          </p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {following
              ? t("你关注的世界", "Your corner of the world")
              : t("发现你的同频时刻", "Find your kind of live.")}
          </h1>
        </div>
        <span className="hidden text-xs text-zinc-600 sm:block">
          {new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
            month: "long",
            day: "numeric",
            weekday: "long",
          }).format(new Date())}
        </span>
      </div>
      {!isFiltered && (
        <section
          aria-label={t("精选直播", "Featured streams")}
          className="relative mb-8 min-h-[300px] overflow-hidden rounded-2xl border border-white/5 bg-zinc-900 sm:min-h-[370px]"
        >
          <Image
            width={1280}
            height={720}
            src={hero.cover}
            alt="Tokyo city at night"
            className="absolute inset-0 size-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/45 to-black/10" />
          <div className="relative max-w-[560px] px-6 py-9 sm:px-9 sm:py-12">
            <div className="mb-5 flex items-center gap-2">
              <Badge live>LIVE DEMO</Badge>
              <span className="text-[10px] font-medium tracking-[.15em] text-white/60">
                {t("编辑精选", "EDITOR’S PICK")}
              </span>
            </div>
            <h2 className="max-w-[420px] text-3xl font-bold leading-[1.35] tracking-tight sm:text-[38px]">
              {featured === 0
                ? t(
                    "换个视角，\n走进城市的另一面。",
                    "A different view.\nA whole new world.",
                  )
                : locale === "zh"
                  ? hero.title
                  : hero.titleEn}
            </h2>
            <p className="mt-4 max-w-sm text-xs leading-6 text-zinc-300">
              {t(
                "跟随创作者的镜头，在寻常的日子里，发现不寻常的精彩。",
                "Follow a creator’s lens and discover the extraordinary in the everyday.",
              )}
            </p>
            <div className="mt-6 flex items-center gap-4">
              <Link
                href={`/live/${hero.id}`}
                className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-xs font-bold text-black transition hover:bg-violet-200"
              >
                <Play size={15} fill="currentColor" />
                {t("进入直播间", "Watch now")}
              </Link>
              <Link
                href={`/channel/${hero.id}`}
                className="flex items-center gap-2.5"
              >
                <Avatar name={hero.name} color={hero.color} size="sm" />
                <span className="text-xs font-semibold">
                  {hero.name}
                  <span className="mt-0.5 block text-[10px] font-normal text-zinc-400">
                    {hero.followers} {t("关注者", "followers")}
                  </span>
                </span>
              </Link>
            </div>
          </div>
          <div className="absolute bottom-5 right-5 flex items-center gap-2">
            {[0, 1, 2].map((i) => (
              <button
                key={i}
                type="button"
                aria-label={`Featured ${i + 1}`}
                onClick={() => setFeatured(i)}
                className={cn(
                  "h-1 rounded-full transition-all",
                  featured === i ? "w-7 bg-white" : "w-2 bg-white/40",
                )}
              />
            ))}
            <button
              type="button"
              aria-label="Previous featured"
              onClick={() => setFeatured((featured + 2) % 3)}
              className="ml-3 rounded-full bg-black/30 p-2"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              aria-label="Next featured"
              onClick={() => setFeatured((featured + 1) % 3)}
              className="rounded-full bg-black/30 p-2"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </section>
      )}
      <div className="mb-7 flex gap-2 overflow-x-auto pb-1">
        {categoryData.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => update("category", c.id)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-medium transition",
              category === c.id
                ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                : "border-white/[.06] bg-white/[.025] text-zinc-400 hover:bg-white/[.06]",
            )}
          >
            <c.icon size={16} />
            {t(c.zh, c.en)}
          </button>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Radio size={19} className="text-violet-400" />
          {q
            ? `${t("搜索结果", "Results")}: ${q}`
            : following
              ? t("关注的频道", "Following channels")
              : t("正在发生的精彩", "Live moments to explore")}
          <span className="ml-1 text-xs font-normal text-zinc-600">
            {filtered.length}
          </span>
        </h2>
        <div className="flex gap-2">
          <select
            aria-label="Stream status"
            value={status}
            onChange={(e) => update("status", e.target.value)}
            className="rounded-lg border border-white/8 bg-[#18181c] px-2 py-1.5 text-[11px] text-zinc-400"
          >
            <option value="all">{t("全部状态", "All streams")}</option>
            <option value="live">{t("直播中", "Live")}</option>
            <option value="scheduled">{t("即将开始", "Upcoming")}</option>
            <option value="ended">{t("回放", "Replays")}</option>
          </select>
          <select
            aria-label="Content language"
            value={language}
            onChange={(e) => update("language", e.target.value)}
            className="rounded-lg border border-white/8 bg-[#18181c] px-2 py-1.5 text-[11px] text-zinc-400"
          >
            <option value="all">{t("全部语言", "All languages")}</option>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>
      <form
        className="mb-5 flex gap-2 sm:hidden"
        onSubmit={(e) => {
          e.preventDefault()
          update("q", String(new FormData(e.currentTarget).get("q") ?? ""))
        }}
      >
        <input
          name="q"
          defaultValue={q}
          placeholder={t("搜索频道", "Search channels")}
          className={inputClass}
        />
        <Button type="submit" variant="secondary" aria-label="Search">
          <Search size={16} />
        </Button>
      </form>
      {filtered.length ? (
        <div className="grid grid-cols-1 gap-x-5 gap-y-8 min-[520px]:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((c) => (
            <ChannelCard key={c.id} channel={c} />
          ))}
        </div>
      ) : (
        <Empty
          title={
            following && !user
              ? t("登录后查看关注", "Sign in to see your channels")
              : t("这里暂时很安静", "Nothing here yet")
          }
          description={t(
            "试试其他筛选条件，或发现一个新的频道。",
            "Try another filter or discover someone new.",
          )}
        >
          <Button
            onClick={() =>
              following && !user ? setAuthOpen(true) : router.push("/")
            }
          >
            {t("发现更多", "Explore")}
          </Button>
        </Empty>
      )}
      {!isFiltered && (
        <section className="mt-10 flex flex-col justify-between gap-5 rounded-xl border border-white/[.07] bg-[#18181d] px-6 py-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
              <Sparkles size={24} />
            </div>
            <div>
              <h3 className="text-sm font-semibold">
                {t(
                  "让下一个精彩，不再错过",
                  "Never miss your next favorite moment",
                )}
              </h3>
              <p className="mt-1.5 text-xs text-zinc-500">
                {t(
                  "预约你喜欢的直播，我们会在开播时提醒你。",
                  "Reserve a spot and get notified when the stream starts.",
                )}
              </p>
            </div>
          </div>
          <Link
            href="/?status=scheduled"
            className="flex shrink-0 items-center gap-2 text-xs font-semibold text-violet-300"
          >
            {t("看看直播日程", "Explore upcoming streams")}
            <ArrowRight size={15} />
          </Link>
        </section>
      )}
      <footer className="mt-12 flex flex-wrap justify-between gap-3 border-t border-white/[.06] pt-6 text-[10px] text-zinc-600">
        <span>
          © 2026 StreamLab.{" "}
          {t("每一种热爱，都有回响。", "Every passion finds its people.")}
        </span>
        <span>
          {t(
            "本地演示 · 示例频道与观众数据",
            "Local demo · illustrative channels and audience counts",
          )}
        </span>
      </footer>
    </div>
  )
}
export function ChannelPage({ id }: { id: string }) {
  const { state, user, act, t, locale } = useApp(),
    [tab, setTab] = useState("live"),
    c = state?.channels.find((c) => c.id === id)
  if (!c)
    return (
      <div className="p-8">
        <Empty title={t("频道不存在", "Channel not found")} />
      </div>
    )
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <div className="relative h-48 overflow-hidden rounded-2xl sm:h-64">
        <Image
          width={1280}
          height={720}
          src={c.cover}
          alt={c.name}
          className="size-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
      </div>
      <div className="relative -mt-8 px-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Avatar name={c.name} color={c.color} size="lg" />
            <h1 className="mt-3 flex items-center gap-2 text-2xl font-bold">
              {c.name}
              <Check size={15} className="rounded-full bg-violet-500" />
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              {c.followers} {t("示例关注者", "sample followers")} ·{" "}
              {c.tags.join(" / ")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                void act({ type: "follow", channelId: id }).catch(() => {})
              }
            >
              <Heart size={16} />
              {user?.follows.includes(id)
                ? t("已关注", "Following")
                : t("关注", "Follow")}
            </Button>
            <Link href={`/live/${id}`}>
              <Button>
                <Play size={15} />
                {t("进入直播间", "Watch channel")}
              </Button>
            </Link>
          </div>
        </div>
        <p className="mt-5 max-w-xl text-sm leading-7 text-zinc-400">
          {locale === "zh"
            ? c.description
            : "Sharing moments worth slowing down for. Join us to explore, create, and connect."}
        </p>
        <nav className="my-7 flex gap-6 border-b border-white/10">
          {[
            ["live", "直播", "Live"],
            ["videos", "回放", "Videos"],
            ["schedule", "日程", "Schedule"],
            ["membership", "会员", "Membership"],
          ].map(([key, zh, en]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "border-b-2 pb-3 text-sm",
                tab === key
                  ? "border-violet-400 text-violet-300"
                  : "border-transparent text-zinc-500",
              )}
            >
              {t(zh, en)}
            </button>
          ))}
        </nav>
        {tab === "schedule" ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 p-5">
            <div>
              <h2 className="font-semibold">{t(c.title, c.titleEn)}</h2>
              <p className="mt-2 text-sm text-zinc-400">
                {new Date(c.scheduledAt).toLocaleString()}
              </p>
            </div>
            <Button
              onClick={() =>
                void act({ type: "reserve", channelId: id }).catch(() => {})
              }
            >
              <Bell size={16} />
              {user?.reservations.includes(id)
                ? t("已预约", "Reserved")
                : t("预约直播", "Remind me")}
            </Button>
          </div>
        ) : tab === "membership" ? (
          <div className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-6">
            <h2 className="text-xl font-bold">
              {t("与热爱更近一步", "Get closer to what you love")} · $4.99 /{" "}
              {t("月", "month")}
            </h2>
            <p className="my-4 text-sm text-zinc-400">
              {t(
                "专属直播、会员发言与频道徽章。购买流程为本地模拟。",
                "Exclusive streams, member chat, and a channel badge. Local simulated purchase.",
              )}
            </p>
            <Link href={`/live/${id}?purchase=membership`}>
              <Button>{t("查看会员权益", "Explore membership")}</Button>
            </Link>
          </div>
        ) : (
          <div className="max-w-sm">
            <ChannelCard
              channel={{
                ...c,
                ...(tab === "videos" ? { status: "ended" as const } : {}),
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
