# StreamLab

观众端 + 轻量主播工作页。Next.js、React、TypeScript、Tailwind CSS；默认中文，可切换英文。无需云账号或支付服务。

> 业务数据和账号均为本机模拟。HLS、OBS/RTMP、WHIP/WHEP 和双标签 WebRTC 是真实音视频链路。这里没有运营后台，也不是可直接向公众收费的服务。

## 启动

要求 Node.js 22.13+（本项目验证版本 24.14）、pnpm 11。首次安装需要联网；Docker Desktop 仅用于生成素材和本地推流。仓库已包含生成好的 60 秒测试视频和三档 HLS，可直接播放。

```sh
pnpm install
pnpm dev
```

打开 [StreamLab](http://127.0.0.1:3000)。所有标签页统一使用 `127.0.0.1:3000`，不要和 `localhost:3000` 混用：IndexedDB、身份和 BroadcastChannel 按 origin 隔离。

如当前电脑的默认 pnpm store 不可写，使用项目之外可写的位置：

```sh
pnpm --store-dir ../../work/pnpm-store install
```

登录窗口可选 Alex Chen（观众）、MEI（主播）、房管三个演示身份，也可模拟注册。邮箱验证固定码 `246810`，不会发送邮件；账号找回使用相同演示验证流程。身份保存在标签页 sessionStorage，业务数据保存在共享 IndexedDB。

主要地址：

- `/`：发现、分类、搜索和筛选
- `/live/mei`：直播间、聊天、礼物、会员、连麦
- `/live/river`：预约和会员内容
- `/live/atlas`：单场付费回放，优惠码 `WELCOME20`
- `/channel/mei`：频道内容和日程
- `/library`：关注、收藏、历史、预约、订单、会员、消费和资料
- `/studio`：选择 MEI 后使用；OBS 指引、设备预览、信号检测、聊天管理、连麦申请和录制回放
- `/lab`：播放指标、真实分片故障、业务故障、WebRTC、日志导出和数据重置

## 本地直播

```sh
pnpm media:up
```

OBS「设置 → 直播 → 自定义」：

```text
服务器：rtmp://127.0.0.1:1935
串流密钥：live
视频：H.264，关键帧间隔 2 秒
音频：AAC
```

OBS 开始推流后，房间「播放信息 → OBS 本地真实直播」或主播页「推流预览」可观看。主播页「开始场次」管理模拟业务状态；OBS 的推流按钮管理实际媒体连接，两者各有明确状态。

没有 OBS 时，使用内置 FFmpeg 推流器验证同一 RTMP → MediaMTX → LL-HLS 链路：

```sh
pnpm media:fixture
pnpm media:check
pnpm media:fixture:stop
```

推流器会循环本地素材；停止后保留录制。主播页「本场回放」读取 MediaMTX 录制片段并播放。暂停/断流恢复可直接停止并重新启动推流器。直播默认单码率；真实 720p/480p/360p 清晰度选择和 ABR 使用首页默认的本地 HLS 点播资源。

重新生成测试素材（使用 Docker FFmpeg，不需要安装系统 FFmpeg；Apple Silicon 上该 FFmpeg 镜像通过 amd64 兼容运行，可能需数分钟）：

```sh
pnpm media:generate
```

停止媒体服务（保留 `media/recordings`）：

```sh
pnpm media:down
```

## WebRTC

`/lab#rtc` 的双标签连麦使用真实 `RTCPeerConnection`，同源 BroadcastChannel 只传递邀请和 SDP/ICE 信令。点击邀请/接听才申请摄像头和麦克风，挂断或离开页面释放设备。

房间「连麦」可以申请；主播页「连麦申请」接受后，双方保持该标签打开，再发起邀请。此版只支持本机同浏览器两端，不提供公网信令或多人混流。

MediaMTX 实验：一端点击「WHIP 发布」，另一端点击「WHEP 订阅」。默认路径 `rtc`，视频优先 H.264、音频 Opus。配置同时开放本机 UDP/TCP 8189；Docker Desktop UDP 不可达时可走 TCP。OBS 的 AAC 直播路径不会被假定为 WebRTC 音频兼容；WHIP 实验使用独立路径验证。

## 场景与故障

- normal / slow / error：正常、1.8 秒延迟、请求失败
- disconnect / duplicate / reorder：IM 断线、重复 ACK、乱序重放
- expired：业务接口和 IM 返回登录过期
- timeout：事务先成功、响应延迟；前端 8 秒超时后可以用相同幂等键重试，此场景自动恢复 normal
- 「前进 31 天」：取消续费会员到期；开启模拟自动续费的会员演示续费失败并发送站内通知
- 「重置演示」：只重置 StreamLab 业务库和播放会话记录，不删除本地录制
- 播放故障使用 `/api/media/fault/...` 真实延迟或拒绝 TS 分片，不伪造播放器卡顿数字

所有购买均明确标记模拟，金额为 USD 最小货币单位整数，礼物币独立。第三方官方嵌入不使用本项目的付费门槛；订阅与送礼入口禁用。

## 验证

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
node scripts/measure-playback.mjs
```

需要媒体服务的附加检查：

```sh
pnpm media:fixture
STREAMLAB_MEDIA_TEST=1 pnpm exec playwright test tests/e2e/media-performance.spec.ts --project=chromium
```

Husky hook：对暂存源码执行 Biome 格式化与 lint，再跑类型检查和逻辑测试；不自动提交。浏览器报告、截图和 trace 存于 `output-tdd/playwright/streamlab/`（本地忽略）。

## 学习与面试阅读路线

你熟悉 React/TypeScript 时，建议按以下顺序阅读：

1. [完整结构、技术选型和实现链路](docs/ARCHITECTURE.md)：三个运行环境、数据模型、流程图与当前边界。
2. [岗位 JD 对照与八个实训](docs/JD-STUDY.md)：知识优先级、源码入口、复现命令、跨境/CDN 和原生补学方向。
3. [面试演示与 20 个追问](docs/INTERVIEW.md)：三分钟介绍、十五分钟演示、三个案例及诚实的项目表述。

关键源码已有中文注释，优先阅读 `providers.tsx → domain.ts/db.ts → player.tsx → chat.tsx → rtc-lab.tsx`。注释说明设计原因、生命周期和局限，业务行为保持不变。

## 文档索引

- [架构与真实/模拟边界](docs/ARCHITECTURE.md)
- [接口契约](docs/API.md)
- [验证与性能记录](docs/VERIFICATION.md)
- [15 分钟演示与三个面试案例](docs/INTERVIEW.md)
- [素材来源](docs/ASSETS.md)

可选 Twitch 目录代理读取 `.env.local` 中的 `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`；只允许固定用途的 `/api/twitch/streams` 请求，凭据不进入浏览器。未配置时返回 503，主流程完全不依赖它。第三方嵌入需联网并受平台限制，不作为离线自动化测试依赖。
