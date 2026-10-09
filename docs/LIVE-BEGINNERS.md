# 从零理解视频直播：StreamLab 操作与源码教程

第一次接触直播，先做第 3 节的测试视频实验，再做第 4 节的网页开播。遇到陌生名词回看第 2 节，运行出错查第 8 节，想看实现再读第 7 节。

这篇分成三部分：第 1～2 节讲原理，第 3～6 节带你操作，第 7～9 节读代码、排错和自测。

本项目真实传输音视频，但账号、聊天、礼物、订单和场次是浏览器里的模拟业务。所有操作都在本机完成，不需要云账号或付款。当前配置只供本机学习，不能把地址发给朋友就让对方观看。

## 1. 一次直播到底经历了什么

把直播理解为“不断产生画面和声音，再不断送到观众那里”。一次普通的视频文件播放可以读已经保存好的内容；直播则要一边产生、一边传送、一边播放。

```text
主播摄像头 / 屏幕 + 麦克风
  ① 采集：获得连续画面和声音
  ② 编码：压缩数据，减少需要传输的体积
  ③ 推流：主播把压缩后的媒体发送出去
媒体服务器 MediaMTX
  ④ 接收和分发：接收一路输入，提供观众可读取的输出
观众浏览器
  ⑤ 拉流/接收：取得媒体数据
  ⑥ 缓冲与解码：准备待播放的数据，把压缩数据还原
  ⑦ 渲染与播放：video 显示画面，扬声器输出声音
结束
  ⑧ 停播与清理：停发送、关连接、释放摄像头/麦克风、同步场次状态
```

本项目的 FFmpeg 测试流直接读取已编码的文件，省掉实时采集和重新编码。网页开播由浏览器的 WebRTC 实现处理编码；OBS 开播由 OBS 编码。React 负责按钮、状态和连接生命周期，**不负责逐帧压缩或解码视频**。

还有一条独立的业务流程：

```text
选择主播身份 → 设置标题/权限 → 更新场次 → 聊天/互动 → 结束场次
```

“房间显示直播中”和“服务器正在收到视频”是两回事。网页开播会先确认收到媒体，再更新场次；OBS 场次按钮只更新场次，实际发送必须在 OBS 中启动。

## 2. 先认清角色和术语

### 2.1 电脑上有哪几个参与者

- **主播标签页**：打开 `/studio`，申请设备权限、预览、发送媒体。
- **观众标签页**：打开 `/live/mei`，接收并播放媒体。单纯观看不需要摄像头权限。
- **Next.js 进程**：`pnpm dev` 启动，提供网页、测试文件和媒体状态/回放等工具接口。
- **MediaMTX**：Docker 中的媒体服务，接收推流、提供播放输出，给 `live` 路径写录制。
- **FFmpeg fixture**：可选的测试发送端，把已有视频循环推送给 MediaMTX。`fixture` 在这里就是“固定测试素材发送器”。
- **OBS**：可选的桌面直播软件，用来组织摄像头、屏幕等来源并推流。

Docker 可以先理解为“把媒体服务及其运行环境装在一个容器里”。`media/compose.yml` 决定启动哪些容器、开放哪些端口；`media/mediamtx.yml` 决定媒体服务如何接收、输出和录制。

### 2.2 名词不要混在一起记

