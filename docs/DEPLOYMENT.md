# 单机公网部署

Linux 服务器运行 Next.js、MediaMTX 和 Caddy。浏览器通过 HTTPS 访问网站及 HLS/WHIP/WHEP；OBS 使用 RTMP 推流。账号、聊天和交易仍为浏览器本地演示数据，不跨设备同步。

生产使用 GitHub Actions 构建，服务器只下载并运行镜像。继续使用现有 Ubuntu x86_64 服务器、`/home/admin/streamlab` 和 Compose 项目名 `streamlab`；不在服务器构建。已有 2 GB 交换内存可保留。

## 日常发布与回滚

1. 将修改提交并推送至 `main`。PR 也运行检查，但不发布镜像、不接触生产 SSH 凭证。
2. 等待 **CI** 通过：冻结锁文件安装、Biome、类型检查、单元测试、部署故障测试、生产镜像构建、SEO 和隔离媒体测试。媒体测试使用临时密码、合成 OBS 视频、假摄像头和四人合流，不访问生产媒体服务。
3. 停止 OBS / 网页推流并关闭连麦。打开 GitHub **Actions → Production → Run workflow**，分支选 `main`，操作选 `deploy`。
4. 查看运行摘要中的提交 SHA、更新服务和健康结果。需回退时重新运行，操作选 `rollback`，恢复上一成功版本。

工作流固定点击时的 SHA，只接收该 SHA 成功 CI 的发布包；不直接在服务器拉取 Git 分支。通过测试的同一个镜像推到 `ghcr.io/woyaofei303/streamlab`，生产按 digest 下载，配置包校验 SHA-256。发布包在 Actions 保留 14 天；过期后重新运行该提交的 CI。

部署开始及切换前各查询一次 MediaMTX 和连麦状态；任何推流、开放的连麦房间或查询失败都会中止。下载、校验完成前不改现网；仅重建发生变化的服务。网站单独更新不重启媒体或代理。首次迁移因固定镜像和配置挂载路径，会重建三个服务。

GitHub 同一时间只运行一个生产任务，服务器另有文件锁；不要取消切换中的任务。新服务启动、健康或 HTTPS 验证失败时自动恢复旧镜像及配置。发布切换期间必须保持停播；单机短暂维护、媒体重连和已结束的连麦无法通过回滚消除。

## 首次接入现有服务器

以下是一次性运维步骤，须先取得提交、推送和新增部署凭证授权。**不要先覆盖服务器现有的 `deploy/compose.yml`**：初始化程序需要它还原当前服务。将本仓库 `deploy/deploy.py`、`deploy/bootstrap.sh` 放入服务器独立临时目录后再初始化。

前提：服务器安装 Python 3、Docker Engine / Compose 插件、OpenSSH 和 sudo，至少有 2 GiB 空闲磁盘。保留现有域名、防火墙和推流密码。TCP 80、443、1935、8189 和 UDP 8189 提供服务，SSH 使用 TCP 22；3000、8554、8888、8889、9996、9997 继续仅监听本机。

1. 在受信任的本地终端生成专用 Ed25519 密钥，私钥不得放进仓库、发布包或聊天记录。CI 密钥不设置交互口令，通过专用账号、强制命令和 GitHub 环境限制使用。

   ```bash
   install -d -m 700 ~/.ssh
   ssh-keygen -t ed25519 -f ~/.ssh/streamlab-deploy -C streamlab-production
   ```

2. 通过已有管理员通道上传**公钥**和上述两个脚本。确认停播且连麦已关闭，再执行（替换为实际临时目录）：

   ```bash
   sudo bash /tmp/streamlab-bootstrap/bootstrap.sh /tmp/streamlab-bootstrap/streamlab-deploy.pub
   ```

   初始化备份旧源代码及配置，给三个正在运行的镜像打本地保留标签，保存 `bootstrap` 版本，复制原有运行时配置。此步骤不重启容器、不清空卷。专用账号只允许 `deploy SHA CHECKSUM` 和 `rollback`，不能交互登录或端口转发；部署程序和 SSH 授权文件由 root 持有。初始化拒绝覆盖已有部署账号和状态，部分失败时应先检查已完成的步骤，不能反复盲跑。

