/**
 * 与 React/网络无关的业务规则。execute 会原地修改传入 State，调用者 db.mutate 负责事务提交与回滚。
 * userId/角色只是演示身份，不是生产鉴权；面试时结合输入校验、幂等、权益与原子性讲解。
 */
import { z } from "zod"
import type { Action, ChatMessage, State, User } from "./types"

const string = (value: unknown, max = 200) =>
  z.string().trim().min(1).max(max).parse(value)
const id = () => crypto.randomUUID()
// 会员看有效期，单场票同时匹配 paid 状态和当前 sessionId；退款/到期后重新计算即可撤权。
export function hasAccess(
  s: State,
  userId: string | undefined,
  channelId: string,
  access: string,
  now = Date.now() + s.clockOffset,
) {
  if (access === "free") return true
  if (!userId) return false
  const channel = s.channels.find((c) => c.id === channelId)
  if (channel?.ownerId === userId) return true
  if (access === "member")
    return s.memberships.some(
      (m) => m.userId === userId && m.channelId === channelId && m.until > now,
    )
  return s.orders.some(
    (o) =>
      o.userId === userId &&
      o.channelId === channelId &&
      o.product === "ticket" &&
      o.status === "paid" &&
      o.sessionId === channel?.sessionId,
  )
}
// ID 负责去重，seq 负责排序；后到的同 ID 数据覆盖旧记录（例如删除标记），最后截取有界窗口。
export function mergeMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
  limit = 500,
) {
  return [...new Map([...current, ...incoming].map((m) => [m.id, m])).values()]
    .sort((a, b) => a.seq - b.seq)
    .slice(-limit)
}
// 当前 moderator 是全局演示房管；没有实现生产系统中每个房间独立的角色授权。
export function canModerate(user: User | undefined, owner: string) {
  return !!user && (user.id === owner || user.role === "moderator")
}
export function execute(
  s: State,
  a: Action,
  time = Date.now() + s.clockOffset,
): unknown {
  const user = s.users.find((u) => u.id === a.userId)
  const channel = s.channels.find((c) => c.id === a.channelId)
  const notice = (text: string, channelId?: string) =>
    s.notices.unshift({
      id: id(),
      userId: user?.id ?? "",
      text,
      channelId,
      read: false,
      at: time,
    })
  if (a.type === "scenario") {
    s.scenario = z
      .enum([
        "normal",
        "slow",
        "error",
        "disconnect",
        "duplicate",
        "reorder",
        "expired",
        "timeout",
      ])
      .parse(a.value)
    return true
  }
  if (a.type === "burst") {
    const room = s.channels.find((c) => c.id === a.channelId)
    if (!room) throw Error("Unknown room")
    const count = z.number().int().min(1).max(100).parse(a.count)
    s.messages = mergeMessages(
      s.messages,
      Array.from({ length: count }, () => ({
        id: id(),
        roomId: room.id,
        seq: ++s.seq,
        userId: "load-test",
        name: "Load test",
        text: `Test message ${s.seq} · bounded queue`,
        time,
      })),
      4000,
    )
    return true
  }
  // 开发用业务时钟只影响权益判断；不会加速 video.currentTime 或 WebRTC。续费失败是模拟结果。
  if (a.type === "clock") {
    s.clockOffset += z.number().int().min(0).max(366).parse(a.days) * 86400000
    for (const m of s.memberships) {
      if (m.renew && m.until <= Date.now() + s.clockOffset) {
        m.renewalFailed = true
        m.renew = false
        s.notices.unshift({
          id: id(),
          userId: m.userId,
          channelId: m.channelId,
          text: "模拟续费失败，会员已到期 / Simulated renewal failed; membership expired",
          read: false,
          at: Date.now() + s.clockOffset,
        })
      }
    }
    return true
  }
  if (a.type === "register") {
    const email = z.email().parse(a.email)
    if (s.users.some((u) => u.email === email))
      throw Error("该邮箱已注册 / Email already registered")
    const u: User = {
      id: id(),
      name: string(a.name, 40),
      email,
      credits: 0,
      role: "viewer",
      follows: [],
      bookmarks: [],
      reservations: [],
      blocked: [],
      history: [],
      notifications: true,
    }
    s.users.push(u)
    return u
  }
  if (!user) throw Error("请先登录 / Please sign in")
  if (a.type === "profile") {
    user.name = string(a.name, 40)
    user.notifications = a.notifications !== false
    if (typeof a.avatar === "string")
      user.avatar = z
        .string()
        .max(1500000)
        .regex(/^data:image\/(png|jpeg|webp);base64,/)
        .parse(a.avatar)
    return user
  }
  if (a.type === "readNotice") {
    s.notices
      .filter((n) => n.userId === user.id)
      .forEach((n) => {
        n.read = true
      })
    return true
  }
  if (a.type === "block") {
    const target = string(a.target)
    user.blocked = user.blocked.includes(target)
      ? user.blocked.filter((x) => x !== target)
      : [...user.blocked, target]
    return true
  }
  if (a.type === "report") {
    s.reports.push({
      userId: user.id,
      target: string(a.target),
      reason: string(a.reason, 500),
      at: time,
    })
    notice("举报已提交，感谢你维护社区。")
    return true
  }
  // 退款按订单归属处理；重复申请返回已有状态。已消费充值进入 pending，不拿后来充值的余额冲销旧消费。
  if (a.type === "refund") {
    const order = s.orders.find(
      (o) => o.id === a.orderId && o.userId === user.id,
    )
    if (!order) throw Error("订单不存在 / Order not found")
    if (order.status !== "paid") return order
    if (
      order.product === "credits" &&
      (user.credits < order.credits ||
        s.gifts.some((g) => g.funding?.some((f) => f.orderId === order.id)))
    ) {
      order.status = "refund_pending"
      notice("已消费的充值订单已进入模拟审核。")
      return order
    }
    order.status = "refunded"
    if (order.product === "credits") user.credits -= order.credits
    s.memberships = s.memberships.filter((m) => m.orderId !== order.id)
    notice("模拟退款成功，对应权益已更新。", order.channelId)
    return order
  }
  if (!channel) throw Error("频道不存在 / Channel not found")
  if (["follow", "bookmark", "reserve"].includes(a.type)) {
    const field =
      a.type === "follow"
        ? "follows"
        : a.type === "bookmark"
          ? "bookmarks"
          : "reservations"
    user[field] = user[field].includes(channel.id)
      ? user[field].filter((x) => x !== channel.id)
      : [...user[field], channel.id]
    if (a.type === "reserve" && user.reservations.includes(channel.id))
      notice(`已预约 ${channel.name} 的直播`, channel.id)
    return true
  }
  if (a.type === "history") {
    user.history = [
      { channelId: channel.id, at: time },
      ...user.history.filter((h) => h.channelId !== channel.id),
    ].slice(0, 100)
    return true
  }
  if (a.type === "like") {
    const ids = s.likes[channel.id] ?? []
    s.likes[channel.id] = ids.includes(user.id)
      ? ids.filter((x) => x !== user.id)
      : [...ids, user.id]
    return true
  }
  if (a.type === "purchase") {
    const product = z
        .enum(["membership", "ticket", "credits"])
        .parse(a.product),
      key = string(a.key)
    // 幂等按 userId + key 查旧结果。必须和扣款/发权益位于同一事务，禁用按钮本身不能避免重复入账。
    // 本版未校验同 key 的载荷指纹；接真实服务时还应拒绝“同键不同商品/金额”。
    const previous = s.orders.find((o) => o.key === key && o.userId === user.id)
    if (previous) return previous
    if (
      product === "membership" &&
      hasAccess(s, user.id, channel.id, "member", time)
    )
      throw Error("会员已生效 / Membership already active")
    if (
      product === "ticket" &&
      hasAccess(s, user.id, channel.id, "ticket", time)
    )
      throw Error("已购买此内容 / Already purchased")
    if (a.coupon && a.coupon !== "WELCOME20")
      throw Error("优惠码无效或已过期 / Invalid coupon")
    if (a.coupon && product !== "ticket")
      throw Error("优惠码仅适用于单场内容 / Tickets only")
    // 金额以整数“分”计算，礼物币是另一种单位；不要把 UI 显示的小数金额当成账务值。
    let cents =
      product === "membership" ? 499 : product === "ticket" ? 299 : 500
    if (a.coupon) cents = Math.round(cents * 0.8)
    const order = {
      id: id(),
      userId: user.id,
      channelId: channel.id,
      product,
      sessionId: channel.sessionId,
      cents,
      credits: product === "credits" ? 500 : 0,
      status: "paid" as const,
      at: time,
      key,
    }
    s.orders.unshift(order)
    if (product === "credits") user.credits += 500
    if (product === "membership")
      s.memberships.push({
        userId: user.id,
        channelId: channel.id,
        until: time + 30 * 86400000,
        renew: true,
        orderId: order.id,
      })
    notice("模拟支付成功，订单与权益已更新。", channel.id)
    return order
  }
  if (a.type === "gift") {
    const amount = z.number().int().positive().max(10000).parse(a.amount),
      key = string(a.key)
    const previous = s.gifts.find((g) => g.key === key && g.userId === user.id)
    if (previous) return previous
    if (user.credits < amount)
      throw Error("礼物币不足，请先模拟充值 / Not enough credits")
    user.credits -= amount
    // 保存礼物币来源：先按旧到新消耗未退款充值，剩余来自演示初始余额。用于判断某笔充值是否已消费。
    let remaining = amount
    const funding: { orderId: string; amount: number }[] = []
    for (const order of s.orders
      .filter(
        (o) =>
          o.userId === user.id &&
          o.product === "credits" &&
          o.status !== "refunded",
      )
      .slice()
      .reverse()) {
      const used = s.gifts
        .flatMap((g) => g.funding ?? [])
        .filter((f) => f.orderId === order.id)
        .reduce((sum, f) => sum + f.amount, 0)
      const take = Math.min(remaining, order.credits - used)
      if (take > 0) {
        funding.push({ orderId: order.id, amount: take })
        remaining -= take
      }
      if (!remaining) break
    }
    if (remaining)
      funding.push({ orderId: "demo-opening-balance", amount: remaining })
    const gift = {
      id: id(),
      userId: user.id,
      channelId: channel.id,
      amount,
      funding,
      key,
      at: time,
    }
    s.gifts.unshift(gift)
    s.messages = mergeMessages(
      s.messages,
      [
        {
          id: id(),
          roomId: channel.id,
          seq: ++s.seq,
          userId: user.id,
          name: user.name,
          text: `送出了 ${amount} 礼物币的星光 ✨`,
          time,
          kind: "gift",
        },
      ],
      4000,
    )
    return gift
  }
  // 取消续费只改 renew，已付费周期的 until 保留；这与立即退款撤权是两种不同操作。
  if (a.type === "cancelMembership") {
    const m = s.memberships.find(
      (m) =>
        m.userId === user.id && m.channelId === channel.id && m.until > time,
    )
    if (m) m.renew = false
    return true
  }
  if (a.type === "vote") {
    const p = s.polls[channel.id]
    if (!p || p.closed) throw Error("投票已结束 / Poll closed")
    p.votes[user.id] = z
      .number()
      .int()
      .min(0)
      .max(p.options.length - 1)
      .parse(a.option)
    return true
  }
  if (a.type === "message") {
    if (channel.mutedUsers.includes(user.id))
      throw Error("你已被禁言 / You are muted")
    if (
      channel.chatMode === "followers" &&
      !user.follows.includes(channel.id) &&
      !canModerate(user, channel.ownerId)
    )
      throw Error("关注后即可发言 / Follow to chat")
    if (
      channel.chatMode === "members" &&
      !hasAccess(s, user.id, channel.id, "member", time)
    )
      throw Error("仅会员可发言 / Members only")
    // 同一消息重试复用 ID；跨用户/跨房间碰撞要拒绝，不能覆盖别人的消息。
    const previous = s.messages.find((m) => m.id === a.id)
    if (previous) {
      if (previous.userId !== user.id || previous.roomId !== channel.id)
        throw Error("消息 ID 冲突 / Message ID conflict")
      return previous
    }
    const last = s.messages
      .filter((m) => m.roomId === channel.id && m.userId === user.id)
      .at(-1)
    if (channel.slowMode && last && time - last.time < 10000)
      throw Error("慢速模式：每 10 秒发送一次 / Slow mode")
    const m: ChatMessage = {
      id: string(a.id),
      roomId: channel.id,
      seq: ++s.seq,
      userId: user.id,
      name: user.name,
      text: string(a.text, 300),
      time,
      mediaTime:
        a.mediaTime === undefined
          ? undefined
          : z.number().finite().nonnegative().parse(a.mediaTime),
      kind: a.kind === "question" ? "question" : "chat",
      replyTo: typeof a.replyTo === "string" ? a.replyTo : undefined,
    }
    s.messages = mergeMessages(s.messages, [m], 4000)
    return m
  }
  if (["updateRoom", "moderate", "poll", "start", "end"].includes(a.type)) {
    if (!canModerate(user, channel.ownerId))
      throw Error("无操作权限 / Permission denied")
    if (a.type === "moderate") {
      if (a.operation === "mute") {
        const target = string(a.target)
        channel.mutedUsers = channel.mutedUsers.includes(target)
          ? channel.mutedUsers.filter((x) => x !== target)
          : [...channel.mutedUsers, target]
      } else if (a.operation === "pin") channel.pinnedId = string(a.target)
      else if (a.operation === "delete") {
        const m = s.messages.find(
          (m) => m.id === a.target && m.roomId === channel.id,
        )
        if (m) m.deleted = true
      }
      return true
    }
    if (a.type === "poll") {
      s.polls[channel.id] = {
        question: string(a.question),
        options: z
          .array(z.string().min(1).max(50))
          .min(2)
          .max(4)
          .parse(a.options),
        votes: {},
        closed: false,
      }
      return true
    }
    if (a.type === "updateRoom") {
      if (a.title) channel.title = string(a.title, 100)
      if (a.category)
        channel.category = z
          .enum(["irl", "music", "gaming", "creative"])
          .parse(a.category)
      if (a.language) channel.language = z.enum(["zh", "en"]).parse(a.language)
      if (a.access)
        channel.access = z.enum(["free", "member", "ticket"]).parse(a.access)
      if (typeof a.announcement === "string")
        channel.announcement = a.announcement.slice(0, 300)
      if (typeof a.slowMode === "boolean") channel.slowMode = a.slowMode
      if (a.chatMode)
        channel.chatMode = z
          .enum(["all", "followers", "members"])
          .parse(a.chatMode)
      if (typeof a.scheduledAt === "number") {
        channel.scheduledAt = z.number().finite().min(time).parse(a.scheduledAt)
        if (channel.status === "ended") channel.sessionId = id()
        channel.sessionId ??= id()
        channel.startedAt = undefined
        channel.endedAt = undefined
        channel.status = "scheduled"
      }
      if (
        typeof a.cover === "string" &&
        a.cover.startsWith("data:image/") &&
        a.cover.length < 1500000
      )
        channel.cover = a.cover
      return channel
    }
    // 预约时已售出的票绑定了 sessionId，正式开播要沿用它；已结束后重开才创建新场次。
    const broadcastId =
      a.broadcastId === undefined ? undefined : z.uuid().parse(a.broadcastId)
    // 离开旧标签页的异步清理，不能结束后来开始的网页直播。
    if (a.type === "end" && broadcastId && channel.broadcastId !== broadcastId)
      return channel
    if (a.type === "start") {
      if (
        channel.startedAt &&
        channel.status === "live" &&
        channel.broadcastId === broadcastId
      )
        return channel
      channel.broadcastId = broadcastId
      if (channel.status === "ended") channel.sessionId = id()
      channel.sessionId ??= id()
      channel.startedAt = time
      channel.endedAt = undefined
    } else channel.endedAt = time
    channel.status = a.type === "start" ? "live" : "ended"
    if (a.type === "start")
      s.users
        .filter((u) => u.reservations.includes(channel.id) && u.notifications)
        .forEach((u) => {
          s.notices.unshift({
            id: id(),
            userId: u.id,
            text: `${channel.name} 已开播`,
            channelId: channel.id,
            read: false,
            at: time,
          })
        })
    return channel
  }
  throw Error("未知操作 / Unknown action")
}