- **MediaStream / Track**：浏览器中的实时流对象 / 其中的一条轨道。摄像头一般贡献视频轨道，麦克风贡献音频轨道。
- **H.264、AAC、Opus**：压缩编码方式。本项目 OBS 使用 H.264 视频 + AAC 音频；网页开播优先 H.264，音频由 WebRTC 协商，通常是 Opus。
- **MP4、FLV**：组织音视频数据的封装格式。MP4 常用于文件/回放，当前 RTMP 推流使用 FLV 封装。
- **RTMP**：本项目 OBS/FFmpeg 发送到媒体服务使用的协议。网页 `<video>` 不能直接播放这里的 `rtmp://` 地址。
- **HLS**：通过 HTTP 获取播放清单和媒体分片。`.m3u8` 是清单文本；其中引用的媒体文件才带有音视频。项目包含静态点播 HLS 和不断更新的直播 HLS。
- **WebRTC**：浏览器实时音视频能力。本项目用于网页开播、观看网页直播和双标签连麦。
- **WHIP / WHEP**：本项目接入 MediaMTX WebRTC 的 HTTP 协商入口；WHIP 用来发布，WHEP 用来观看。它们不是 MP4 下载地址。WHEP 的入口形式见 [MediaMTX 文档](https://mediamtx.org/docs/read/webrtc)。
- **信令、SDP、ICE**：信令是建立连接时交换的信息；SDP 描述媒体和连接参数；ICE 帮助找可用的网络连接路径。初学时先把它们理解为“正式传媒体前，双方协商怎么连接”。
- **转封装 / 转码**：前者调整数据组织方式，后者重新编码。本项目 MediaMTX 不会自动把一路 1080p 转成多档清晰度。
- **码率 / 分辨率 / 帧率**：每秒传多少数据 / 一帧有多少像素 / 每秒多少帧。三者相关，但不是同一个数值。

### 2.3 本项目的三条常用路径

```text
A. 测试点播：不需要 Docker，不是当前采集的直播
public/media/master.m3u8 → Next.js :3000 → hls.js / 原生 HLS → video

B. OBS / FFmpeg 直播：通过 live 路径传输，并录制
OBS / FFmpeg → RTMP :1935/live → MediaMTX → HLS :8888/live/index.m3u8 → video

C. 网页直播：通过 browser 路径传输，当前不录制
主播浏览器 → WHIP :8889/browser/whip → MediaMTX
观众浏览器 ← WHEP :8889/browser/whep ← MediaMTX
WHIP/WHEP 用 HTTP 协商；媒体本身走 WebRTC，本地开放 :8189 UDP/TCP。
```

`live`、`browser` 是媒体服务里的流名，不是前端页面地址，也不是用户密码。两条流相互独立：开了网页直播，去查看 `live/index.m3u8` 不能证明网页直播是否正常。

## 3. 第一次实践：不碰摄像头，先跑通完整传输

### 3.1 准备两个终端

终端用于执行命令。下面命令都在项目根目录执行，也就是能看到 `package.json` 的目录；代码块不带命令提示符，可以直接复制。

需要 Node.js 22.13+、pnpm 11 和已启动的 Docker Desktop。先检查工具；若某条提示找不到命令，先安装对应工具。安装说明：[Node.js](https://nodejs.org/en/download)、[pnpm](https://pnpm.io/installation)、[Docker Desktop](https://docs.docker.com/desktop/)。

```sh
node --version
pnpm --version
docker compose version
```

**终端 A：安装依赖并启动网页。** 已安装过依赖时可以直接运行 `pnpm dev`。

```sh
pnpm install
pnpm dev
```

看到就绪提示后，保持终端 A 运行，打开 [项目首页](http://127.0.0.1:3000)。`pnpm dev` 一直占着终端是正常现象；要执行后面的命令，另开终端 B。

所有页面都使用 `http://127.0.0.1:3000`。协议、主机名、端口共同决定 origin（源）；换成 `localhost`、其他端口、其他浏览器或隐私窗口，不会自动共享同一份本地业务数据。若启动时 3000 被占用，先确认是否已有本项目运行，避免照着教程却访问了另一个应用。

**此时能看到测试视频，只证明网页播放器能工作。** 静态素材已经在仓库内，这还没有经过推流服务器。

### 3.2 启动接收端和测试发送端

启动 Docker Desktop，等它显示运行正常。在终端 B 执行：

```sh
pnpm media:fixture
```

这个命令同时启动 MediaMTX 和 FFmpeg 测试发送器，首次可能需要下载容器镜像。它的内容仍是测试视频，但数据确实经历 RTMP 发送、媒体服务器接收、HLS 分发。

打开 [OBS / FFmpeg 观看页](http://127.0.0.1:3000/live/mei?source=local)。无需登录，也无需点击“开始 OBS 场次”。确认下拉框为“OBS / FFmpeg · 真实直播”。

成功要看三件事：

1. 页面从等待变成“已接收真实直播流”，显示 H264 等轨道信息。
2. “已接收”的 MiB 数字持续增加，表示媒体仍在进入服务器。
3. 画面持续运动。播放器默认静音，点音量按钮再听声音。

还可以执行只读检查：

```sh
pnpm media:check
curl 'http://127.0.0.1:3000/api/media/status'
```

状态应该包含 `online: true`、`ready: true`、`source: "rtmpConn"` 和大于零的 `bytesReceived`。`media:check` 检查 API/HLS HTTP 入口，**不验证视频解码，也不适用于单独的网页直播 `browser` 路径**。

### 3.3 停一下，再开一次

保持观众页打开，停止测试发送器：

```sh
pnpm media:fixture:stop
```

预期：稍后显示“等待 RTMP 推流”。状态检测约每 2 秒进行一次，停止后不一定瞬间更新。媒体服务还在运行，等待输入是正常现象。

再次启动：

```sh
pnpm media:fixture
```

预期：生成 HLS 输出后恢复播放。完成后再运行 `pnpm media:fixture:stop`，避免测试素材一直循环并持续录制。

## 4. 第二次实践：直接用网页开播

### 4.1 开始前

保持网页服务运行，启动媒体接收端：

```sh
pnpm media:up
```

它只确保媒体服务启动，不会主动打开摄像头，也不会自动停止之前已经运行的 fixture。第 3 节结束时应已停止 fixture。

打开 [主播页](http://127.0.0.1:3000/studio)，选择 **MEI** 主播演示身份。第一次可把“直播设置”里的权限设为公开，便于排除试看限制。

### 4.2 从预览到发送

1. 进入“设备预览”，点“摄像头”，允许浏览器使用摄像头和麦克风。此时只有本机预览，页面仍显示“未开播”。采集接口会返回带轨道的 `MediaStream`，权限与设备错误可对照 [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。
2. 如需换设备，在下拉框选择后重新点“摄像头”。如需分享屏幕，点“共享屏幕”，在浏览器弹窗选择一个窗口或标签页。本项目同时采集麦克风，**不采集系统声音**。
3. 点击“网页开播”。也可以省略预览步骤，直接点击它来申请默认摄像头和麦克风。
4. 等待“正在连接并确认输入…”变成“网页直播中”。如果失败，先按第 8 节排查，不能仅凭本机预览判断发布成功。
5. 保持主播标签页打开。点击“打开观众观看页”，或另开标签访问 [网页直播观看页](http://127.0.0.1:3000/live/mei?source=browser)。普通 `/live/mei` 入口也会依据业务状态自动选网页直播。
6. 对着摄像头挥手，确认观众端同步出现你的动作。点击观众播放器音量按钮听声音；同一电脑练习可以使用耳机，避免声音被麦克风再次采集。

需要把“自动选择播放来源”和“确认真实输入”分开理解：业务库的 `broadcastId` 帮房间选择网页流；真实画面仍以 MediaMTX 的输入状态为准。

网页开播的状态可以单独查询：

```sh
curl 'http://127.0.0.1:3000/api/media/status?path=browser'
```

成功时应有 `online: true`、`ready: true`、`source: "webRTCSession"`，且 `bytesReceived` 增加。`tracks` 反映实际协商结果，不要硬套 RTMP 的 AAC 音轨名称。

### 4.3 这次点击背后的代码顺序

```text
browser-broadcast.tsx / startBroadcast()
  1. 防重复点击，为这一次发布生成 broadcastId
  2. 查询 browser 输入：媒体服务是否启动，是否已有发布者
  3. 复用预览流；没有预览时调用 getUserMedia
  4. createMediaSession(WHIP 地址, 本机 MediaStream)
     → 添加轨道 → SDP/ICE 协商 → 等待 connected
  5. 查询真实输入：ready + webRTCSession + bytesReceived > 0
  6. act({ type: "start", broadcastId }) 更新模拟场次
     → providers/api → MSW → domain/db → IndexedDB
     → BroadcastChannel 通知其他标签页重新读取业务状态
room.tsx
  7. 选中 browser 来源 → LivePlayer 查询输入 → 挂载 Player
player.tsx
  8. createMediaSession(WHEP 地址)，不传本机流，表示只接收
  9. ontrack 收到远端流 → video.srcObject → 播放画面和声音
```

Next.js 状态 API 返回的是小份 JSON，真实音视频直接在浏览器与 MediaMTX 之间传送。虽然这里用了同一台电脑，主播和观众仍分别建立自己的媒体连接。

### 4.4 正确结束这次直播

在主播页点击“停止网页直播”。也可以点击“结束场次”并确认。预期：设备被释放，网页媒体连接关闭，场次结束，观众页转为等待。

以下操作的作用不同：

- 观众点暂停或关闭观众标签页：只影响这名观众，不停止主播发送。
- 观众点静音：只关闭本机播放声音，不影响其他观众。
- 主播点静音：禁用发送的麦克风轨道；主播预览的 `video` 本来就静音，这是两个不同开关。
- 主播切换“直播设置/推流预览”等页内标签：采集组件只被隐藏，继续直播。
- 主播离开 `/studio`、切换身份、停止屏幕分享：触发网页停播清理。

异常关闭整个浏览器会断开媒体，但不保证异步“结束场次”写入完成。重新打开后以真实媒体状态判断是否有画面，必要时手动结束残留场次。

## 5. 第三次实践：用 OBS 替代网页采集

先在主播页停止网页直播。FFmpeg 与 OBS 都使用 `live` 路径，切换前停止 fixture：

```sh
pnpm media:fixture:stop
pnpm media:up
```

打开 OBS，在“来源”区域添加摄像头或屏幕采集，确认 OBS 预览正常；在音频混音器观察麦克风音量条是否随说话变化。

在 OBS 的直播设置选择自定义服务，按本项目约定填写：

```text
服务器：rtmp://127.0.0.1:1935
串流密钥：live
视频编码：H.264
音频编码：AAC
关键帧间隔：2 秒
```

“服务器 + 串流密钥”组合起来对应 `rtmp://127.0.0.1:1935/live`。关键帧可以先理解为解码器重新建立完整画面的重要起点；“2 秒”是推流配置，**不是承诺观众延迟只有 2 秒**。

1. 在 OBS 中点击“开始推流”，检查 OBS 没有连接错误。
2. 打开 [OBS 观看页](http://127.0.0.1:3000/live/mei?source=local)，等待媒体到达和 HLS 输出，再确认画面与声音。
3. 若想同步演示场次计时、礼物统计等，再到主播页点击“开始 OBS 场次”。只看真实媒体不需要这一步。
4. 结束时在 OBS 点击“停止推流”；如果开启了业务场次，也在主播页点击“结束场次”。只结束场次不会替 OBS 停止发送。

本项目 HLS 使用低延迟模式，但仍有编码、生成分片、下载、缓冲和解码耗时。HLS 与 WebRTC 的播放方式和连接条件不同，可对照 [MediaMTX 浏览器播放说明](https://mediamtx.org/docs/read/web-browsers)，不要把本机预览的即时画面当成观众延迟。

## 6. 回放和连麦分别是什么

### 6.1 回放：把已经保存的内容再播放

`mediamtx.yml` 只为 `live` 开启了录制。OBS 和 FFmpeg 推流都会生成文件，保存在 `media/recordings/live/`。当前 `browser` 网页开播和 `rtc` 实验流不录制。

练习录制时，让 `live` 持续输入一段时间，停止发送后，在主播页重新点击“本场回放”。如果刚停流还没有列表，稍等后重新进入该标签。

```text
MediaMTX 接收 live
  → 写入 /recordings/live（映射到电脑上的 media/recordings/live）
主播点击“本场回放”
  → /api/media/recordings → MediaMTX :9996/list?path=live
选择一个时间段
  → /api/media/recording?start=...&duration=...
  → MediaMTX :9996/get → MP4 响应 → video 播放
```

注意三个当前实现细节：

- 配置的 1 分钟是**磁盘录制段**时长，不是 HLS 分片时长，也不是直播延迟。
- “本场回放”目前列出 `live` 的录制，没有按业务 `sessionId` 精确筛选，因此可能包含先前的测试录制。
- `pnpm media:down` 停止媒体服务并保留磁盘录制。保存播放指标到 localStorage 则是另一件事，里面没有录像。

### 6.2 连麦：双方都发送，也都接收

看直播时通常是主播发、观众收；连麦则双方都发音视频。先用实验室独立练习：

1. 同一浏览器、同一 origin 打开两个 [连麦实验页](http://127.0.0.1:3000/lab#rtc)。
2. 一端点“发起邀请”，另一端点“接听”，分别允许设备权限。
3. 确认双方都能看见远端画面，练习静音和挂断。

这里的 `RtcLab` 用 BroadcastChannel 在本机标签页之间传邀请、SDP 和 ICE；音视频通过真正的 WebRTC 连接传输。它不经过 MediaMTX，因此单做这个实验无需 Docker。

实验室里另一个“MediaMTX · WHIP / WHEP”区域需要 Docker：一个标签点“WHIP 发布”，另一个点“WHEP 订阅”，使用独立的 `rtc` 路径。它不会自动成为 `/live/mei` 的网页直播。

正式房间已改为服务器审批和多人合流：房主在工作台「连麦申请」开启麦克风与连麦，嘉宾在房间提交昵称和身份，房主从右下角卡片接受后，嘉宾点击「开启摄像头并加入」。最多 4 人（含房主），支持多位主播、观众同时参与。FFmpeg 将主直播和嘉宾合成给观众，上麦者使用低延迟独立音频对话；OBS 请排除网页声音以防重复收音。详见 [部署与连麦说明](DEPLOYMENT.md#多人连麦4-麦位)。

## 7. 按操作顺序读代码

### 7.1 每个文件负责哪一步

**准备服务。** [compose.yml](../media/compose.yml) 启动容器，[mediamtx.yml](../media/mediamtx.yml) 定义流名、端口和录制方式。先找到 `live`、`browser`、`rtc`，知道自己正在用哪一条。

**主播操作。** [studio.tsx](../src/components/studio.tsx) 组合页面；设备采集和网页开播放在 [browser-broadcast.tsx](../src/components/browser-broadcast.tsx)。按文件中的顺序读三个动作：

```text
startPreview     取得摄像头或屏幕，显示本机预览
startBroadcast   检查服务 → 取得媒体 → 连接 → 确认收到字节 → 更新场次
stopBroadcast    停设备和连接 → 等开播请求结束 → 同步结束场次
```

连接的具体过程在 [media-session.ts](../src/lib/media-session.ts)：`connect` 协商参数并等待连接，`close` 释放资源。按钮操作和协议细节分别阅读。

**观众观看。** [room.tsx](../src/components/room.tsx) 选择来源；[live-player.tsx](../src/components/live-player.tsx) 查询真实输入并显示状态；[player.tsx](../src/components/player.tsx) 加载媒体、响应播放事件，退出时清理。真实输入状态来自 [status/route.ts](../src/app/api/media/status/route.ts)，与房间业务状态分开。

**扩展功能。** 真实多人连麦看 [call-panel.tsx](../src/components/call-panel.tsx)、[call-server.ts](../src/lib/call-server.ts) 和 [call-mixer.ts](../src/lib/call-mixer.ts)；双标签 P2P 实验仍在 [rtc-lab.tsx](../src/components/rtc-lab.tsx)。回放先看 [recordings/route.ts](../src/app/api/media/recordings/route.ts) 如何列出录像，再看 [recording/route.ts](../src/app/api/media/recording/route.ts) 如何读取一个时间段。

读 React 代码时，用 `state` 找界面状态，用 `ref` 找设备和连接对象，用 effect 的清理函数找退出行为。注释主要解释取消、断线、权限和资源释放；一般语法不用逐行背。

### 7.2 一次 WHIP/WHEP 协商具体交换什么

```text
浏览器                                       MediaMTX
创建 RTCPeerConnection
发布时 addTrack；观看时声明 recvonly
createOffer + setLocalDescription
等待 ICE 候选收集完成
                 -- POST /whip 或 /whep -->
                 请求体：SDP offer 文本
                 <-- SDP answer + Location --
保存 Location（本次服务器会话地址）
setRemoteDescription(answer)
等待 connectionState = connected
                 ==== WebRTC 音视频传输 ====
停止时 close + 停止本机轨道
                 -- DELETE Location ------>
```

“SDP 是连接说明，MediaStream 是媒体轨道对象，Location 是服务端会话地址”，这三个不要互换。`RTCPeerConnection` 的方法和事件可查 [MDN API 参考](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection)。

本实现先收齐 ICE 再 POST，不实现增量 PATCH/ICE restart。`iceServers: []` 配合本机端口工作；这不是公网网络穿透方案。握手成功后也要继续监听断线和轨道结束事件。

### 7.3 为什么有这么多清理和“过期结果”判断

考虑你先点开摄像头，还没允许权限又点停止，随后才在弹窗里允许。如果不检查操作是否已经过期，旧请求就会把已经停止的摄像头重新打开。

- `captureVersionRef`：采集操作的版本号，取消后递增；旧结果回来时发现不匹配，就停止旧轨道。
- `publicationRef`：当前网页发布对象，异步回调只处理属于自己的那次发布。
- `broadcastId`：业务里的网页发布标识；`domain.ts` 用它防止旧发布的结束请求结束新发布。
- `sessionId`：业务场次标识，票和退款等规则使用它；它不等于媒体会话地址。
- `sourceId`：MediaMTX 当前输入的标识；观众用它发现发布者已更换并重建播放器。

关闭时也有不同职责：`track.stop()` 释放本机采集；`peer.close()` 关闭本端连接；HTTP `DELETE` 尽力删除服务端会话；`act({type: "end"})` 同步业务状态。只做其中一项不等于完整停播。

### 7.4 怎样判断“成功”和“流畅”

按证据由浅到深看：

1. 页面加载成功：说明网页服务可用。
2. `online: true`：说明查询到了 MediaMTX。
3. `ready: true`：说明指定流有输入。
4. `bytesReceived` 持续增长：说明媒体仍在到达接收端。
5. `connected`：说明 WebRTC 连接建立；不单独证明画面已解码。
6. 首帧出现、画面持续变化、声音正常：才说明观众这端确实在播放。

播放器的 `startupMs` 从实例初始化计到首帧，不是“主播采集到观众看见”的端到端延迟；`buffer` 表示当前还能播放多少秒；`stalls` 是开始播放后的卡顿次数。WebRTC 的缓冲机制不同，不要仅因为 HLS 风格的 `buffer` 为 0 就判断它卡住。

多清晰度实验使用仓库预生成的点播资源。ABR 是播放器在已有码率档位中自适应选择；只有一路编码的直播不会因为多一个下拉框就出现其他真实档位。

## 8. 出问题时，沿数据流逐层排查

先确认观看来源，再依次检查“采集 → 发送 → 接收 → 播放”。每次只改一处，观察结果；不要同时更换编码、端口和播放器。

- **媒体服务未连接**：先确认 Docker Desktop 正常，再运行 `pnpm media:up`。查看容器是否启动、端口是否被占用。
- **等待 RTMP 推流**：接收端在等 `live` 输入。检查 fixture 或 OBS 是否在发送、串流密钥是否为 `live`。
- **等待网页开播**：正在看 `browser`。去主播页点击“网页开播”；只点预览或“开始 OBS 场次”不会发送网页流。
- **摄像头有预览，观众没画面**：预览只验证采集。先看“网页直播中”，再查 `browser` 状态和观众端来源。
- **拒绝权限 / 找不到设备**：检查浏览器站点权限和系统摄像头/麦克风权限；关闭占用设备的软件，重新选择可用设备。屏幕分享还可能需要系统屏幕录制权限。
- **媒体收到但播放失败**：OBS 路径检查 H.264/AAC、HLS 清单与分片请求；网页路径检查 WHEP 协商和 WebRTC 连接错误。不要拿 OBS 的 AAC 配置去推断网页音轨。
- **没有声音**：先取消观众播放器静音，再检查主播麦克风是否禁用、OBS 音量条是否活动。网页屏幕分享不包含系统声音。
- **画面还是测试素材**：检查下拉框是否选了测试点播，或 `live` 是否仍由 fixture 输入。替换为 OBS 前先停止 fixture。
- **15 秒后出现解锁提示**：这是模拟观看权限限制。练习时选择公开房间，或用有权限的演示身份查看。
- **WHEP/WHIP 返回 404 或路径找不到**：检查媒体配置是否包含 `browser`，旧容器可能没有加载新配置。确认所有推流已停止后，再按 README 的重建步骤处理。
- **本场回放为空**：先确认用的是 `live`，不是网页 `browser`；停止推流后稍等再进入回放页，并检查录制目录。
- **手机/其他电脑打不开**：当前地址 `127.0.0.1` 只代表访问者自己的电脑，服务也只绑定本机；公网部署需要另行配置网络、HTTPS、鉴权和 WebRTC 连通性。

下面命令不会启动新的推流，适合查看现状：

```sh
docker compose -f media/compose.yml ps
docker compose -f media/compose.yml logs --tail=50 media fixture
curl 'http://127.0.0.1:3000/api/media/status'
curl 'http://127.0.0.1:3000/api/media/status?path=browser'
curl 'http://127.0.0.1:8888/live/index.m3u8'
```

最后一条仅适用于正在发送的 `live` 流，拿到的是清单文本。浏览器开发者工具的 Network 可以看 HLS 清单/分片和 WHIP/WHEP HTTP 协商；WebRTC 媒体不会以一串 `.m3u8` 分片请求出现在这里。

浏览器采集要求安全上下文；本机回环地址可用于开发。将来换成其他机器的普通 HTTP 地址，不应假定设备 API 仍可用，参见 [MDN 权限与安全说明](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security)。

## 9. 练习结束与自测

先停止主播发送：网页点“停止网页直播”；OBS 点“停止推流”；测试发送器执行以下第一条命令。确认本机其他标签页没有仍在采集，再停止媒体服务：

```sh
pnpm media:fixture:stop
pnpm media:down
```

最后回到终端 A，用 `Ctrl+C` 停止网页开发服务。录制文件保留在 `media/recordings/`。

能回答下面问题，就已经掌握本项目的主线：

- 为什么主播预览有画面，观众仍可能看不到？因为预览只完成采集，还要发布、接收和播放。
- 为什么场次显示直播中却没有真实视频？因为业务状态和媒体状态分别维护。
- 为什么停止观众播放后摄像头还亮着？观众没有替主播停止采集；检查主播标签页和连麦实验。
- 为什么网页直播不走 `/live/index.m3u8`？它发布到独立的 `browser` 路径，并通过 WHEP 观看。
- 为什么现成测试视频也能演示直播链路？内容是文件，但持续 RTMP 推送、接收和 HLS 分发是真实进行的。
- 为什么 MediaMTX 不自动提供三档清晰度？配置里没有多档转码步骤。

继续深入时读 [完整架构](ARCHITECTURE.md)、[接口契约](API.md) 和 [JD 学习实验](JD-STUDY.md)。本篇命令描述当前实现的操作方法；某次检查是否真的运行成功，要以该次终端和浏览器结果为准。
