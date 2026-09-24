# 验证与性能记录

验证设备：Apple M1 Pro、32 GB 内存、10 个逻辑 CPU，macOS；Node 24.14.0、pnpm 11.21.0。基于本机开发服务器与固定生成的 60 秒测试素材。最终结果见下文，不能外推为生产 CDN 或跨境性能。

## 验证方式

- 业务逻辑与 IndexedDB 事务：Vitest，包含重复购买、退款撤权、到期、已消费充值退款、跨用户消息 ID 碰撞及预约单场权益。
- 页面交互：Playwright Chromium / Firefox / WebKit。每项测试使用隔离上下文；双标签测试共享当前上下文的 IndexedDB，但保留独立 sessionStorage 身份。
- 布局：1440、1024、768、390 四种宽度，覆盖首页、直播间、个人中心以及使用主播身份的开播工作页；检查横向溢出并保存截图。
- RTC 自动化：Chromium 明确授予 camera/microphone，使用浏览器生成的假设备，传输、SDP、ICE 与 getStats 为真实。假设备检查不等于物理摄像头/麦克风验收。
- 实际媒体：Docker MediaMTX 1.21.1，FFmpeg 循环本地素材，验证 RTMP → LL-HLS 和浏览器 WHIP → WHEP。OBS 使用相同 RTMP 入口，未将 FFmpeg 验证记作 OBS UI 操作。

## 复现命令

```sh
pnpm check
pnpm media:fixture
STREAMLAB_MEDIA_TEST=1 pnpm test:e2e
pnpm media:fixture:stop
```

浏览器详细结果、失败 trace、布局截图与 JSON 附件位于 `output-tdd/playwright/streamlab/`，不纳入 Git 提交。`tests/e2e/media-performance.spec.ts` 保留可重复运行的资源生命周期、消息压力与媒体测试。

## 已修复的验证发现

1. 初始清单 404 时，hls.js 必须重新 loadSource；仅 startLoad 无法恢复没有 level 的播放器。现有限两次恢复，之后显示手动重试。
2. 预约单场票必须保留到正式开始场次；结束后再次开播才生成新场次 ID。已有单元回归。
3. WHIP 请求取消后返回的旧错误不能关闭新建 WHEP peer。已有取消竞态回归。
4. 结束场次后观众可以选择真实录制；自动化用本地 MP4 fixture 验证入口，不依赖正在运行的媒体服务。
5. Firefox 第二标签页可能暂时没有 Service Worker controller。使用自有 worker wrapper 发起 clients.claim，等待接管后才启动 MSW，避免初始化重复刷新。参考 [MDN clients.claim](https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim)。
6. IM 的新消息必须经消息通道或重连补拉；Query 缓存只更新已收到消息的管理状态。测试先确认断线期消息不可见，再恢复网络确认补拉，重置后移除旧消息。
7. Docker Desktop WebRTC UDP 地址在本机连接失败，增加端口 8189 的静态 TCP 监听与回环映射后，WHIP/WHEP 双向轨道验证成功。参考 [MediaMTX WebRTC connectivity](https://mediamtx.org/docs/features/webrtc-specific-features)。

## 检查边界

- Playwright WebKit 是浏览器引擎测试，不能写成原生 Safari 已通过。尝试连接原生 Safari 两次均超时，本次未完成该项。
- 四个宽度属于桌面浏览器视口验证，未连接 iPhone/Android 真机。
- 连续切房的计数器检查播放器实例；不替代长期 heap snapshot 和系统级泄漏分析。
- 外部嵌入单独联网检查，网络与平台内容变化不会影响默认本地场景或稳定测试。
- 所有商业业务均为模拟，真实支付、生产鉴权、公网 TURN/SFU、真实跨境 CDN 不在实施范围。

## 最终结果

2026-09-24 本机执行：

- `pnpm check`：Biome、TypeScript、10 项 Vitest、Next.js 生产构建成功。`pnpm start --port 3001` 冒烟检查确认生产模式 MSW 初始化、直播间渲染、HLS 时间前进。
- 实际执行 `sh .husky/_/pre-commit`：lint-staged、Biome、类型检查、10 项测试通过；没有创建提交。自动生成的 next-env.d.ts 与 MSW worker 不参与手工格式化。
- 完整浏览器回归：27 通过、12 按范围跳过、0 失败。12 个跳过项是 Firefox/WebKit 中各 6 个仅为 Chromium 配置的 RTC/媒体/压力检查，不代表对应功能在这些浏览器已通过。
- 修复键盘焦点后针对弹窗、语言、设备拒绝与商业流程补跑 9 项（三浏览器）全部通过；新增 6 项独立用例，去重后的已通过浏览器用例合计 33。
- 原始摘要和实验事件保存在 [evidence.json](evidence.json)。Playwright 使用 Desktop Chrome 默认 UA，因此附件 UA 含 Windows；真实测试主机是上文的 macOS。
- 30 次客户端切房后播放器实例为 0。
- 100 条/秒、60 批共 6,000 条：发起窗口约 59.17 秒（首批在 t=0，末批在 t=59），保留 4,000 条，聊天渲染 27 行；操作响应 71ms，观察到 1 个 66ms 长任务。它是同一机器的一次观察，不是通用 SLA。
- LL-HLS 显示真实解码画面；WHIP/WHEP 接收端 audio/video 两条轨道均为 live；双标签 P2P 挂断后 srcObject 清空。
- MediaMTX 实际录制通过观众入口播放：1280×720，时长约 869.2 秒；首帧后 currentTime 前进。浏览器 fixture 测试与这一真实媒体检查分别记录。

## 播放实验

```sh
node scripts/measure-playback.mjs
```

每次新建浏览器上下文、关闭 HTTP 缓存，使用同一媒体素材。正常播放走静态地址；慢分片、限速走同源故障路由；开发服务器、文件系统缓存及后台任务仍可能影响短耗时结果。三次正常/三次慢请求，并额外执行一次限速：

- 正常首帧：214 / 72 / 68ms，中位数 72ms；0 次卡顿。
- 每个分片额外延迟 1500ms：1582 / 1567 / 1564ms，中位数 1567ms；本次短播放窗口内 0 次卡顿。
- 约 0.5 Mbps 分片传输上限（每 250ms 发 16KiB）：首帧 13697ms，720p → 360p，6 次卡顿，累计约 8067ms。
- 正常/慢请求测试均执行暂停和 seek，卡顿计数保持 0。

限速值低于最低档素材码率，因此降到 360p 后仍会卡顿，这是预期结果。解除人为延迟可用于同条件展示首帧恢复，但这些数据属于故障对照实验，不能当成已经完成真实 CDN 优化的收益。

## 联网与设备记录

Codex 内置浏览器分别切换 YouTube/Twitch 官方嵌入，收费入口禁用、指标显示 N/A；iframe 持续空白，未观察到可播放画面，所以只确认官方嵌入接线与降级展示，未确认外部播放成功。默认本地 HLS 不依赖这些平台。

权限拒绝自动化通过抛出 NotAllowedError（WebKit 返回平台拒绝文案）验证错误提示、停止按钮禁用及 srcObject 为空；不等于物理设备已验收。
