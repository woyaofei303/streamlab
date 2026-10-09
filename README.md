# StreamLab

观众端 + 轻量主播工作页。Next.js、React、TypeScript、Tailwind CSS；默认中文，可切换英文。无需云账号或支付服务。

> 账号、聊天和礼物等业务数据为本机模拟；多人连麦申请由服务器管理。HLS、OBS/RTMP、WHIP/WHEP 和连麦合流是真实音视频链路。这里没有运营后台，也不是可直接向公众收费的服务。

## 第一次接触视频直播

从 [零基础直播教程](docs/LIVE-BEGINNERS.md) 开始：先理解“采集 → 编码 → 推流 → 接收分发 → 播放 → 停播”，再按步骤跑测试流、网页摄像头直播和 OBS。每段操作都说明要做什么、成功时看到什么，以及失败时先查哪里。

教程还解释预览与开播、业务场次与真实信号、网页流与 OBS 流的区别，并给出回放、连麦、源码阅读顺序。核心源码的中文注释与操作流程对应，建议边操作边读。

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
- `/studio`：选择 MEI 后使用；网页开播、设备预览、OBS 指引、信号检测、聊天管理、连麦申请和录制回放
- `/lab`：播放指标、真实分片故障、业务故障、WebRTC、日志导出和数据重置

## 网页直接开播（不需要 OBS）

启动 Docker Desktop，保持 `pnpm dev` 运行，再启动本地媒体服务：

```sh
pnpm media:up
```

1. 打开 `/studio`，选择 **MEI** 主播身份，在「设备预览」点击「网页开播」，允许摄像头和麦克风。
2. 如需分享屏幕，先点击「共享屏幕」预览，再点击「网页开播」。分享屏幕同时采集麦克风，不采集系统声音。
3. 页面确认 MediaMTX 收到真实音视频字节后，才更新场次并显示「网页直播中」。拒绝权限或连接失败不会提交开播状态。
4. 在同一浏览器的另一个标签页打开 `/live/mei`，自动选择网页直播；也可使用 `/live/mei?source=browser` 固定观看来源。默认静音，点击音量按钮听声音。
5. 切换主播页内的设置、聊天等标签可继续直播。「停止网页直播」、结束场次、离开主播页或切换身份会关闭连接并释放设备。网络连接失败或屏幕分享结束也会停止；可重新开播。

```text
摄像头/屏幕 + 麦克风
  → getUserMedia / getDisplayMedia
  → RTCPeerConnection 编码并发送
  → WHIP 发布到 MediaMTX 的 browser 路径
  → 确认 /api/media/status?path=browser 的 ready 和接收字节
  → 更新模拟场次 broadcastId → 普通直播间自动选择网页直播
  → WHEP 接收 → 共用 Player 的 video、静音、全屏、弹幕和事件指标
```

网页发布使用独立的 `browser` 路径，OBS/FFmpeg 继续使用 `live`，两条链路可同时存在。第二个网页发布者不能抢占当前输入。网页音频为 WebRTC 协商的格式（通常 Opus），观看端使用 WHEP，不假定它与 RTMP/AAC 的 HLS 路径相同。当前 `browser` 路径不录制；「本场回放」仍对应 OBS 的 `live` 录制。

如果媒体容器是在更新配置前创建的，需让新 `browser` 路径生效。没有正在使用的直播时，可以重建媒体容器：

```sh
docker compose -f media/compose.yml up -d --force-recreate media
```

源码入口：`browser-broadcast.tsx`（预览、开播、停播）→ `media-session.ts`（建立媒体连接）→ `domain.ts`（记录场次）→ `room.tsx / live-player.tsx / player.tsx`（选择来源、等待信号、播放）。`studio.tsx` 负责组合主播页面。当前只供本机使用，未接公网鉴权、HTTPS 域名或 TURN。异常关闭浏览器后，媒体会断开，业务场次可能来不及写入结束状态；重新进入时以真实输入为准。

## OBS / FFmpeg 本地直播

这里使用 **RTMP 推流 → MediaMTX 接收 → LL-HLS 分发 → 浏览器播放**。RTMP 和 RTP 是不同协议；本节对应 OBS / FFmpeg 的 RTMP。浏览器不会直接播放 `rtmp://` 地址。

