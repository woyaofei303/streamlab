"use client"

/** 个人中心按 URL tab 展示共享业务快照中的当前用户记录；退款和取消续费仍走统一 act/事务入口。 */
import {
  Bookmark,
  Clock,
  CreditCard,
  Crown,
  Heart,
  Settings,
  Ticket,
  Wallet,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { Commerce, type PurchaseProduct } from "./commerce"
import { ChannelCard } from "./home"
import { useApp } from "./providers"
import { Avatar, Button, cn, Empty, inputClass, Modal } from "./ui/primitives"
export function Library() {
  const { state, user, t, act, setAuthOpen, login, toast } = useApp(),
    params = useSearchParams(),
    router = useRouter(),
    tab = params.get("tab") ?? "following"
  const [product, setProduct] = useState<PurchaseProduct | null>(null),
    [refund, setRefund] = useState(""),
    [busy, setBusy] = useState(false)
  if (!state) return null
  if (!user)
    return (
      <div className="p-8">
        <Empty
          title={t("你的世界，从这里开始", "Your world starts here")}
          description={t(
            "登录后管理关注、订单与会员权益。",
            "Sign in to manage your channels, orders, and memberships.",
          )}
        >
          <Button onClick={() => setAuthOpen(true)}>
            {t("登录", "Sign in")}
          </Button>
        </Empty>
      </div>
    )
  const tabs = [
    ["following", "关注", "Following", Heart],
    ["bookmarks", "收藏", "Saved", Bookmark],
    ["history", "历史", "History", Clock],
    ["reservations", "预约", "Upcoming", Ticket],
    ["orders", "订单", "Orders", CreditCard],
    ["memberships", "会员", "Memberships", Crown],
    ["gifts", "消费", "Gifts", Wallet],
    ["settings", "设置", "Settings", Settings],
  ] as const
  const cards = state.channels.filter((c) =>
    tab === "history"
      ? user.history.some((h) => h.channelId === c.id)
      : tab === "reservations"
        ? user.reservations.includes(c.id)
        : tab === "bookmarks"
          ? user.bookmarks.includes(c.id)
          : user.follows.includes(c.id),
  )
  const orders = state.orders.filter((o) => o.userId === user.id)
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar src={user.avatar} name={user.name} size="lg" />
          <div>
            <p className="text-xs text-zinc-500">
              {t("很高兴再次见到你", "GOOD TO HAVE YOU BACK")}
            </p>
            <h1 className="mt-1 text-2xl font-bold">{user.name}</h1>
            <p className="mt-1 text-xs text-zinc-600">{user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-xl border border-violet-400/15 bg-violet-500/5 px-5 py-4">
          <div>
            <p className="text-[10px] text-zinc-500">
              {t("礼物币余额", "YOUR CREDITS")}
            </p>
            <p className="mt-1 text-2xl font-bold text-violet-200">
              {user.credits} <span className="text-sm">✦</span>
            </p>
          </div>
          <Button variant="secondary" onClick={() => setProduct("credits")}>
            {t("充值", "Top up")}
          </Button>
        </div>
      </div>
      <nav className="my-8 flex gap-5 overflow-x-auto border-b border-white/10">
        {tabs.map(([key, zh, en, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => router.push(`/library?tab=${key}`)}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 pb-3 text-xs",
              tab === key
                ? "border-violet-400 text-violet-300"
                : "border-transparent text-zinc-500",
            )}
          >
            <Icon size={15} />
            {t(zh, en)}
          </button>
        ))}
      </nav>
      {["following", "bookmarks", "history", "reservations"].includes(tab) &&
        (cards.length ? (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <ChannelCard key={c.id} channel={c} />
            ))}
          </div>
        ) : (
          <Empty
            title={t("从一个喜欢的频道开始", "Start with a channel you love")}
            description={t(
              "浏览直播，留下属于你的精彩时刻。",
              "Explore streams and save your favorite moments.",
            )}
          >
            <Link href="/">
              <Button>{t("去发现", "Explore")}</Button>
            </Link>
          </Empty>
        ))}
      {tab === "orders" &&
        (orders.length ? (
          <div className="space-y-3">
            {orders.map((o) => (
              <div
                key={o.id}
                className="rounded-xl border border-white/8 bg-[#17171b] p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">
                      {o.product === "membership"
                        ? t("频道会员", "Channel membership")
                        : o.product === "ticket"
                          ? t("单场观看", "Event ticket")
                          : t("礼物币充值", "Credit top-up")}{" "}
                      · {state.channels.find((c) => c.id === o.channelId)?.name}
                    </h2>
                    <p className="mt-2 font-mono text-[10px] text-zinc-600">
                      {o.id}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">
                      ${(o.cents / 100).toFixed(2)}
                    </p>
                    <p
                      className={cn(
                        "mt-1 text-[10px]",
                        o.status === "paid"
                          ? "text-emerald-300"
                          : "text-amber-300",
                      )}
                    >
                      {o.status === "paid"
                        ? t("模拟支付成功", "Simulated payment complete")
                        : o.status === "refunded"
                          ? t("已退款", "Refunded")
                          : t("退款审核中", "Refund under review")}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
                  <p className="text-[10px] text-zinc-500">
                    {new Date(o.at).toLocaleString()}
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className="text-xs text-zinc-400"
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(o, null, 2)], {
                            type: "application/json",
                          }),
                          url = URL.createObjectURL(blob),
                          a = document.createElement("a")
                        a.href = url
                        a.download = `streamlab-receipt-${o.id}.json`
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                    >
                      {t("下载演示收据", "Download demo receipt")}
                    </button>
                    {o.status === "paid" && (
                      <button
                        type="button"
                        className="text-xs text-violet-300"
                        onClick={() => setRefund(o.id)}
                      >
                        {t("申请退款", "Request refund")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty title={t("还没有订单", "No orders yet")} />
        ))}
      {tab === "memberships" && (
        <div className="space-y-4">
          {state.memberships
            .filter((m) => m.userId === user.id)
            .map((m) => (
              <div
                key={m.orderId}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-violet-400/15 bg-violet-500/5 p-5"
              >
                <div>
                  <h2 className="font-semibold">
                    {state.channels.find((c) => c.id === m.channelId)?.name}
                  </h2>
                  <p className="mt-2 text-xs text-zinc-400">
                    {m.until > Date.now() + state.clockOffset
                      ? t("生效中", "Active")
                      : t("已到期", "Expired")}{" "}
                    · {new Date(m.until).toLocaleDateString()}
                  </p>
                  <p className="mt-1 text-[10px] text-zinc-500">
                    {m.renewalFailed
                      ? t(
                          "模拟续费失败，请重新开通",
                          "Simulated renewal failed; subscribe again",
                        )
                      : m.renew
                        ? t("模拟自动续费已开启", "Simulated renewal enabled")
                        : t(
                            "已取消续费，到期后失效",
                            "Renewal canceled; access ends at expiry",
                          )}
                  </p>
                </div>
                {m.renew && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void act({
                        type: "cancelMembership",
                        channelId: m.channelId,
                      }).catch(() => {})
                    }
                  >
                    {t("取消续费", "Cancel renewal")}
                  </Button>
                )}
              </div>
            ))}
          {!state.memberships.some((m) => m.userId === user.id) && (
            <Empty title={t("还没有订阅频道", "No memberships yet")} />
          )}
        </div>
      )}
      {tab === "gifts" && (
        <div className="space-y-3">
          {state.gifts
            .filter((g) => g.userId === user.id)
            .map((g) => (
              <div
                key={g.id}
                className="flex justify-between rounded-xl border border-white/8 p-4 text-sm"
              >
                <div>
                  ✨ {state.channels.find((c) => c.id === g.channelId)?.name}
                  <p className="mt-1 text-[10px] text-zinc-600">
                    {new Date(g.at).toLocaleString()}
                  </p>
                </div>
                <span className="text-violet-300">−{g.amount} ✦</span>
              </div>
            ))}
          {!state.gifts.some((g) => g.userId === user.id) && (
            <Empty title={t("还没有礼物记录", "No gifts yet")} />
          )}
        </div>
      )}
      {tab === "settings" && (
        <form
          className="max-w-lg space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            const data = new FormData(e.currentTarget)
            void act({
              type: "profile",
              name: data.get("name"),
              notifications: data.get("notifications") === "on",
            })
              .then(() => toast(t("设置已保存", "Settings saved")))
              .catch(() => {})
          }}
        >
          <label className="block text-xs text-zinc-400">
            {t(
              "头像（PNG / JPG / WebP，1MB 以内）",
              "Avatar (PNG / JPG / WebP, under 1MB)",
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="mt-2 block w-full"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                if (file.size > 1000000) {
                  toast(t("图片超过 1MB", "Image exceeds 1MB"))
                  return
                }
                const r = new FileReader()
                r.onload = () =>
                  void act({
                    type: "profile",
                    name: user.name,
                    notifications: user.notifications,
                    avatar: r.result,
                  }).catch(() => {})
                r.readAsDataURL(file)
              }}
            />
          </label>
          <label className="block text-xs text-zinc-400">
            {t("昵称", "Display name")}
            <input
              name="name"
              defaultValue={user.name}
              required
              maxLength={40}
              className={`${inputClass} mt-2`}
            />
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="notifications"
              defaultChecked={user.notifications}
            />
            {t("接收开播与预约通知", "Receive stream notifications")}
          </label>
          <Button type="submit">{t("保存设置", "Save settings")}</Button>
          <div className="border-t border-white/10 pt-6">
            <Button variant="danger" onClick={() => login("")}>
              {t("退出当前账号", "Sign out")}
            </Button>
          </div>
        </form>
      )}
      <Commerce
        channel={state.channels[0]}
        product={product}
        onClose={() => setProduct(null)}
      />
      <Modal
        open={!!refund}
        onOpenChange={() => setRefund("")}
        title={t("申请模拟退款", "Request simulated refund")}
        description={t(
          "退款成功后会撤销相应权益。已消费的礼物币充值将进入模拟审核。",
          "A refund revokes related access. Spent credit purchases enter simulated review.",
        )}
      >
        <Button
          variant="danger"
          className="w-full"
          busy={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await act({ type: "refund", orderId: refund })
              setRefund("")
              toast(t("退款结果已更新", "Refund status updated"))
            } catch {
            } finally {
              setBusy(false)
            }
          }}
        >
          {t("确认申请退款", "Confirm refund request")}
        </Button>
      </Modal>
    </div>
  )
}