3. 从阿里云可信管理终端读取主机**公钥**和指纹，与本地连接核对。不能只信任网络上一次未经验证的 `ssh-keyscan` 结果。

   ```bash
   sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
   sudo cat /etc/ssh/ssh_host_ed25519_key.pub
   ```

4. 在 GitHub 仓库 **Settings → Environments → production** 创建环境，将允许部署分支限定为 `main`。添加变量 `DEPLOY_HOST=47.80.28.238`，以及两个环境 Secrets：`DEPLOY_SSH_KEY` 保存专用私钥全文；`DEPLOY_KNOWN_HOSTS` 保存经核对的主机公钥行：

   ```text
   47.80.28.238 ssh-ed25519 <服务器主机公钥，不是部署公钥>
   ```

   用严格主机校验测试专用密钥：执行未授权命令应返回 `Only deploy and rollback are allowed`，退出码 1；认证失败或主机指纹错误必须先处理。不要将此凭证配置到 PR 工作流，也不要关闭主机校验。

5. 首次推送后，等 CI 发布镜像，在 GitHub 包 **streamlab → Package settings → Change visibility** 显式设为 **Public**。仓库公开不保证新包自动公开。在服务器使用临时空 Docker 配置执行匿名拉取，将下方 digest 替换为 CI 摘要的值：

   ```bash
   task_docker_config=$(mktemp -d)
   sudo docker --config "$task_docker_config" pull ghcr.io/woyaofei303/streamlab@sha256:<CI摘要中的digest>
   rmdir "$task_docker_config"
   ```

6. 停播时完成 `deploy → rollback → deploy` 演练。首次回滚恢复迁移前保留的本地镜像，旧版没有 `/api/health`，程序使用原媒体状态和连麦接口验活。新版检查本机与公网 `/api/health` 的状态及完整提交 SHA，再检查 SEO、图标、推流鉴权和卷是否保留。生产自动验证不主动开播或结束用户直播。

首次接入完成前，仅提交这些文件不代表自动部署已经可用。密钥轮换、服务器部署入口升级仍需管理员操作，不由每次应用发布覆盖。

## 版本与运行时配置

```text
/home/admin/streamlab/
  releases/<SHA>-<包校验值前12位>/   镜像 digest、Compose、Caddy、MediaMTX
  releases/bootstrap/              首次迁移前的服务配置与本地镜像标签
  shared/runtime.env               DOMAIN、PUBLIC_IP、PUBLISH_PASSWORD（0600）
  shared/config/                   当前 Caddyfile 与 mediamtx.yml，稳定挂载路径
  state.json                       当前、上一版本、最近三个成功版本
  pending.json                     切换中的恢复记录；成功或自动回滚后移除
  backups/<时间>/source.tar.gz       迁移前源码与配置，含秘密，仅管理员可读
  logs/deployments.jsonl            发布结果日志，轮转保留三份
```

网站构建仅注入公开域名和提交 SHA；密码在运行时从服务器加载。`deploy/.env.example` 是字段示例，不能放真实密码；不要打印 `docker compose config` 或容器完整环境到公开日志。修改域名还须同步 `.github/workflows/ci.yml` 的公开构建参数及 `src/lib/seo.ts`，然后重新构建。

保留最近三个成功版本，并始终保留 `bootstrap`；旧应用镜像只尝试按精确引用删除，不运行全局 prune 或 `down -v`。继续使用 `streamlab_recordings`、`streamlab_caddy_data`、`streamlab_caddy_config`，保留录制和证书。源码备份不是卷备份或异地备份；重要录制仍需下载保存。

