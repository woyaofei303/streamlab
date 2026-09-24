# 接口契约

默认浏览器 MSW 模式；业务请求必须等待 `startMocks()` 完成。mock API 不存在于真实服务端，curl `/api/v1/state` 无法读取浏览器业务库。TypeScript 核心对象见 `src/lib/types.ts`。

## HTTP

```text
GET  /api/v1/state
  → State：用户、频道、订单、会员、礼物、通知、消息、投票、时钟和场景
GET  /api/v1/messages?roomId=mei&after=64
  → ChatMessage[]，seq > after
POST /api/v1/action
  → 对应结果；错误 { error: string }，400/401/503
POST /api/v1/reset
  → { ok: true }
```

浏览器调用示例：

```js
await fetch('/api/v1/action', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'purchase', userId: 'viewer', channelId: 'mei',
    product: 'membership', key: crypto.randomUUID()
  })
}).then(r => r.json())
```

## Action 载荷

```text
register: email, name
profile: userId, name, notifications, avatar?（base64 png/jpeg/webp ≤ 1.5MB）
follow | bookmark | reserve | history | like: userId, channelId
block: userId, target
report: userId, target, reason
readNotice: userId
purchase: userId, channelId, product=membership|ticket|credits, key, coupon?
gift: userId, channelId, amount（正整数）, key
refund: userId, orderId
cancelMembership: userId, channelId
message: userId, channelId, id, text（≤300字符）, mediaTime?, replyTo?, kind?
vote: userId, channelId, option（有效选项索引）
moderate: userId, channelId, operation=pin|mute|delete, target
poll: userId, channelId, question, options（2~4项）
updateRoom: userId, channelId, title?, category?, language?, access?, cover?, scheduledAt?, announcement?, slowMode?, chatMode?
start | end: userId, channelId
requestCall: userId, channelId, cancel?
answerCall: userId, channelId, target, value=accepted|rejected|ended
scenario: value=normal|slow|error|disconnect|duplicate|reorder|expired|timeout
clock: days（0~366）
burst: channelId, count（1~100）
```

用户/角色是模拟身份字段，不能作为生产认证。频道所有者和演示房管可管理房间操作（当前房管是全局角色，未实现房间级授权）；退款只能操作当前用户订单。

## 交易约定

- USD 分：会员 499、单场 299、充值 500 换 500 礼物币。`WELCOME20` 仅单场，金额整数四舍五入为 239。
- 购买/送礼按用户 + 幂等 key 去重。超时重试复用 key，新一次交易才换 key。
- 充值、余额、礼物及礼物消息在同一事务更新；礼物的 funding 记录来源订单，初始演示余额使用 `demo-opening-balance`。
- 成功退款撤销对应订单权益；已使用的充值进入 `refund_pending`，不根据后来补充的余额直接退款。
- 取消自动续费保留已付费周期；实验时钟触发到期。模拟续费失败状态和通知可在会员页查看。
- 频道会员按频道授权，单场内容按场次授权，回放继承对应场次。

## WebSocket

```text
浏览器连接 ws://localhost:3000/chat（被 MSW 拦截，无真实 WS 服务端）
客户端 → join {roomId, after}
客户端 → ping
客户端 → message {id,userId,text,mediaTime?,replyTo?,kind?}
服务端 → messages {messages: ChatMessage[]}
服务端 → reset {messages}（演示数据重置后替换窗口）
服务端 → ack {message}
服务端 → error {id?,error}
服务端 → pong
```

消息字段包含 id、roomId、seq、userId、name、text、time、mediaTime、kind、replyTo、deleted。断线后按最后序号补拉，重复消息按 ID 合并，最终按 seq 排序。客户端只显示一次发送状态；失败可用相同 ID 重试。慢速模式 10 秒、关注者/会员限制、禁言在共同业务规则中执行。

## 固定用途 Next.js 工具路由

```text
GET /api/media/status                 MediaMTX live 输入状态
GET /api/media/recordings             本地录制列表
GET /api/media/recording?start=&duration=  有边界的固定 live 路径回放
GET /api/media/fault/<资源路径>?mode=slow|fail|bandwidth  本地 HLS 故障
GET /api/twitch/streams               可选 Twitch 目录代理
```

代理目标固定为本地服务或 Twitch；浏览器无法提交任意代理 URL。MediaMTX Docker 端口仅绑定宿主机回环地址。
