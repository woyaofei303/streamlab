# 结合岗位 JD 的源码学习与实验指南

你已有 React / TypeScript / Next.js 和交易所项目经验，建议重点补“媒体链路、播放器生命周期、消息恢复、QoE 定位”，不必从基础组件写法重新学起。本文的完成标准是：能指出源码、亲手复现、解释取舍，而不是背技术名词。

阅读入口：[完整架构](ARCHITECTURE.md) → 本篇实验 → [面试表达](INTERVIEW.md)。所有“已实现”以当前源码为准，所有“已验证”以 [VERIFICATION.md](VERIFICATION.md) 为准。

## 1. JD 要求对应什么能力

| JD 要求 | 需要掌握的知识 | 本项目入口 / 证据 | 学习优先级与边界 |
| --- | --- | --- | --- |
| React、TypeScript 丰富经验 | effect 生命周期、ref、闭包、异步竞态、类型与运行时校验 | providers、player、domain、事务测试 | P0；把已有经验迁移到媒体对象，而不是只讲页面状态 |
| 直播间播放 | video 事件、HLS 清单、清晰度、原生/MSE 能力检测 | Player、public/media、HLS E2E | P0；实际集成 hls.js，未自研解码器 |
| 播放器内核与流媒体链路 | 编码/容器/协议、demux/transmux、MSE、ABR、关键帧 | 素材脚本、Player、MediaMTX 配置 | P0；理解库做了什么，当前没有内核改造经历 |
| 起播速度、卡顿率、弱网 | 首帧口径、buffer、重缓冲、掉帧、码率梯度、重试 | Lab、媒体故障路由、measure-playback | P0；有次数/时长，没有完整生产卡顿率分母和看板 |
| 弹幕 / IM | ACK、稳定 ID、seq、补拉、心跳、退避、虚拟列表、媒体时间 | Chat、MSW、mergeMessages、Danmaku | P0；模拟 IM 服务，任意丢包缺口恢复仍待补 |
| 主播互动 | 设备权限、预览、采集轨道、开播状态、房管、连麦 | Studio、RtcLab、domain | P1；开播业务按钮与 OBS 推流分离 |
| 付费业务 | 幂等、订单和权益、过期、退款、整数金额、事务 | Commerce、Library、domain、db | P1；很适合结合交易所资金状态经验，支付为模拟 |
| 运营工具 | 公告、置顶、发言限制、预约、通知、投票 | Studio、Chat、domain | P1；仅主播房间工具，没有全站运营后台 |
| 监控、埋点、异常采集 | session、事件口径、采样、脱敏、上报、告警 | PlaybackMetrics、events、日志导出 | P0；当前仅播放局部日志，不能说建成生产可观测性平台 |
| CDN、缓存、跨境体验 | DNS/TLS/TTFB、缓存命中、回源、CORS、地域分组、容灾 | 本地故障实验 + 下文排查练习 | P1；没有真实跨境 CDN，不能编造线上优化收益 |
| 低延迟 HLS / WebRTC | live edge、部分分片、SDP、ICE、STUN/TURN、编解码协商 | MediaMTX、RtcLab、MediaRtc | P1；本机链路真实，公网与多人 SFU 未实现 |
| FLV | HTTP-FLV 与 RTMP、FLV 容器、转封装、MSE | 仅理论对照，暂无代码 | P2 加分；不把 FFmpeg `-f flv` 推 RTMP 说成完成 Web HTTP-FLV 播放 |
| Flutter / Android / iOS | 播放生命周期、平台权限、原生播放器、桥接事件 | 本项目无 App；见第 7 节 | P2；先形成平台认知，再做一个小型原生播放实验 |
| 与产品、后端、测试协作 | 接口契约、状态表、指标定义、故障复现、验收边界 | API、ARCHITECTURE、VERIFICATION、tests | P0；能说明谁负责判定和如何验收，比列框架更有说服力 |

P0 是优先准备的核心，P1 是讲深与联动，P2 是补充项。只有亲手完成对应练习后，再把它加入自己的面试表述。

## 2. 推荐阅读顺序

第一轮先读这五处，不要从最长 JSX 文件开始逐行背：

1. [types.ts](../src/lib/types.ts)：识别 User / Channel / Order / Membership / ChatMessage，区分频道与场次。
2. [providers.tsx](../src/components/providers.tsx)：找到 MSW 启动门槛、Query 取数和 act。
3. [domain.ts](../src/lib/domain.ts) + [db.ts](../src/lib/db.ts)：跟一次送礼或退款，看验证与提交位置。
4. [player.tsx](../src/components/player.tsx)：先看主 effect、handlers、cleanup，再看控件 JSX。
5. [chat.tsx](../src/components/chat.tsx)：先看 receive、connect、heartbeat、send，再看虚拟列表。