Caddy 继续自动申请和续期 HTTPS 证书。本配置使用 Linux host 网络；本地开发继续使用 `media/compose.yml` 和 `pnpm dev`，无需生产凭证。

## 发布失败与人工恢复

出现 `DEPLOY_FAILED_ROLLED_BACK` 表示旧版本已恢复且健康检查通过。出现 `ROLLBACK_FAILED` 或遗留 `pending.json`，新发布会被阻止；管理员先查看容器和发布日志，处理磁盘、镜像或网络问题，再执行：

```bash
sudo docker ps --filter name=streamlab-
sudo docker logs --tail=100 streamlab-web-1
sudo docker logs --tail=100 streamlab-media-1
sudo docker logs --tail=100 streamlab-proxy-1
sudo cat /home/admin/streamlab/logs/deployments.jsonl
sudo streamlab-deploy recover
```

`recover` 仅供管理员在中断发布后恢复日志中记录的旧版本；它不依赖已故障的新应用上报空闲状态。先确认业务已停播。正常回滚使用 GitHub `rollback`，或管理员执行 `sudo streamlab-deploy rollback`，均执行直播保护。不要手工删除 `pending.json` 来跳过恢复。

健康接口无人推流仍返回 200；媒体服务不可达返回 503，响应不包含密码或媒体路径：

```bash
curl -fsS https://live.sunshinedairy.net/api/health
```

```json
{"status":"ok","revision":"完整的40位Git提交SHA"}
```

## OBS 设置

- 服务：自定义。
- 服务器：`rtmp://live.sunshinedairy.net:1935`。
- 串流密钥：`live?user=publisher&pass=<PUBLISH_PASSWORD 的值>`。
- 视频：H.264，1280×720，30 FPS，CBR 1500–2500 Kbps，关键帧 2 秒；音频 AAC 128 Kbps。
- 添加摄像头、窗口或媒体文件来源，确认预览有画面后点击「开始推流」。
- 观看：`https://live.sunshinedairy.net/live/mei?source=local`。

网页开播在 `/studio` 选择 MEI 演示身份，输入同一推流密码。跨设备观众使用 `/live/mei?source=browser`；演示身份并不授予推流权限。

RTMP 未加密，推流密码不要复用其他账号密码；如需加密发布，可用网页的 HTTPS WHIP 入口。WebRTC 使用服务器公网 IP 直连，严格限制 UDP/TCP 的网络仍可能需要 TURN 中继。

## 维护

SEO 的正式网址定义在 `src/lib/seo.ts`，换域名时同步更新并重新构建。首页提供服务端正文、canonical、WebSite 结构化数据与分享卡片；`/sitemap.xml` 仅列出首页。搜索筛选、个人空间、工作台、实验室和演示频道使用 `noindex`，但允许爬虫访问以读取该指令；`robots.txt` 只屏蔽 API 与媒体资源。频道接入真实公共资料后再开放收录，避免将示例观众数当作真实内容。

`src/app/favicon.ico`、`icon.svg` 和 `apple-icon.png` 由 Next.js 自动生成图标链接。部署后检查实际 HTTP 响应：

```sh
node scripts/check-seo.mjs https://live.sunshinedairy.net
```

搜索引擎的站点所有权验证和站点地图提交需在对应站长平台完成，本次配置不代表已收录。

```sh
sudo docker logs --tail=50 streamlab-web-1
curl -fsS https://live.sunshinedairy.net/api/media/status
```

无人推流时 `ready: false` 是正常等待状态。OBS 的录制只保留最近 6 小时；重要录制需另行下载保存。容器日志每个服务最多保留约 30 MB。

