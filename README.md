# 侠盗飞车

俯视视角的飞扑夺车小游戏。你开着随时会散架的车，在子弹时间里爬上车顶、选择方向飞扑，抢到下一辆车继续向前。逆行越久倍率越高，但迎面撞车、飞扑落空、车顶被撞都会结束这一局。

## 运行

游戏使用原生 ES modules，需要通过 HTTP 打开（直接双击 `index.html` 会被浏览器的模块 CORS 限制拦住）。

Windows 下双击 `start.bat` 即可（会起一个本地服务器并打开浏览器）。

手动运行：

```bash
python serve.py 8080
# 然后打开 http://localhost:8080
```

`serve.py` 是一个零依赖的本地静态服务器，显式设置了 `.js` 的 MIME 类型。Windows 上直接用 `python -m http.server` 经常会把 `.js` 当成 `text/plain`，浏览器会拒绝加载 ES module。

也可以使用：

```bash
npx serve .
```

手机真机调试（电脑和手机同一 Wi-Fi）：

```bash
python serve.py 8080 0.0.0.0
```

启动后终端会打印一个 `http://192.168.x.x:8080` 的局域网地址，用手机浏览器打开即可；第一次可能需要允许 Windows 防火墙访问。正式上线仍然建议用静态托管。

## 操作

