"use client"

/** 商业弹窗只负责交互；金额、余额与权益由 domain.ts 重新校验，并通过 db.ts 原子更新。 */
import { Check, Crown, Gift, ShieldCheck } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { hasAccess } from "@/lib/domain"
import type { Channel } from "@/lib/types"
import { useApp } from "./providers"
import { Button, cn, inputClass, Modal } from "./ui/primitives"
export type PurchaseProduct = "membership" | "ticket" | "credits" | "gift"
export function Commerce({
  channel,
  product,
  onClose,
}: {
  channel: Channel
  product: PurchaseProduct | null
  onClose: () => void
}) {
  const { state, user, act, t, toast, setAuthOpen } = useApp(),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState(false),
    [amount, setAmount] = useState(20),
    [coupon, setCoupon] = useState(""),
    // 一次购买意图一个 key：失败重试保持不变，切产品或点击“再送一份”才换键。关闭后重开视为新意图。
    key = useRef("")
  useEffect(() => {
    if (!product) return
    key.current = crypto.randomUUID()
    setSuccess(false)
    setCoupon("")
  }, [product])
  const buy = async () => {
    if (!user) {
      setAuthOpen(true)
      return
    }
    if (!product) return
    setBusy(true)
    try {
      await act(
        product === "gift"
          ? { type: "gift", channelId: channel.id, amount, key: key.current }
          : {
              type: "purchase",
              channelId: channel.id,
              product,
              coupon,
              key: key.current,
            },
      )
      setSuccess(true)
      toast(
        t(
          product === "gift"
            ? "星光已送达，感谢你的支持！"
            : "模拟支付成功，权益已更新",
          product === "gift"
            ? "Your gift is on its way!"
            : "Simulated payment complete",
        ),
      )
    } catch {
    } finally {
      setBusy(false)
    }
  }
  const title =
    product === "membership"
      ? t("成为频道会员", "Become a member")
      : product === "ticket"
        ? t("解锁这场精彩", "Unlock this moment")
        : product === "credits"
          ? t("充值礼物币", "Top up credits")
          : t("把星光送给创作者", "Send a little appreciation")
  const already =
    state &&
    user &&
    product === "membership" &&
    hasAccess(state, user.id, channel.id, "member")
  return (
    <Modal
      open={!!product}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
      title={title}
      description={t(
        "仅本地模拟，不会产生真实支付。",
        "Local simulation only. No real payment will be made.",
      )}
    >
      {success ? (
        <div className="py-5 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-400/10 text-emerald-300">
            <Check size={32} />
          </span>
          <h3 className="mt-5 text-lg font-bold">
            {t("一切就绪", "You’re all set")}
          </h3>
          <p className="mt-2 text-sm text-zinc-400">
            {t(
              "记录已保存，可在「我的空间」查看。",
              "Your transaction is saved in Your library.",
            )}
          </p>
          {product === "gift" && (
            <Button
              className="mt-4 w-full"
              variant="secondary"
              onClick={() => {
                key.current = crypto.randomUUID()
                setSuccess(false)
              }}
            >
              {t("再送一份", "Send another")}
            </Button>
          )}
          <Button className="mt-6 w-full" onClick={onClose}>
            {t("继续观看", "Back to the stream")}
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-6 rounded-xl border border-violet-400/20 bg-violet-500/5 p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold">
                <Crown size={20} className="text-violet-300" />
                {channel.name}
              </span>
              <span className="text-xl font-bold">
                {product === "membership"
                  ? "$4.99"
                  : product === "ticket"
                    ? coupon === "WELCOME20"
                      ? "$2.39"
                      : "$2.99"
                    : product === "credits"
                      ? "$5.00"
                      : `${amount} ✦`}
              </span>
            </div>
            <p className="mt-3 text-xs leading-6 text-zinc-400">
              {product === "membership"
                ? t(
                    "30 天会员权益 · 专属内容 · 会员聊天 · 随时取消续费",
                    "30 days · exclusive streams · member chat · cancel renewal anytime",
                  )
                : product === "credits"
                  ? t(
                      "500 礼物币，可用于支持你喜欢的创作者。",
                      "500 credits to support your favorite creators.",
                    )
                  : product === "ticket"
                    ? t(
                        "解锁本频道单场内容及其回放。",
                        "Unlock this channel’s event and replay.",
                      )
                    : t(
                        "每一份支持，都让创作多一点可能。",
                        "A little appreciation goes a long way.",
                      )}
            </p>
          </div>
          {product === "gift" && (
            <>
              <div className="mb-4 grid grid-cols-4 gap-2">
                {[20, 50, 100, 200].map((v, i) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmount(v)}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-xl border p-3",
                      amount === v
                        ? "border-violet-400 bg-violet-500/15"
                        : "border-white/10",
                    )}
                  >
                    <span className="text-2xl">
                      {["✨", "💜", "🌙", "🚀"][i]}
                    </span>
                    <span className="text-xs">{v} ✦</span>
                  </button>
                ))}
              </div>
              <p className="mb-5 text-xs text-zinc-400">
                {t("可用余额", "Balance")}:{" "}
                <b className="text-white">{user?.credits ?? 0}</b> ✦
              </p>
            </>
          )}
          {product === "ticket" && (
            <label className="mb-5 block text-xs text-zinc-400">
              {t("优惠码（演示：WELCOME20）", "Coupon (demo: WELCOME20)")}
              <input
                className={`${inputClass} mt-2`}
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase())}
              />
            </label>
          )}
          {already ? (
            <p className="text-center text-sm text-emerald-300">
              {t("你已经是该频道会员", "You’re already a member")}
            </p>
          ) : (
            <Button className="w-full" busy={busy} onClick={buy}>
              {product === "gift" ? (
                <Gift size={16} />
              ) : (
                <ShieldCheck size={16} />
              )}{" "}
              {product === "gift"
                ? t("确认送出", "Send gift")
                : t("确认模拟支付", "Confirm simulated payment")}
            </Button>
          )}
          <p className="mt-4 text-center text-[10px] leading-5 text-zinc-600">
            {t(
              "不需要银行卡。所有交易和权益保存在当前浏览器。",
              "No payment details required. Transactions stay in this browser.",
            )}
          </p>
        </>
      )}
    </Modal>
  )
}
