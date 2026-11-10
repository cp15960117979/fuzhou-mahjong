# 部署到 GitHub 完整教程

> 目标：把游戏放到 GitHub 上，得到一个**手机能直接打开的网址**。
>
> 两种结果，按需要选：
>
> - **只自己练** → GitHub Pages，5 分钟，纯静态，免费。
> - **和朋友联机** → GitHub 存代码 + Render 跑服务，10 分钟，免费额度。
>
> 两种可以同时做，互不影响。

---

## 0. 先注册 GitHub

打开 https://github.com → `Sign up` → 填用户名、邮箱、密码 → 邮箱收验证码。

用户名会进入网址，建议用英文或数字，例如 `xiaoming`。

---

## 1. 把代码传到 GitHub

解压后你会得到一个 `fuzhou-mahjong-github` 文件夹。下面三种方式**任选一种**。

### 方式 A：命令行（最快，推荐）

需要电脑已装 Git（https://git-scm.com/downloads）。

1. 打开 GitHub，右上角 `+` → `New repository`：

    - Repository name：`fuzhou-mahjong`
    - 选 **Public**（Pages 免费版要求公开）
    - **不要**勾选 "Add a README file"
    - 点 `Create repository`

2. 打开终端（Windows 用 Git Bash 或 PowerShell），进入解压后的文件夹：

```bash
cd 你的路径/fuzhou-mahjong-github
```

3. 依次执行（把 `你的用户名` 换成实际用户名）：

```bash
git init
git add .
git commit -m "福麻大乱斗 v10"
git branch -M main
git remote add origin https://github.com/你的用户名/fuzhou-mahjong.git
git push -u origin main
```

4. 推送时会要求登录：

    - 用户名：你的 GitHub 用户名
    - 密码：**不能填账号密码**，要填 Personal Access Token
    - 生成方式：GitHub → 右上头像 → `Settings` → 最下 `Developer settings` → `Personal access tokens` → `Tokens (classic)` → `Generate new token (classic)` → 勾选 **repo** → 生成后复制那串字符当密码用

> 只勾 `repo` 就够了；token 只显示一次，记得先复制。

### 方式 B：GitHub Desktop（纯图形化）

1. 下载安装 https://desktop.github.com ，用 GitHub 账号登录。
2. 菜单 `File` → `Add local repository` → 选择 `fuzhou-mahjong-github` 文件夹。
3. 提示"不是 Git 仓库"时点 **create a repository** → 点 `Create repository`。
4. 右上角 **Publish repository**：

    - Name：`fuzhou-mahjong`
    - **取消勾选** `Keep this code private`
    - 点 `Publish repository`。

### 方式 C：网页拖拽（不想装任何东西）

1. GitHub 右上 `+` → `New repository` → 名称 `fuzhou-mahjong` → **Public** → `Create repository`。
2. 页面点 `uploading an existing file`。
3. 把 `fuzhou-mahjong-github` 文件夹里的**所有内容**（不是文件夹本身）拖进浏览器。

    - 注意：`docs`、`public`、`src`、`test`、`tools` 这 5 个文件夹要一起拖，GitHub 会自动保留层级。
4. 底部点 `Commit changes`。
5. **补一个隐藏文件**（拖拽常常会漏掉以点开头的文件）：

    - 仓库页 → `Add file` → `Create new file`
    - 文件名输入 `docs/.nojekyll`，内容留空
    - 点 `Commit changes`

> 网页上传单次最多 100 个文件，这个项目约 40 个，一次能传完。

---

## 2. 开 GitHub Pages（单机版，手机直接玩）

1. 进入仓库页 → **Settings**（顶部菜单）。
2. 左侧栏找到 **Pages**。
3. **Source** 选 `Deploy from a branch`。
4. **Branch** 选 `main`，右边的目录选 **`/docs`**。
5. 点 **Save**。
6. 等 1–2 分钟，刷新这个页面，顶部会出现：

```
Your site is live at https://你的用户名.github.io/fuzhou-mahjong/
```

7. 手机浏览器打开这个地址 → 就是完整的单机版，可以「添加到主屏幕」。

**如果 404**

| 现象 | 原因 | 处理 |
|---|---|---|
| 打开是 404 | Pages 还在构建 | 等 2 分钟再刷新 |
| 打开是仓库文件列表 | 目录选成了 `/ (root)` | 回 Settings → Pages 改成 `/docs` |
| 页面空白 | `docs/index.html` 没传上去 | 检查仓库里 docs 目录是否有 index.html |
| 样式全丢 | 传的是 `public/index.html` 而不是 docs 里的 | 用 `docs/index.html` 覆盖 |

