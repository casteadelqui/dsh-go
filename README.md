# dsh-go-mode · 围棋模式

给 DeepSeek Harness 加一个**围棋模式**：一张会话里的「围棋」标签页，一副能点的棋盘，
一套完整的围棋规则引擎、五档难度 AI、以及一套会跟着棋局走的围棋教学。

最特别的地方是：**你可以和鲸娘下棋**。你落子之后点「轮到鲸娘了」，
她会在对话里看到棋局、用工具落下自己的一手，并点评你刚才那一步。
她想不清的时候你可以让她「支招」，她会告诉你她打算下哪儿、为什么。

---

**English.** `dsh-go-mode` adds a **Go (Weiqi / Baduk) mode** to DeepSeek Harness.
It ships a playable board tab inside the conversation view, a complete rules engine
(captures, suicide, ko, pass, resign, Chinese area scoring with komi), five AI difficulty
levels, and a Go tutor that annotates every move.

What makes it different: **the agent can play against you.** After each of your moves the
agent reads the position through eleven `go_*` tools, plays its own move on the board, and
comments on yours in one short line — so you are taught while you actually play.
The plugin also registers a **「围棋模式」 (Go mode) agent preset**, so from the mode picker
you can say "开始" and play immediately, with no prompt to copy.

```sh
dsh plugin --profile <your-profile> add dsh-go-mode
```

---

## 功能

- **围棋模式标签页**：装在会话视图切换条上（`conversation.view`），点一下就切进棋盘。
- **说「开始」就开局**：切到围棋模式后，棋盘上盖着一块「开始」遮罩，点它、或者直接跟鲸娘说
  「开始」，棋局就开了。
- **棋盘旁边的实时教练**：右侧最上面那块卡片永远只有两句话——「现在下哪儿」（推荐坐标 +
  一句为什么）和「你刚才那一手怎么样」（好棋 / 稍缓 / 失误 + 一句短评），都只占一行。
- **半透明推荐棋子**：轮到主人时，棋盘上浮出三颗半透明的己方棋子（①②③），第 1 推荐带一圈
  金色虚线环。不想看就在设置里关掉「推荐落点」。
- **能下的棋盘**：19 / 13 / 9 路可选，木纹棋盘，悬停虚影、最后一手标记、手数显示、坐标显示。
- **完整规则**：提子、禁入点（自杀）、打劫、停一手、认输、中国规则数子（含贴目 7.5）。
- **五档难度**：入门 / 初级 / 中级 / 高级 / 大师 —— 从「会送吃」到「会算十几步」。
- **两种对手**：
  - `和鲸娘下`（agent）：她真的在对话里思考、落子、点评。
  - `和本机 AI 下`（ai）：宿主内的 AI 直接应手，不需要对话。
- **教学开关**：关掉就是纯下棋；打开之后每一步都有点评、评级、知识卡。
- **悔棋 / 支招 / 形势判断 / 棋谱**：随手可用。
- **agent 工具**：`go_state`、`go_play`、`go_new_game`、`go_settings`、`go_hint`、
  `go_review`、`go_teach`、`go_undo`、`go_pass`、`go_resign`、`go_wait_user_move`。
  所以你也可以直接用对话下棋：「帮我开一局 19 路的，你让我四子」「复盘一下我第 12 手」。

## 装

```bash
dsh plugin --profile <你的profile> add dsh-go-mode
```

本地开发（改动即时生效）：

```bash
dsh plugin --profile <你的profile> add --save-exact link:/path/to/dsh-go-mode
```

装完刷新页面，会话顶部会多出一个「围棋」标签。

## 「围棋模式」预设

除了标签页，插件还往 DSH 的**模式选择器**里加了一个预设：**围棋模式**。

新建会话（或切换模式）时选它，会话就变成一个只会下棋、只会用最短的话教棋的陪练——
没有一堆代码工具干扰，人设直接是鲸娘：

