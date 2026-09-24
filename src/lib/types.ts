/** 业务契约：频道同时承载当前场次；会员按频道授权，单场订单另绑定 sessionId。详见 docs/ARCHITECTURE.md。 */
export type Locale = "zh" | "en"
export type Access = "free" | "member" | "ticket"
export type Source = {
  kind: "hls" | "file" | "youtube" | "twitch" | "webrtc"
  url: string
  live: boolean
  subtitles?: string
}
export type Channel = {
  id: string
  ownerId: string
  name: string
  title: string
  titleEn: string
  description: string
  category: string
  language: string
  status: "live" | "scheduled" | "offline" | "ended"
  viewers: number
  followers: string
  cover: string
  avatar: string
  color: string
  tags: string[]
  access: Access
  source: Source
  scheduledAt: number
  announcement: string
  slowMode: boolean
  chatMode: "all" | "followers" | "members"
  mutedUsers: string[]
  sessionId?: string
  startedAt?: number
  endedAt?: number
  callRequests?: Record<string, "requested" | "accepted" | "rejected" | "ended">
  pinnedId?: string
}
export type User = {
  id: string
  name: string
  email: string
  credits: number
  avatar?: string
  role: "viewer" | "creator" | "moderator"
  follows: string[]
  bookmarks: string[]
  reservations: string[]
  blocked: string[]
  history: { channelId: string; at: number }[]
  notifications: boolean
}
export type Order = {
  id: string
  userId: string
  channelId: string
  product: "membership" | "ticket" | "credits"
  sessionId?: string
  cents: number
  credits: number
  status: "paid" | "refunded" | "refund_pending"
  at: number
  key: string
}
export type Membership = {
  userId: string
  channelId: string
  until: number
  renew: boolean
  renewalFailed?: boolean
  orderId: string
}
export type Gift = {
  funding?: { orderId: string; amount: number }[]
  id: string
  userId: string
  channelId: string
  amount: number
  at: number
  key: string
}
export type Notice = {
  id: string
  userId: string
  text: string
  channelId?: string
  read: boolean
  at: number
}
export type ChatMessage = {
  id: string
  roomId: string
  seq: number
  userId: string
  name: string
  text: string
  time: number
  mediaTime?: number
  kind?: "chat" | "gift" | "system" | "question"
  replyTo?: string
  deleted?: boolean
}
export type Poll = {
  question: string
  options: string[]
  votes: Record<string, number>
  closed: boolean
}
export type Scenario =
  | "normal"
  | "slow"
  | "error"
  | "disconnect"
  | "duplicate"
  | "reorder"
  | "expired"
  | "timeout"
export type State = {
  version: number
  users: User[]
  channels: Channel[]
  orders: Order[]
  memberships: Membership[]
  gifts: Gift[]
  notices: Notice[]
  messages: ChatMessage[]
  polls: Record<string, Poll>
  likes: Record<string, string[]>
  reports: { userId: string; target: string; reason: string; at: number }[]
  scenario: Scenario
  clockOffset: number
  seq: number
}
// 演示使用宽泛 Action，再由 domain.ts 的 Zod/权限分支校验；它不是完整的 TypeScript 可辨识联合。
export type Action = Record<string, unknown> & { type: string; userId?: string }
export type Metric = { time: number; type: string; value?: number | string }