---

## 3. 部署 Render（联机版，4 人开房）

> GitHub Pages 不能跑 Node，所以联机版要单独放到 Render。GitHub 只负责存代码，Render 从 GitHub 拉代码运行。

1. 打开 https://render.com → `Get Started` → 选 **GitHub** 登录并授权。
2. 右上 **New** → **Web Service**。
3. 在仓库列表里找到 `fuzhou-mahjong` → **Connect**。
4. 填写（多数会自动带出来）：

| 项目 | 值 |
|---|---|
| Name | `fuzhou-mahjong`（会变成网址前缀） |
| Region | `Singapore`（离国内最近） |
| Branch | `main` |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | `Free` |

5. 点 **Create Web Service**，等 2–3 分钟，日志出现 `联机已启动` 即成功。
6. 顶部会显示网址：

```
https://fuzhou-mahjong-xxxx.onrender.com
```

7. 手机打开 → 输昵称 → 创建房间 → 把 4 位房间码发给朋友。

**或者用 Blueprint（更省事）**

仓库里已有 `render.yaml`：Render 右上 `New` → **Blueprint** → 选仓库 → 直接 `Apply`，参数全部自动填好。

**免费实例的正常现象**

- 15 分钟无人访问会休眠；下次打开要等 **30–60 秒**，页面转圈是正常的。
- 每月 750 小时，朋友间玩完全够。
- 如果打开一直 502，去 Render 面板看日志，多半是还在构建。

---

## 4. 以后更新版本

改完代码后：

1. 把 `VERSION` 里的版本号 +1（现在是 `v10` → 改成 `v11`）。
2. 重新生成单机版：`python3 build-single.py`。
3. 用新生成的 `福麻大乱斗学习模拟器-v7.html` 覆盖 `docs/index.html`。
4. 提交推送：

```bash
git add .
git commit -m "v7"
git push
```

- GitHub Pages 会在 1 分钟左右自动更新（没变就 Ctrl+F5 强制刷新）。
- Render 会自动重新部署，日志里看到新版本号即成功。

---

## 4.5 账号数据的坑（v14 起已经没有了）

v14 把账号密码体系整个删掉了，改成 **昵称即身份**：

- 服务器不存任何账号数据，`data/` 目录不再需要，Render 免费实例的临时磁盘也就不再是问题（重启、迁移、休眠都不会丢东西）。
- 掉线、刷新页面、换手机，只要 **房间码 + 原来的昵称** 重新进来，就回到原座位、原手牌，代打自动停下。
- 想改昵称怎么办：回首页用新昵称重新加入即可（对局已开始时，陌生昵称会被拦住，避免 4 人桌被挤坏）。
- 同一桌里昵称不要重复，否则后来的人会顶掉前一个同名座位。

GitHub Pages 的单机版本来就不涉及账号，可以忽略这一节。

---

## 5. 常见问题

**Q：能不能只用 GitHub，不要 Render，就实现联机？**
不能。GitHub Pages 只发静态文件，没有 Node 进程，也没有 WebSocket 服务端。联机必须有能跑 `server.js` 的地方。

**Q：Render 免费版会不会突然收费？**
Free 实例不需要付费，额度用完是服务暂停，不会自动扣款。介意的话可以不填支付方式。

**Q：朋友打不开 `onrender.com`？**
先让他在电脑上试；如果只是慢，是冷启动。若长期打不开，考虑换 Railway / Fly.io / 自己的服务器，代码不用改，`npm start` 即可。

**Q：GitHub Pages 打开很慢？**
`github.io` 在国内访问不稳定，属于网络原因。单机版可以下载 HTML 直接本地打开，不依赖网络。

**Q：仓库必须公开吗？**
免费账号开 Pages 需要 Public 仓库。只想私有仓库 + Pages 需要 GitHub Pro。Render 对私有仓库也能部署。

---

## 6. 文件清单（确认没漏）

```
fuzhou-mahjong-github/
├── README.md              仓库首页说明
├── DEPLOY_GITHUB.md       本教程
├── VERSION                版本号（v10）
├── package.json           依赖与启动命令
├── package-lock.json
├── render.yaml            Render 配置
├── server.js              联机服务端
├── RULES.md               规则书
├── DALUANDOU_SPEC.md      规则实现规格
├── public/                联机版前端
├── src/                   引擎（game / mahjong / bot）
├── test/                  19 个测试文件
├── tools/bot-sim.js       机器人模拟
└── docs/
    ├── index.html         ← Pages 打开的就是这个（单机版）
    ├── rules.html         规则书网页版
    └── .nojekyll
```