第二轮再读 `room.tsx` 的组合关系、`rtc-lab.tsx` 的信令、`studio.tsx` 的设备采集和 `media/` 配置。第三轮用测试倒推“有哪些行为不能破坏”。

源码中已补中文注释，可定位学习入口：

```sh
rg -n 'JD|幂等|事务|游标|首帧|代次|清单|信令|回调' src scripts media
```

## 3. 先分清媒体术语

| 名词 | 用一个具体例子理解 | 容易说错的地方 |
| --- | --- | --- |
| 编码 Codec | H.264 压缩视频，AAC/Opus 压缩音频 | `.mp4`、HLS 不是视频编码 |
| 容器 Container | MP4、MPEG-TS、FLV 组织音视频与时间戳 | 浏览器支持容器不代表支持其中所有编码 |
| 协议 / 分发方式 | RTMP 推流；HLS 经 HTTP 请求清单和分片；WebRTC 实时传输 | 不能直接把 RTMP URL 赋给普通浏览器 video 播放 |
| 分辨率 / 码率 | 720p 描述像素高度，Mbps 描述每秒数据量 | 720p 不对应一个固定码率，清晰度也不等于下载速度 |
| GOP / 关键帧 | 本素材 24fps、GOP 48，约 2 秒一个关键帧 | 切档、seek、首帧都受随机访问点影响，不能只改 UI 标签 |
| 编码/转码 | FFmpeg 重新生成不同尺寸/码率视频 | CPU 成本通常不同于只换容器 |
| 转封装 Transmux | 把压缩数据组织成适合 MSE 消费的片段 | 不等于 JavaScript 在重做 H.264 编码/解码 |
| MSE / SourceBuffer | JavaScript 把媒体片段追加给浏览器的媒体缓冲区 | appendBuffer 成功不代表第一帧已显示 |
| ABR | 根据下载与缓冲等情况自动选择已有码率档位 | 单码率直播没有三档可切；ABR 也不能制造额外带宽 |
| live edge / 播放延迟 | 可播放直播末端与当前播放位置的距离只是一个近似观察 | buffer 大小、首帧耗时、玻璃到玻璃延迟是三种不同指标 |
| SDP / ICE | SDP 协商媒体参数，ICE 收集和选择可达路径 | SDP 不是音视频数据，WebSocket/BroadcastChannel 只负责这里的信令 |
| STUN / TURN / SFU | 地址发现 / 中继 / 多方媒体转发，承担不同职责 | 同机通话成功不等于复杂 NAT 下可用 |