| 按键 | 作用 |
| --- | --- |
| `←` `→` / `A` `D` | 驾驶时自由横向移动 |
| `↓` / `S` | 爬上车顶，进入子弹时间 |
| `↑` / `←` / `→` | 在车顶上选择方向飞扑（不能向后跳） |
| `P` / `Esc` | 暂停 |
| `M` | 静音 |
| `R` | 结算界面重开 |
| `` ` `` | 打开 / 关闭实时调参面板 |

手机端支持两种操控方式，在标题页或暂停页底部的“操控 按键 / 手势”切换，选择会记在 localStorage：

**按键模式**

- 左侧横向摇杆：驾驶时自由横移；松手自动回中。
- 右侧操作盘：驾驶时 `↓` 上车顶；车顶上 `↑` / `←` / `→` 飞扑；不相关的方向会自动变暗。
- 右上角暂停按钮；暂停后点击画面任意位置继续。

**手势模式**

- 驾驶时在画面上横向拖动转向，拖动幅度决定舵量；
- 向下滑：上车顶；
- 车顶上向上滑 / 向左滑 / 向右滑：对应方向飞扑；
- 驾驶时底部会出现一条横向舵量指示条，方便判断当前打舵；
- 右上角暂停按钮保留。

通用：

- 点击画面开始 / 重开；暂停后点击任意位置继续。
- 横屏优先：横屏保留两侧 2.5D 城市；竖屏使用接近全宽的路面，并在标题页提示“横屏视野更佳”。
- 调试时可以用 `?touch=1` 在桌面强制显示触控层。

## 车型图鉴

标题页和结算页左上角有“车型图鉴”按钮，打开后可以查看全部 11 种车的外形缩略图、速度 / 耐久 / 得分 / 车宽 / 横移数值、出现率和特殊能力。按 `Esc`、点关闭按钮或点击背景关闭；打开期间游戏模拟和音效会暂停。

## 规则

- 开局是双向八车道：右侧四条与玩家同向，左侧四条是迎面车流。
- 难度随时间上升：每秒为“新生成的车”增加一点基础车速（默认 `+0.04` 车道宽/秒）。已经在路上的车和玩家当前驾驶的车保持原速，所以想跟上节奏就得不断抢更新的车。
- 游戏开始 30 秒后收窄为双向六车道，再过 30 秒收窄为双向四车道，之后车道数不再变化。收窄时外侧车辆会平滑并入相邻车道，边界会把玩家轻轻推回路面。
- 每次收窄同步切换场景：晴日街区 → 黄昏街区 → 霓虹夜城。建筑、树木、路面、路灯和环境光都会在约 3 秒内平滑过渡。
- 路边街区按沙盘俯视风格绘制：屋顶是主视面，只保留很矮的墙体，所有体块共用同一套倾斜方向、地面阴影和地坪。地块会随机生成住宅、公寓、写字楼、商铺、超市、体育馆、公园、停车场和工地。
- 车身中心越过中线就进入逆行区，驾驶得分从 ×2 起；连续逆行 3 秒升到 ×3，6 秒升到 ×4（默认，可调），跑车每档额外 +0.5。
- 离开逆行区有 0.8 秒宽限，之后热度开始衰减；宽限内回到逆行区会保留当前热度，不会直接清零。
- 子弹时间：最长 2 秒（实时），世界流速降到 20%；耗尽后时间恢复正常，你仍然站在车顶，必须立刻飞扑。
- 飞扑成功与否由飞行过程中的真实碰撞决定：碰到任意车辆的任意部位就算抢到，车顶吸附后自动接管驾驶。
- 抢到迎面车会触发 180° 甩尾调头，之后你在逆行车道上继续按当前逆行倍率得分。
- 迎面夺车落地后有 0.5 秒碰撞保护（可调），顶部会提示你按 `→` 回右侧；一旦离开逆行车道，保护立即结束。这段窗口是为了避免“刚翻完车就被同车道迎面车秒杀”。
- 每辆车都有耐久倒计时，归零爆炸。最后 2 秒冒烟闪红。
- 同向车道有跟车间距、单车道车辆上限和玩家附近生成缓冲，避免右侧排成长龙；慢车在屏幕外排队时该车道会暂停生成。
- 同向碰撞只会推挤、减速、扣一点耐久，不直接致死（卡车被动除外）；迎面碰撞立即死亡；车顶上撞到任何车都会死。
- 横移手感按车型区分：跑车最灵活，轿车均衡，卡车和巴士更重；最大横移速度、加速度、松开减速在 `config.js` 的“横移操控”一组。
- 被放弃的车会变成“幽灵车”，不再与玩家碰撞，只做演出并淡出。
- 分数：驾驶按车型每秒加分，逆行按连续时间 ×2→×3→×4（跑车每档额外 +0.5）；抢车 `+50`，2 秒内连抢递增 `+50`；轿车夺车后连击窗口 +0.5 秒。
- 车身宽度按车型区分：跑车 `0.60`、超级跑车 `0.64`、轿车 `0.68`、出租车 `0.71`、警车 `0.72`、卡车 `0.76`、面包车 `0.78`、加长车 `0.79`、巴士 `0.80`、救护车 `0.82`、消防车 `0.85`（车道宽为 1），给侧向操作留出余量。
- 救护车、消防车、警车、超级跑车是稀有车，生成权重明显低于常规车型；超级跑车最快最脆，消防车最慢最耐撞。
- 迎面车从车身侧面很近地掠过时触发“擦身而过”，`+40` 分；默认判定间隙为 `0.12` 车道宽，可在调参面板调整。
- 常规车型被动：轿车连击窗口 +0.5 秒；跑车每档逆行倍率额外 +0.5；出租车夺车小费 +40；卡车同向碰撞不扣耐久并把前车顶开；面包车同向碰撞扣耐久 ×0.5；加长车驾驶得分 +25%；巴士子弹时间 +0.5 秒。
- 稀有车型被动：救护车子弹时间 +1 秒；消防车同向碰撞扣耐久 ×0.25 并顶开前车；警车夺车赏金 +80、连击窗口 +0.5 秒；超级跑车逆行倍率额外 +1。数值在 `config.js` 的“车型被动”一组，调参面板实时生效。
- 每局会抽一个悬赏目标：抢车、累计逆行、擦身而过、迎面夺车、车型收藏或同一辆车坚持；完成后立即加成分并刷新下一个目标，目标值和奖励随完成数递增。
- 悬赏目标池、目标成长和奖励曲线在 `src/contracts.js`，可以直接改这个文件调整悬赏内容。
- 一命制，结算画面按 `R` 或点击重开；最高分存在 localStorage。

## 调参

所有玩法数值集中在 [`src/config.js`](src/config.js)。

游戏内按 `` ` `` 打开调参面板，改动实时生效并保存在 localStorage，面板里可以直接复制当前差异 JSON 回填到 `config.js`。

车宽（`widthSedan` 等）在车辆生成时读取，调参改动对新生车辆生效；想立刻全部应用可以点面板里的“重开本局”。

悬赏目标池与奖励曲线不在 `config.js`，而在 [`src/contracts.js`](src/contracts.js)。

URL 参数优先级最高，适合快速试数值：

```text
http://localhost:8080/?bulletTimeScale=0.08&screenShake=0&seed=123
```

常用参数：

