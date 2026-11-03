# 福麻大乱斗学习模拟器 · v7

福州麻将「大乱斗」规则的可玩实现。含**金（百搭）**、补花、摇骰换牌、抢金、金坎、三金倒、天胡、大单调、包牌，以及**四圈一将**的圈将记账。

两种形态，同一个仓库：

| 形态 | 说明 | 部署方式 |
|---|---|---|
| **单机版** | 一个 HTML 文件，双击即玩，空座位由机器人补 | **GitHub Pages**（纯静态，免费） |
| **联机版** | Node + WebSocket，4 人开房、输 4 位房间码 | **Render**（免费额度，能跑 Node） |

> ⚠️ **GitHub Pages 只能托管静态文件，跑不了 Node 服务端。**
> 想让朋友用手机联机打，必须把服务端放到 Render / Railway / 自己的服务器；GitHub 只用来存代码。

---

## 一、只想自己练：GitHub Pages（推荐先做这个）

仓库里的 `docs/` 就是给 Pages 用的静态站，内容是一个完整的单机版页面。

1. 把本仓库推到 GitHub（见 `DEPLOY_GITHUB.md`）。
2. 仓库页 → **Settings** → 左侧 **Pages**。
3. **Source** 选 `Deploy from a branch`；
   **Branch** 选 `main`，目录选 **`/docs`** → **Save**。
4. 等 1–2 分钟，页面顶部会出现地址：

```
https://<你的用户名>.github.io/<仓库名>/
```

5. 手机打开这个地址就能玩，也可以「添加到主屏幕」当 App 用。

**注意**

- 免费账号需要仓库是 **Public** 才能开 Pages。
- 更新游戏后，把新的单机版 HTML 覆盖 `docs/index.html` 再提交即可。
- 国内访问 `github.io` 速度一般，第一次打开可能要等几秒。

---

## 二、想和朋友联机：GitHub 存代码 + Render 跑服务

`render.yaml` 已经写好，Render 可以直接读。

1. 注册 [Render](https://render.com)，选 **Sign in with GitHub**。
2. 右上 **New** → **Web Service** → 选这个仓库 → **Connect**。
3. 配置一般会自动识别：
   - Runtime：`Node`
   - Build Command：`npm install`
   - Start Command：`npm start`
4. Plan 选 **Free** → **Create Web Service**。
5. 等 2–3 分钟构建完，得到：

```
https://<服务名>.onrender.com
```

手机打开这个地址 → 输入昵称 → 创建房间 → 把 4 位房间码发给朋友。

**免费实例的两个限制（正常现象）**

- 15 分钟没人访问会休眠，下一次打开需要等 **30–60 秒**冷启动。
- 每月 750 小时额度，4 个人偶尔玩完全够用。

---

## 三、本地运行（改代码时用）

```bash
npm install
npm start
# 打开 http://localhost:3000
# 手机与电脑同一 Wi-Fi 时，用启动日志里的局域网地址
```

跑测试：

```bash
npm test          # 19 个测试文件
npm run sim       # 200 局机器人模拟
```

单机版重新打包（需要 Python 3）：

```bash
python3 build-single.py   # 生成 福麻大乱斗学习模拟器-v<N>.html
```

---

## 目录结构

```
.
├── docs/                 # GitHub Pages 静态站（单机版）
│   ├── index.html        #   ← 单机版整页（CSS/JS 全内联）
│   ├── rules.html        #   规则书
│   └── .nojekyll         #   告诉 Pages 不要走 Jekyll
├── public/               # 联机版前端（index.html / game.js / style.css / sw.js）
├── src/
│   ├── game.js           # 房间、流程、计分、包牌、圈将
│   ├── mahjong.js        # 牌型判定（成牌、金雀、金龙、听牌）
│   └── bot.js            # 机器人策略
├── server.js             # Express + WebSocket 服务端
├── test/                 # 19 个测试文件
├── tools/bot-sim.js      # 批量模拟
├── render.yaml           # Render 一键部署配置
├── RULES.md              # 完整规则书（v7）
└── VERSION               # 版本号唯一来源
```

---

## 规则与版本

- 完整规则：[`RULES.md`](RULES.md)，网页版：`docs/rules.html`
- 版本号只改 `VERSION` 一个文件；服务端启动时注入页面标题与大厅徽章，单机版打包时写入文件名。
- 当前版本：**v7**

---

## 说明

仅限朋友之间娱乐、学习规则用，不对外运营，不含任何充值或商业功能。