发布鉴权沿用 [MediaMTX 官方认证机制](https://mediamtx.org/docs/features/authentication)。播放使用公开读权限，推流密码仅授予三个固定媒体路径的发布权限。媒体管理 API 和录制服务限制为本机访问。

## 多人连麦（4 麦位）

MEI 直播间支持房主加 3 位嘉宾；嘉宾可以选择「主播」或「观众」身份，权限相同，均需房主接受。房主权限由服务器验证推流密码，切换演示账号不会获得连麦管理权限。

1. 房主先启动 OBS 或网页开播，再进入工作台「连麦申请」，保留「自动识别正在直播的画面」，输入推流密码，点击「开启麦克风与连麦」。也可以手动选择或在连麦中切换来源，不会移出嘉宾。
2. 其他设备打开 `/live/mei?tab=call`，填写昵称和身份后申请。房主在任意工作台标签都能收到右下角申请卡片。
3. 房主接受后，嘉宾在 45 秒内点击「开启摄像头并加入」。支持多人同时上麦、本人开关麦克风/摄像头、房主静音和移出嘉宾。
4. 普通观众自动观看合成直播。嘉宾通过独立 WebRTC 连接互听，自己的直播播放器会强制静音，避免听到延迟回声。
5. OBS 仍输出主画面及原有音频；工作台麦克风专门用于低延迟对话。请佩戴耳机，并在 OBS 关闭桌面音频或排除本网页声音，避免把嘉宾声音重复推流。其他主播通过浏览器摄像头参与。

技术链路：每人 WHIP 发布 → MediaMTX → 上麦成员分别 WHEP 订阅；FFmpeg 从本机 RTSP 拉取主画面和嘉宾音视频，按服务器同一时钟对齐，输出 1280×720 / 24fps 的 H.264/Opus 合流，观众通过 WebRTC 实时观看。合流目标码率 2.5 Mbps、峰值 3 Mbps；网页摄像头优先要求 1280×720、16:9、24fps；设备不支持时回退到兼容分辨率，权限拒绝不会重试。视频格子等大、等比居中裁剪；房主麦克风独立显示为语音条。OBS 连麦建议关闭 B 帧、关键帧间隔 1 秒。加入、离开、静音会重建合流，可能短暂重连。

同步回归检查使用两路及四路同一时钟的合成画面和声音，不会打开摄像头或修改当前连麦房间（本地媒体服务需已运行）：

```bash
STREAMLAB_CALL_TIMING_TEST=1 pnpm exec vitest run tests/call-timing.test.ts
```

检查结果保存到 `output-tdd/call-main/timing-2.json` 和 `timing-4.json`；这是本机媒体链路测试，不代表公网端到端延迟。

部署镜像已安装 FFmpeg；`deploy/compose.yml` 还会给 Web 服务注入现有 `PUBLISH_PASSWORD`。RTSP 8554、媒体管理和发布代理的上游仍只监听回环地址；不需要新增公网防火墙规则。同步更新 `deploy/Caddyfile`，允许 `/call/*/whep*` 观看与释放订阅，不能开放 `/call/*/whip*`。新媒体路径 `call/<随机 ID>` 仅允许本机代理发布，嘉宾临时凭证只能发布自己的获批麦位。

本地需要 FFmpeg 在 PATH 中；开发模式在 localhost/127.0.0.1 可免房主密码，生产模式缺少密码会拒绝开启连麦。安装 FFmpeg 后重启开发服务即可继承 PATH：

```bash
brew install ffmpeg
pnpm media:up
pnpm dev
```

已有 OBS/测试流发布到 `live` 后，可运行合成媒体集成检查（不会打开摄像头或麦克风）：

```bash
node scripts/check-calls.mjs
```

明确的当前边界：单 Node 进程、单真实直播间、最多 4 人；请求保留 60 秒，获批后 45 秒内加入，断联 30 秒释放。服务器重启会结束连麦和清空队列，需重新开启。预算服务器没有新增 TURN，中继受限网络若不能直连现有 8189 TCP/UDP，仍可能连接失败。多人房间或更高分辨率需要再评估服务器资源；目前未做公网多设备压力测试。