1. 切到「围棋模式」；
2. 跟她说「**开始**」（或者「来一局」「开局」「下围棋」）；
3. 她会直接开一局、把界面跳到棋盘，然后**一直等你落子**：
   你下一手 → 她立刻应手 → 用一两句话点评你那一手 → 接着等你；
4. 全程不用复制粘贴任何提示词。想让她停就换个模式，想继续就说句话。

这个预设定义在插件自己的 `cordis.patch.yml` 里（一条 `@deepseek-ai/dsh-agent-preset` 行）。
**改完要重启 DSH 桌面端才生效**——预设是启动时合成的。

预设里刻意只留了下棋必需的几件工具（文件读写、终端、提问、网页、待办），
把规划 / 委派 / 目标 / 技能这些重家伙都拿掉了：下棋用不上，越瘦越不容易分心。

## 怎么玩

1. 切到「围棋」标签页。
2. 右边面板选**棋盘路数**、**难度**、**对手**（和鲸娘下 / 和本机 AI 下）、**执黑还是执白**。
3. 想让鲸娘教你，把**教学**开关打开；想看到半透明推荐棋子，把**推荐落点**打开（默认开）。
4. 点棋盘中间的「**开始**」（或者直接跟鲸娘说「开始」）。
5. 点棋盘落子。轮到鲸娘时，点右侧的「轮到鲸娘了」，她的提示词会自动填进输入框，
   按回车就能看到她落子和点评。
6. 不知道下哪的时候看一眼右上角教练给的推荐坐标，或者点「给我支招」。

## 结构

```
lib/engine.js   围棋规则引擎（提子 / 劫 / 禁入点 / 数子 / 影响力场），零依赖
lib/ai.js       五档 AI（启发式 + 轻量蒙特卡洛），零依赖
lib/teach.js    18 张知识卡 + 落子点评 + 手筋识别 + 形势小结
lib/store.js    对局状态仓库（宿主侧单例，UI 与 agent 共享）
lib/index.js    宿主半侧：HTTP 路由 + 11 个 agent 工具
lib/client.js   浏览器半侧：往 conversation.view 注册「围棋」标签
lib/ui.js       棋盘界面（纯 DOM + Canvas，由宿主以 /dsh-go/app.js 提供）
assets/         棋盘木纹（board.jpg）、暗色卡面（frame.jpg）、自检页
tools/          开发用脚本（sync-assets.mjs：把 lib/client.js 同步到 assets/）
```

宿主与界面之间是同一份状态：谁落子都写进 `store.js`，另一方靠事件序号长轮询拿到增量。

## 自带的自检通道

插件在自己的路由下开了三个不需要 DSH 登录态的口子，方便开发与排查：

| 路径 | 用途 |
| --- | --- |
| `/dsh-go/app` | 独立的棋盘页面。不开 DSH 也能直接下棋、试界面。 |
| `/dsh-go/health` | `{ ok, moves, size }`，确认宿主半侧活着。 |
| `/dsh-go/selftest` | 浏览器半侧自检页：用假的 `__ModuleLoader__` / `react` / `ctx.slots` 把 `client.js` 完整跑一遍，断言它会往 `conversation.view` 注册 `id: 'go'`、`label: '围棋'`，并把界面真挂载出来。 |

```bash
# 宿主半侧 + 引擎 + AI + 工具注册，离线跑，不需要 DSH
node tools/../.dsh-tmp/test-go.mjs        # 见仓库外的自检脚本
```

改完 `lib/client.js` 记得跑一次 `node tools/sync-assets.mjs`，
把副本同步到 `assets/client.js`（自检页只能从静态资源路由取文件）。

## 素材

棋盘木纹来自 [`@sabaki/shudan`](https://github.com/SabakiHQ/Shudan)（MIT）的 `css/board.png`，
经中心裁切、放大、轻微模糊与对比度调整后得到 `assets/board.jpg`。
棋子不用图片，由 canvas 的径向渐变直接绘制。详见 `NOTICE`。

## 许可

MIT