```text
OBS 摄像头/屏幕 或 FFmpeg 文件
  → H.264 视频 + AAC 音频
  → RTMP：127.0.0.1:1935/live
  → Docker 内的 MediaMTX 接收并重新封装（不转码）
  → HTTP：127.0.0.1:8888/live/index.m3u8 + 持续更新的媒体分片
  → hls.js / Safari 原生 HLS → <video> 解码播放

Next.js /api/media/status → MediaMTX :9997 → 输入状态、轨道、累计接收字节
```

Next.js 提供页面和状态查询，媒体数据直接从 MediaMTX 到浏览器。聊天、账号、礼物仍是模拟业务；接收的音视频、网络传输和录制是真实的。首页默认测试点播与真实直播可在播放器上方的「播放来源」切换。

### 先用 FFmpeg 跑通（不需要摄像头）

先启动 Docker Desktop，并保持 `pnpm dev` 运行。另开终端：

```sh
pnpm media:fixture
```

打开 [真实直播观看页](http://127.0.0.1:3000/live/mei?source=local)。这个地址会直接选择真实输入，无需登录或点击「开始场次」。FFmpeg 循环发送仓库的测试视频；内容是测试素材，但完整 RTMP → HLS 传输是真实的。首次启动等待数秒生成分片，再检查：

```sh
pnpm media:check
curl http://127.0.0.1:3000/api/media/status
```

成功时状态包含 `online: true`、`ready: true`、`source: "rtmpConn"`、`tracks: ["H264", "MPEG-4 Audio"]`。页面显示累计接收 MiB 持续增长；实际画面能播放才说明解码链路也成功，HTTP 200 本身不能证明这一点。播放器默认静音，手动取消静音听音频。

保持页面打开，停止推流后应显示「等待 RTMP 推流」，再次启动会自动恢复：

```sh
pnpm media:fixture:stop
```

```sh
pnpm media:fixture
```

### 换成 OBS 摄像头或屏幕

先停止 FFmpeg，避免两个发送端争用同一个 `live` 路径：

```sh
pnpm media:fixture:stop
pnpm media:up
```

OBS「设置 → 直播 → 自定义」：

```text
服务器：rtmp://127.0.0.1:1935
串流密钥：live
视频：H.264，关键帧间隔 2 秒
音频：AAC
```

在 OBS「来源」里添加视频采集设备或屏幕采集，确认 OBS 预览已有画面，再点击「开始推流」。打开上面的真实直播观看页，或选择 MEI 身份后到主播页「推流预览」观看自己的画面。主播页「开始场次」只管理模拟业务状态；OBS 的推流按钮控制实际媒体连接。

已安装系统 FFmpeg 时，也可以直接在宿主机发送文件（先停止 OBS 和容器内的 fixture，用 `Ctrl+C` 停止此命令）：

```sh
ffmpeg -re -stream_loop -1 -i public/media/demo.mp4 \
  -c copy -f flv rtmp://127.0.0.1:1935/live
```

`-re` 按播放速度发送，`-stream_loop -1` 循环文件，`-c copy` 复用已编码的 H.264/AAC，`-f flv` 指定 RTMP 使用的封装。换成其他文件时需保证编码兼容。

### 如何观察接收和排查问题

- 「媒体服务未连接」：Docker / MediaMTX 未启动或状态 API 不可达。运行 `pnpm media:up`。
- 「等待 RTMP 推流」：服务已经运行，`live` 没有输入。检查 OBS 是否点了推流、端口是否为 `1935`、密钥是否为 `live`。
- 「已接收真实直播流」但无画面：查看浏览器 Network 中 `:8888` 的 `.m3u8`、`.mp4` 请求，以及播放器错误；检查 H.264/AAC 和 2 秒关键帧设置。HLS 需要缓冲，不能按零延迟预览理解。
- 画面仍是东京测试素材：确认已经停止 fixture，且页面「播放来源」选择的是「OBS / FFmpeg · 真实直播」。

```sh
docker compose -f media/compose.yml ps
docker compose -f media/compose.yml logs --tail=50 media fixture
curl http://127.0.0.1:9997/v3/paths/list
curl http://127.0.0.1:8888/live/index.m3u8
```

源码阅读顺序：`media/compose.yml`（启动接收端和发送端）→ `media/mediamtx.yml`（协议/路径/录制）→ `src/app/api/media/status/route.ts`（读真实输入）→ `src/components/live-player.tsx`（等待信号和恢复）→ `src/components/player.tsx`（拉取、解码、清理播放器）。房间、主播页、实验室共用真实直播组件，约每 2 秒刷新输入状态。

服务端会将 `live` 录制到 `media/recordings/live/`，停止推流后仍保留。主播页「本场回放」可播放实际录制。fixture 会一直循环并录制，练习结束请停止。直播默认单码率；720p/480p/360p 清晰度选择和 ABR 使用首页的本地 HLS 点播资源。

参考：[MediaMTX FFmpeg 推流文档](https://github.com/bluenviron/mediamtx/blob/v1.21.1/docs/3-publish/17-ffmpeg.md)、[浏览器播放文档](https://mediamtx.org/docs/read/web-browsers)。

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

MEI 房间「连麦」使用真实服务器申请队列，支持房主加 3 位主播/观众同时上麦。房主先在工作台开启连麦，右下角接受申请，嘉宾开启摄像头后加入；FFmpeg 将 OBS 或网页主画面与嘉宾合流给观众。需要本机 FFmpeg，公网还需推流密码；操作和部署说明见 [多人连麦](docs/DEPLOYMENT.md#多人连麦4-麦位)。实验室双标签 P2P 仍独立保留用于学习。

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
pnpm test:deploy
pnpm build
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
node scripts/measure-playback.mjs
```

需要媒体服务的附加检查：

```sh
pnpm media:fixture
STREAMLAB_MEDIA_TEST=1 pnpm exec playwright test tests/e2e/media-performance.spec.ts --project=chromium
STREAMLAB_MEDIA_TEST=1 pnpm exec playwright test tests/e2e/local-live.spec.ts --project=chromium
STREAMLAB_BROWSER_TEST=1 pnpm exec playwright test tests/e2e/browser-broadcast.spec.ts --project=chromium
```

Husky hook：对暂存源码执行 Biome 格式化与 lint，再跑类型检查、逻辑测试和部署故障测试（需要 Python 3）；不自动提交。浏览器报告、截图和 trace 存于 `output-tdd/playwright/streamlab/`（本地忽略）。

生产采用 GitHub Actions → 公开 GHCR → SSH → Docker Compose。CI 验证生产镜像及隔离媒体；停播后在 **Actions → Production** 一键发布或回滚。首次接入、凭证、日志和恢复命令见 [生产部署说明](docs/DEPLOYMENT.md)。本地开发沿用 `pnpm dev`，不用生产密码。

## 怎么读这个项目

先选一个问题，沿着对应的流程读。不用一开始就把全部文件看完。

```text
网页如何开播？
  studio → browser-broadcast → media-session
  进入主播页 → 预览 / 开播 / 停播 → 建立 / 关闭媒体连接

观众如何看到画面？
  room → live-player → player
  选择来源 → 等待输入 → 接收并播放

点击按钮后，业务数据存在哪里？
  providers → api → mocks/browser → domain → db
  发起动作 → 模拟接口 → 校验规则 → 写入 IndexedDB
```

对应文件都在 `src/` 下，完整分类见 [架构文档的源码阅读入口](docs/ARCHITECTURE.md#按职责找到代码)。

**先操作**：[零基础教程](docs/LIVE-BEGINNERS.md) 按“准备、开播、观看、停播”讲步骤、成功标志和排错。

**再看原理与实现**：[架构](docs/ARCHITECTURE.md) 解释模块和数据流；[接口](docs/API.md) 查请求字段；[素材说明](docs/ASSETS.md) 查测试视频来源。

**最后做练习**：[JD 实训](docs/JD-STUDY.md) 给练习任务；[验证记录](docs/VERIFICATION.md) 留存实测结果；[面试演示](docs/INTERVIEW.md) 帮助复述已经理解的流程。

可选 Twitch 目录代理读取 `.env.local` 中的 `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`；只允许固定用途的 `/api/twitch/streams` 请求，凭据不进入浏览器。未配置时返回 503，主流程完全不依赖它。第三方嵌入需联网并受平台限制，不作为离线自动化测试依赖。