| 参数 | 说明 |
| --- | --- |
| `bulletTimeDuration` | 子弹时间时长（秒） |
| `bulletTimeScale` | 子弹时间流速 |
| `diveTime` | 飞扑飞行时间 |
| `diveForwardImpulse` / `diveLateralImpulse` | 飞扑纵向 / 横向冲量 |
| `escapeProtection` | 迎面夺车后的碰撞保护窗口（秒） |
| `sedanSpeed` / `sportsSpeed` / `truckSpeed` / `busSpeed` | 各车型巡航速度（车道宽/秒） |
| `hijackBonus` / `comboWindow` / `comboStep` | 抢车分与连击 |
| `durability*` / `firstCarDurability` | 各车型耐久与首辆车耐久 |
| `trafficBaseInterval` | 每条车道的生成间隔（秒） |
| `speedRampPerSecond` | 每秒为新车增加的车速（车道宽/秒） |
| `speedRampMax` | 车速提升上限；`0` 表示不限制 |
| `laneShrinkAt1` / `laneShrinkAt2` | 首次 8→6 车道 / 二次 6→4 车道的时间（秒） |
| `laneShrinkTime` | 车道收窄的过渡时长（秒） |
| `sceneBlendTime` | 场景主题过渡时长（秒） |
| `aiFollowGap` / `laneCarCap` | AI 跟车间距 / 单车道屏幕内车辆上限 |
| `playerLaneCushion` / `playerLaneSpeedFactor` | 玩家车道生成缓冲 / 同车道新车速度上限 |
| `sedanComboBonus` / `sportsWrongWayBonus` | 轿车连击窗口 / 跑车逆行倍率被动 |
| `truckBumpPenaltyImmune` / `truckBumpShoveExtra` | 卡车碰撞免耐久 / 顶开前车距离 |
| `busBulletTimeBonus` | 巴士子弹时间被动 |
| `taxiTipBonus` / `vanBumpPenaltyFactor` / `limoScoreBonus` | 出租车小费 / 面包车碰撞耐久系数 / 加长车得分加成 |
| `ambulanceBulletTimeBonus` / `fireBumpPenaltyFactor` / `fireBumpShoveExtra` | 救护车子弹时间 / 消防车碰撞耐久系数 / 消防车顶开距离 |
| `policeBountyBonus` / `policeComboBonus` / `superWrongWayBonus` | 警车赏金 / 警车连击窗口 / 超级跑车逆行倍率 |
| `wrongWayMultiplier` / `wrongWayMultiplier2` / `wrongWayMultiplier3` | 逆行一 / 二 / 三档倍率 |
| `wrongWayRampTime1` / `wrongWayRampTime2` | 升到二档 / 三档所需的连续逆行时间 |
| `wrongWayHeatGrace` / `wrongWayHeatDecay` | 离开逆行区的宽限时间 / 热度衰减速度 |
| `nearMissGap` / `nearMissScore` | 擦身而过的最大车身间隙 / 得分 |
| `width*` / `lateralSpeed*` / `lateralAccel*` / `lateralDecel*` | 各车型车宽 / 最大横移 / 横移加速 / 松开减速；`*` 为 Sedan / Sports / Truck / Bus / Taxi / Van / Limo / Ambulance / Firetruck / Police / Supercar |

## 全球排行榜（Cloudflare Pages + D1）

前端仍然是纯静态页面；排行榜由同仓库的 Pages Function `/api/scores` 和 Cloudflare D1 提供。接口不可用时，游戏和本地最高分照常工作，排行榜弹窗会显示“排行榜暂时不可用”。

功能：

- 标题页 / 结算页右侧的“排行榜 / 上榜 ★”按钮；
- 总榜 / 本周（近 7 天）前 10；
- 昵称存在 localStorage，结算时可按设置自动上传；
- 服务端做成绩合理性检查、`runId` 去重、同 IP 限频（默认 8 次/分钟）；
- 只保存昵称、分数、存活时长、抢车数、匿名 `clientId` 和加盐 IP 哈希，不收集账号或邮箱。

接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/scores?period=all\|week&limit=10` | 排行榜 |
| `POST` | `/api/scores` | 提交 `{ name, score, duration, hijacks, clientId, runId }` |

### 部署步骤

> **先确认项目类型**：Cloudflare 控制台里的“只有静态资产的 Worker”（Settings 里变量和绑定全部是灰的）不能绑定 D1。纯静态 Worker 没有可执行入口；排行榜需要 **Pages 项目**（推荐），或者给 Worker 加入口脚本并用 Wrangler 部署。Pages 的绑定入口在 **Settings → Functions → D1 database bindings**，不是在 Worker 的“绑定”页。

1. 把 `functions/`、`schema.sql`、`src/leaderboard.js`、`src/leaderboard-ui.js`、更新后的 `src/main.js`、`styles.css` 一起提交/上传到 Pages 项目。**`functions/` 必须位于项目根目录**；如果项目有构建输出目录（例如 `dist`），Functions 仍然放在仓库根的 `functions/`。
2. Cloudflare 控制台 → **Workers & Pages → D1 → Create database**，例如命名为 `qiangche-leaderboard`。
3. 打开你的 Pages 项目 → **Settings → Functions → D1 database bindings → Add binding**：
   - Variable name 填 `DB`（必须一致）；
   - D1 database 选择刚创建的库；
   - Production 和 Preview（如果使用）都建议配置。
4. 可选但建议：**Settings → Environment variables** 添加 `IP_SALT`，值用随机字符串，用于 IP 哈希。
5. 重新部署一次（Git 推送，或在部署页面点 Retry deployment）。绑定关系需要新部署才会生效。
6. 打开 `https://你的域名/api/scores?limit=5`，看到 JSON 即成功。第一次请求会自动创建表；也可以手动在 D1 控制台执行 `schema.sql`。
7. 进入游戏，死亡后点“上榜 ★”，填昵称提交；之后可在设置里控制是否自动上传。