hls.js 的主要职责与 MSE 关系可核对 [官方 README](https://github.com/video-dev/hls.js/blob/master/README.md)，MSE 的浏览器接口见 [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API)。

协议选型应围绕产品目标讨论：

- 大量观众观看：HLS 便于与 HTTP 分发体系结合；当前本地链路可学习清单、缓存和码率切换。
- 希望减少直播播放位置落后：LL-HLS 需要服务端输出相应能力及播放器配合，不能只设置一个前端开关。
- 连麦：WebRTC 需要协商、网络可达性和设备控制；延迟之外还要考虑丢包、音频连续性与成本。
- HTTP-FLV：浏览器通常需相应库转封装后接 MSE。项目未实现这一来源，可以参考 [bilibili/flv.js 官方实现](https://github.com/bilibili/flv.js) 理解结构，不必为了面试同时引入多个播放库。

## 4. 八个可以落地的学习实验

所有命令在项目根目录执行，先按 [README](../README.md) 安装并启动。统一用 `http://127.0.0.1:3000`，不要把它和 `localhost:3000` 当成同一个业务 origin。重置演示会清本地业务数据，先保存自己需要的实验日志。

### 实验 A：从一次点击追到持久化

**JD 对应：React/TS、业务交互、前后端契约。**

- 登录 Alex，关注 MEI，刷新后查看关注状态；另一个标签选择 MEI 主播。
- DevTools 在 `providers.act`、MSW action handler、`db.mutate`、`domain.execute` 下断点，画出执行顺序。
- 在 Application → IndexedDB 查看 `streamlab-demo/state/main`，确认关注写在 User.follows，身份写在 sessionStorage。
- 比较“业务规则执行完”与“事务 oncomplete”的时机；解释广播为什么放在后者。

自测：为什么换标签身份不同但余额和房间状态共享？为什么 curl `/api/v1/state` 不能直接得到这份业务数据？为什么此架构不能作为生产鉴权？

### 实验 B：亲手读一次 HLS 请求链路

**JD 对应：HLS、播放器内核、流媒体链路。**

- 打开 `/live/mei`，Network 过滤 `m3u8`，找到主清单与子清单，再过滤 `segment_`。
- 查看 `public/media/master.m3u8` 的 RESOLUTION/BANDWIDTH 与 v0/v1/v2；hls.js levels 可能按码率排序，不要假定数组索引等于目录编号。
- 在播放器设置里选 360p/720p，再回自动；观察后续请求和 level_switch 日志。
- 暂停、跳转、切房，再观察实例、请求和事件。自动化只证明所断言的实例计数，完整内存仍要用工具测。

```sh
pnpm exec playwright test tests/e2e/flows.spec.ts --project=chromium -g 'HLS playback'
pnpm exec playwright test tests/e2e/media-performance.spec.ts --project=chromium -g '30 client-side'
```

自测：hls.js 与 video 各负责什么？为什么初始 manifest 失败不能只 startLoad？为什么视频显示 720p 仍可能卡顿？

### 实验 C：用故障对照理解起播与卡顿

**JD 对应：弱网、播放性能、问题定位。**

- `/lab` 正常多码率 HLS，记下首帧、buffer、stalls。
- 切到“慢分片 +1500ms”，再切“约 0.5Mbps 限速”，观察实际 Network 与事件时间线。
- 慢分片主要增加请求等待，限速改变传输耗时，固定 503 则测试错误恢复；它们不是一个故障。
- 正常播放中暂停和 seek，确认不会被误计为卡顿；没有首帧时的加载等待也不计为重缓冲。

```sh
node scripts/measure-playback.mjs
```

脚本使用新上下文、关闭 HTTP 缓存，正常/慢分片各三轮，限速一轮；输出 `output-tdd/playwright/streamlab/playback-measurements.json`。历史数据已保存在 [evidence.json](evidence.json)，不要把它当成本次重新执行的成绩。

必须能解释：限速后降到 360p 仍卡顿，因为本素材最低档实际带宽需求仍可能高于上限。实验控制的是每个分片请求速率，不是共享链路总速率。

结果口径：列出设备、浏览器、构建模式、源、缓存策略、样本数；报告首帧中位数与原始值。三次样本不足以宣称生产 p95 或普遍优化百分比。

### 实验 D：开播、断流与回放是不同状态

**JD 对应：直播链路、主播工具、媒体兼容性。**

```sh
pnpm media:fixture
pnpm media:check
```

主播进入 `/studio`，管理业务场次；观众进入 MEI 房间“播放信息”，选择 OBS 本地真实直播。观察 Studio 输入信号与实际 LL-HLS 画面。

```sh
pnpm media:fixture:stop
```

停止实际推流后，记录输入信号变化、播放器缓冲消耗及重试表现；业务场次不会因此自动等同于结束。重新运行 fixture 恢复输入，必要时手动重载，再结束业务场次并选择实际录制。

```sh
pnpm media:fixture
STREAMLAB_MEDIA_TEST=1 pnpm exec playwright test tests/e2e/media-performance.spec.ts --project=chromium -g 'real local RTMP'
pnpm media:fixture:stop
```

自测：推流成功但浏览器黑屏，下一步查协议、编码、CORS、清单还是 UI？MediaMTX 为什么不会凭空产生三档清晰度？录制 1 分钟分段为何不代表直播延迟 1 分钟？

### 实验 E：消息到底在哪一步可靠

**JD 对应：IM、互动、复杂故障定位。**

- 两标签同 origin，Alex 进入房间，MEI 进入 Studio；发消息后置顶、禁言、解除禁言、原 ID 重试。
- `/lab → 业务故障` 选择 duplicate，确认重复 ACK 不产生重复消息。
- 选择 disconnect，观察退避重连；测试用例在断线期间写入一条消息，再恢复 normal，确认先不可见、随后补拉可见。
- 查看 `after.current` 和 `mergeMessages`，理解 seq 排序与 ID 去重分别解决什么。

```sh
pnpm exec playwright test tests/e2e/flows.spec.ts --project=chromium -g 'two tabs chat'
pnpm exec playwright test tests/e2e/media-performance.spec.ts --project=chromium -g '100 messages'
```

压测为每秒一批 100 条，共 60 批。关注消息保留数、DOM 行数、长任务和操作响应，不只看平均帧率。虚拟列表限制 DOM，窗口上限限制数据；两者都需要。

延伸纸上练习：如果先收到 seq=103，后收到 101/102，此时断线，`after=103` 有什么风险？本项目没有实现连续游标和缺口补齐，应说明未来协议需要按房间序号、确认范围和过期游标设计恢复，而不是声称当前已经解决。

### 实验 F：支付超时不等于支付失败

**JD 对应：付费、礼物、产品状态完整性。**

- 登录并进入商业弹窗后，另一个已登录标签设置 timeout 场景；它会先提交动作、再延迟响应。
- 等待前端超时提示，在同一个弹窗用同一 key 重试，检查最终只产生一笔订单或礼物。不要在设置 timeout 后先做其他 act，否则该故障会被其他动作消耗。
- 会员取消续费后仍有权益；前进 31 天后到期。退款则撤销对应订单权益。
- 充值后送礼，查看 Gift.funding；再充值不能把之前已经消费的充值订单伪装成未消费。

```sh
pnpm test
```

特别读 `persistence.test.ts`：500 初始余额，并发 8 次各送 100，应只有 5 次成功；同 key 重试不再扣余额。这是 IDB 事务的本地证明，不是分布式支付事务。

延伸纸上练习：页面刷新后如何恢复未完成订单？相同 key 但金额不同怎么办？真实支付回调先到、前端响应后到如何刷新权益？这三项当前不应描述为已完整实现。

### 实验 G：WebRTC 把信令与音视频分开看

**JD 对应：连麦、设备权限、WebRTC。**

- 同浏览器打开两个 `/lab#rtc`，一端邀请、另一端接听；观察连接状态及 getStats。
- 在 `send`、`prepare`、`setRemoteDescription` 下断点，按 invite → accept → offer → answer → candidate 串起流程。
- 拒绝设备权限、授权过程中取消、挂断、离开页面，检查采集轨道是否停止。静音只是 track.enabled，stop 才释放该轨道。
- 再启动媒体服务，一标签 WHIP 发布，另一标签 WHEP 订阅，比较 HTTP SDP 与 BroadcastChannel 信令的差异。

```sh
pnpm media:up
STREAMLAB_MEDIA_TEST=1 pnpm exec playwright test tests/e2e/media-performance.spec.ts --project=chromium -g 'real WHIP'
pnpm exec playwright test tests/e2e/flows.spec.ts --project=chromium -g 'real two-tab RTC'
```

自动化使用假摄像头/麦克风，但协商和媒体连接真实；物理设备检查需要单独记录。公网部署还要 STUN/TURN、身份与房间权限；多方直播需要讨论 SFU/混流，此处未实现。

### 实验 H：从框架经验走到工程交付

**JD 对应：协作、跨浏览器、质量保障。**

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test tests/e2e/accessibility-devices.spec.ts
```

- 从测试名反推验收条目，区分“规则成立”“真实浏览器渲染”“真实音视频”三层。
- 用键盘打开/关闭登录弹窗，检查焦点返回触发元素；开减少动态效果，观察弹幕与动画处理。
- 对照 Chrome/Firefox/WebKit 结果；WebKit 不是原生 Safari，改变 viewport 也不是真机验收。
- pre-commit 只处理已暂存文件，然后类型检查和逻辑测试；本项目不自动提交代码。

## 5. QoE 和跨境问题怎么分析

这一节是针对 JD 的后续能力训练，当前项目没有生产 CDN 和远端监控平台。

### 用事件拆时间，不直接猜 CDN

```text
用户进入/点击播放
→ 获取业务播放权限与地址
→ DNS / 连接 / TLS（可能复用）
→ 主清单 / 子清单响应
→ 首个可解码媒体片段下载
→ 转封装 / 缓冲追加 / 解码
→ 第一帧显示
```

项目 startupMs 只覆盖播放器初始化之后；如果业务接口慢，当前指标并不一定包含它。要谈“用户感知起播”，先定义起点，并记录自动播放被拒、用户等待、缓存命中等状态。

卡顿率也要先定义：

```text
发生卡顿的有效播放会话数 / 有效播放会话总数
或
重缓冲时长 /（正常播放时长 + 重缓冲时长）
```

二者回答不同问题，分母通常需要排除主动暂停、未开始播放等区间。当前没有完整采集该分母，所以只能准确报告现有次数/时长。

### 故障现象与下一步证据

| 现象 | 先收集什么 | 可提出的改进假设 |
| --- | --- | --- |
| 首次打开很慢，后续正常 | 冷/热缓存、连接复用、首清单/首分片 timing | 精简首屏依赖、首档码率、缓存或连接策略 |
| 指定国家/运营商异常 | 地域与网络分组、CDN 节点、TTFB、回源信息 | 区域路由、回源或备用分发线路；需真实服务数据验证 |
| 下载很快仍掉帧 | 解码分辨率、dropped frames、主线程长任务、设备信息 | 渲染/弹幕成本、解码压力、清晰度上限 |
| buffer 逐渐降为 0 | 分片吞吐与编码码率、ABR 切换、失败重试 | 降档、调整缓冲目标或码率梯度 |
| 只有浏览器失败 | CORS、HTTPS 混合内容、编码支持、自动播放限制 | 配置与能力检测；不能用增加重试掩盖不可播放编码 |
| 直播位置越落后越稳定 | 播放位置与 live edge、回追策略、缓冲 | 在延迟和稳定性之间设明确产品目标 |

缓存学习：稳定且不可变的点播分片与不断变化的直播清单不应机械使用同一缓存策略；`no-cache` 表示复用前验证，不等于禁止存储；`no-store` 才禁止存储。CDN 行为还取决于平台配置，签名参数是否进入 cache key 会影响命中。[MDN HTTP 缓存](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching)。

若进一步做监控扩展，应设计 sessionId、room/session、sourceKind、播放器/浏览器版本、事件、时间、请求阶段、网络/设备维度；分别处理 `error`、`unhandledrejection` 与媒体错误。上报需采样、脱敏、批量和断网策略，签名 URL、账号标识和消息正文不能随意记入日志。这里只提出学习方向，当前代码没有完成这些上报能力。

## 6. 把交易所经验迁移到这份 JD

| 你已有的经验 | 可以迁移的部分 | 直播中新增的难点 |
| --- | --- | --- |
| 行情 WebSocket | 心跳、重连、排序、去重、状态一致性 | 聊天需要历史和回复，弹幕还要媒体时间；行情快照与消息日志恢复方式不同 |
| 下单/余额交互 | 幂等、防重复、未知结果、订单状态 | 权益生效/到期/退款撤销、礼物与充值来源归属 |
| 高频图表 | ref、批量更新、控制 React 渲染成本 | video 解码、Canvas 弹幕与主线程资源争用 |
| Next.js 前端工程 | 路由、请求、类型、表单、权限 UI | 浏览器媒体 API 与 SSR 环境边界、设备权限 |
| 线上问题排查 | 网络日志、错误上下文、复现、回归 | 清单/分片/解码/缓冲/编解码兼容性这条媒体专属链路 |

面试时用你实际做过的交易所例子引出这些能力，再用 StreamLab 实验展示新增媒体知识；不要把学习项目包装成已经服务大规模真实观众的平台。

## 7. JD 的 Flutter / 原生开发补到什么程度

当前项目只做 Web，不把 App 学习混入本次工程。可以独立完成一个“打开 HLS → 播放/暂停 → 切页释放 → 错误/权限处理”的小实验，再补以下概念：

- Flutter：`VideoPlayerController` 初始化、播放状态、dispose 与页面生命周期；理解插件和原生播放能力的关系。[Flutter 官方视频教程](https://docs.flutter.dev/cookbook/plugins/play-video)。
- Android：Media3/ExoPlayer 的媒体项、播放事件和生命周期，网络/音频焦点等平台约束。[Android Media3 官方文档](https://developer.android.com/media/media3/exoplayer)。
- iOS：AVPlayer、播放器状态、音频会话、前后台与系统播放行为；使用 Apple 官方 API 文档继续学习，不推断浏览器行为就是原生行为。[AVPlayer 入口](https://developer.apple.com/documentation/avfoundation/avplayer)。

准备目标是能比较 Web effect cleanup、Flutter dispose、原生播放器释放各自的职责；没有实际写过时应回答“了解原理，正在做实训”，而不是“熟悉全部跨端播放”。

## 8. 面试前自测清单

- [ ] 不看文档画出业务数据与媒体数据两条链路。
- [ ] 指出 hls.js、MSE、video、MediaMTX、FFmpeg 的不同职责。
- [ ] 解释初始加载、暂停、seek、播放中卡顿的区别。
- [ ] 实际复现一次慢分片与一次限速，并能解释实验条件。
- [ ] 在源码中找到播放器、WebSocket、设备流的清理位置。
- [ ] 解释 ACK、ID、seq、after 及当前缺口恢复的限制。
- [ ] 解释为什么余额扣减和礼物交易必须一起提交。
- [ ] 解释“取消续费”“退款”“到期”的不同权益变化。
- [ ] 画出 WebRTC offer/answer/ICE，说明信令与媒体不同。
- [ ] 提出跨境播放排查步骤，同时明确没有线上跨境优化数据。
- [ ] 用已有交易所案例支撑一项能力，用实训数据支撑另一项能力。
- [ ] 练习三分钟技术介绍和十五分钟演示，接受连续两轮追问。