如果 `/api/scores` 返回 `503 {"error":"d1_not_bound"}`，说明 `DB` 绑定没生效；返回 500 时在 Pages → Functions 日志里看具体错误。若项目有 SPA 的 `_redirects`（例如 `/* /index.html 200`），要确保它不会吞掉 `/api/*`。

直接上传部署时，在项目根目录执行：

```bash
npx wrangler pages deploy .
```

Git 集成的话，直接推送包含 `functions/` 的提交即可。

### 本地联调

`python serve.py` 只提供静态文件，不执行 Pages Functions，所以本地打开时排行榜会提示不可用。可以用 Wrangler 本地跑 Pages + D1：

```bash
npx wrangler pages dev . --d1=DB
```

首次使用会要求登录 Cloudflare；按提示配置 D1 后访问 Wrangler 打印的本地地址。也可以先部署到 Pages，再用真实域名测试。

### 安全与隐私说明

- 成绩由客户端提交，服务端只能做合理性检查、去重和限频；**无法完全防作弊**。如果要认真做竞技榜，需要在服务端用种子和输入回放整局游戏。
- 昵称会做长度和基础字符清理，但没有敏感词过滤；公开运营前建议加一个词表。
- IP 只以加盐 SHA-256 哈希保存用于限频，不保存原始 IP；昵称和成绩会公开展示。
- 需要清理数据时，在 D1 控制台执行 SQL，例如 `DELETE FROM scores WHERE created_at < ...`。

## 文件结构

```text
index.html          入口
styles.css          页面与调参面板样式
src/main.js         启动、布局、主循环
src/config.js       默认数值、URL 参数、localStorage
src/game.js         状态机、难度与车道收窄、车流、飞扑、碰撞、计分
src/contracts.js    悬赏目标池、目标值与奖励成长
src/render.js       车辆、小人、HUD、界面、图鉴缩略图
src/city.js         沙盘街区：地块、建筑类型、停车场、公园与工地
src/codex-ui.js     车型图鉴弹窗、车辆卡片与筛选分组
src/scenes.js       三套场景主题与颜色混合
src/audio.js        WebAudio 合成音效
src/input.js        键盘 / 指针 / 虚拟按键与模拟横移
src/touch.js        手机触控层（摇杆 / 四向键 / 暂停）
src/gesture.js      手机手势操控（拖动转向 / 滑动上车顶与飞扑）
src/leaderboard.js          排行榜 API 客户端
src/leaderboard-ui.js       排行榜按钮、弹窗与提交交互
src/debug.js        实时调参面板
src/math.js         数学与碰撞工具
functions/api/scores.js     Cloudflare Pages Function（排行榜接口）
schema.sql          D1 表结构（可选，接口也会自动建表）
serve.py            零依赖本地静态服务器（显式 MIME）
start.bat           Windows 本地启动脚本
```

## 部署

没有任何构建步骤，也没有外部资源依赖。把整个目录上传到 GitHub Pages、Netlify、Vercel、Cloudflare Pages 或任意静态托管即可。

全球排行榜依赖 Cloudflare Pages Functions + D1；部署到没有 Functions 的纯静态托管时，排行榜会显示不可用，但游戏和本地最高分仍然正常。Cloudflare 的绑定步骤见上文。

如果部署在子路径（例如 `https://example.com/qiangche/`），页面使用相对路径，不需要额外配置。

## 备注

- 推荐使用近两年的 Chrome / Edge / Safari / Firefox。
- 音效由 WebAudio 实时合成，没有音频文件，因此体积很小；浏览器要求第一次点击或按键后才能出声。
- 手机端按 `pointer: coarse` 自动显示触控层；也可以用 `?touch=1` 强制开启。触控层和键盘共用同一套输入状态，桌面键盘操作不受影响。
- 手机横屏/竖屏都支持，横屏保留城市，竖屏优先保证车道和车辆可读；HUD 会切换成紧凑版。
