# 投资管家 · 个人投资资产管理系统 v4.0

一个自托管的**个人多币种投资资产管理系统**：管理 A 股 / 美股 / 基金 / 理财 / 债券的账户、持仓、交易流水、定投、出入金，按发生日锁定汇率，服务端实时计算成本、盈亏、XIRR / TWR、资产配置、集中度、分红税与资本利得估算，并提供月末快照、基准对比、备份导入导出与多用户管理后台。

> 纯本地 / 私有部署，数据保存在你自己的 SQLite 数据库文件中。**所有税务、再平衡内容仅为辅助估算，不构成投资或税务建议。**

---

## 🖼 界面速览

> 全部截图由「数据管理 → 载入示例数据」生成，可一键复现（汇率 6.6954，总资产 ¥463,480.44）。红涨绿跌。

**核心能力**

| 总览 · 8 张 KPI + 持仓看板 + 类型分布 | 绩效 · XIRR / TWR / 基准 α 与月度对比 |
|---|---|
| ![总览](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@main/screenshots/desktop-dashboard.png) | ![绩效](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@main/screenshots/desktop-performance.png) |

| 配置 · 大类环形图 + 目标比例与再平衡建议 | 风险 · 持仓集中度 + 止盈止损预警 |
|---|---|
| ![配置](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@main/screenshots/desktop-allocation.png) | ![风险](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@main/screenshots/desktop-risk.png) |

**更多页面**

| 交易流水 · 买卖/分红/送股/拆分与锁定汇率 | 持仓 · 按类型筛选与关键词搜索 |
|---|---|
| ![交易流水](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@main/screenshots/desktop-transactions.png) | ![持仓](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@main/screenshots/desktop-holdings.png) |

| 税务 · 分红税分档与资本利得明细 | 收益报表 · 月度/年度已实现与含浮动 |
|---|---|
| ![税务](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@main/screenshots/desktop-tax.png) | ![收益报表](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@main/screenshots/desktop-reports.png) |

| 定投 · 按月计划与幂等批量生成 | 管理后台 · 用户 / 汇率 / SMTP |
|---|---|
| ![定投](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@main/screenshots/desktop-dca.png) | ![管理后台](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@main/screenshots/desktop-admin.png) |

**移动端适配**（≤768px 自动切换：抽屉导航 + 单列堆叠 + 宽表卡片化）

| 抽屉导航（汉堡按钮唤出，含账户视角切换） | 交易流水卡片化（字段与桌面表格一致） |
|---|---|
| ![移动端抽屉导航](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@main/screenshots/mobile-drawer.png) | ![移动端交易流水](https://cdn.jsdelivr.net/gh/hanyuestar/Investment-Management-@main/screenshots/mobile-transactions.png) |

---

## 一、功能清单

| 模块 | 能力 |
|---|---|
| 总览 | 8 张核心 KPI（总资产、累计投入、累计收益、XIRR、已实现/浮动、TWR、基准 α、本年收益）、账户分布、持仓卡片 |
| 持仓 | 股票按现价×数量、非股票按持仓市值；卡片展示持仓成本、现价、汇率、浮动盈亏、分红、止盈止损线 |
| 账户 | 券商 / 银行 / 其他账户，CNY / USD 双币种，账户级市值、已实现、浮动与收益率汇总 |
| 交易流水 | 买入 / 卖出 / 现金分红 / 送股 / 拆分（股票）；申购 / 赎回 / 分红（非股票）；做 T 标记、手续费、备注、锁定汇率 |
| 绩效 | XIRR（资金加权，按天精确年化）、TWR（月末快照链式时间加权）、简单年化、累计收益率、基准 α、月度对比表与 ECharts 曲线 |
| 配置 | 大类资产环形图、境内/境外市场暴露、目标比例滑块、再平衡应调整金额、偏离度（Σ\|当前−目标\|/2）、账户分布 |
| 风险 | 第一大 / 前 5 大持仓集中度、股票类占比、止盈止损监控、预警阈值设置、站内预警 |
| 税务 | A 股分红按除息日距**最早买入日**的持股期限定档（≤1 月 20%、1 月~1 年 10%、>1 年免征）、美股分红 30%、资本利得按市场×年度汇总（恒用移动加权平均口径） |
| 定投 | 基金 / 理财 / 债券按月定投计划，一键批量生成申购流水，**幂等**（同资产同日自动跳过），每日 00:10 自动补投 |
| 出入金 | 账户级本金搬运，**完全不参与盈亏计算**；XIRR 现金流只认出金/入金 |
| 收益报表 | 月度已实现 / 净投入 / 月末总值 / 含浮动收益，年度汇总；无快照月份不做插值 |
| 汇率 | 手动录入优先、自动同步兜底（Frankfurter 主源、open.er-api.com 备源、内置兜底 7.1）；每日 08:00 同步 |
| 数据管理 | 月末快照、基准点位录入、一键导出 / 导入 JSON 备份（导入前自动备份）、一键载入演示数据 |
| 账号体系 | 注册 / 登录、邮箱验证码登录（SMTP）、JWT 鉴权、按用户数据隔离、修改密码 |
| 管理后台 | 用户管理（禁用即时失效 / 重置临时密码）、汇率管理、SMTP 配置（密码 AES-256-GCM 加密、回显打码）、系统概览 |
| 部署 | 单容器 Docker / docker-compose；数据卷挂载；健康检查；每日 03:00 自动备份并清理过期备份 |

---

## 二、技术栈

**前端**（`web/`）：Vue 3（Composition API、`<script setup>`）· Vite 5 · Pinia 2 · Vue Router 4 · Element Plus 2 · ECharts 5 · Axios

**后端**（`server/`）：Node.js ≥ 20 · Express 4 · better-sqlite3（同步 SQLite，WAL 模式）· jsonwebtoken · bcryptjs · nodemailer · node-cron

**基础设施**：Docker / docker-compose（node:22-alpine 多阶段构建）；无外部数据库、无 Redis、无构建时网络依赖之外的服务。

---

## 三、目录结构

```
Investment Management/
├── README.md                  # 本文件
├── Dockerfile                 # 多阶段：构建前端 → 后端运行，静态资源由 Express 托管
├── docker-compose.yml         # 一条命令起服务，挂载 ./data，含健康检查
├── .env.example               # 环境变量模板（端口/JWT/管理员/汇率源/SMTP/时区）
├── .gitignore / .dockerignore
├── data/                      # 运行时数据（SQLite、备份），已 gitignore，仅保留 .gitkeep
│   └── backups/               # 自动备份与导入前备份的 JSON
├── docs/                      # 项目 Wiki 源文件（★ 不提交到代码仓库，只推送到 GitHub Wiki，已 gitignore）
├── screenshots/               # README「界面速览」功能截图（演示数据生成，经调色板量化压缩）
├── design/                    # 设计交付包归档（规格文档、原型、参考引擎与测试，不参与运行）
├── server/                    # 后端
│   ├── package.json
│   ├── scripts/seed-demo.js   # 演示数据种子脚本
│   ├── src/
│   │   ├── server.js / app.js # 启动入口 / Express 装配
│   │   ├── config.js          # 全部环境变量与默认值
│   │   ├── db.js              # SQLite 连接、12 张表建表语句
│   │   ├── state.js           # 原始状态读写（按用户隔离）
│   │   ├── crypto.js          # AES-256-GCM 加解密（SMTP 密码）
│   │   ├── calc.js            # ★ 计算引擎（纯函数，与设计交付包逐字一致，勿改公式）
│   │   ├── middleware/        # JWT 鉴权（每请求回查状态）、错误处理
│   │   ├── routes/            # 13 个路由模块（auth/accounts/assets/events/fx/...）
│   │   └── services/          # portfolio 派生计算、fx 双汇率源、mailer、backup、demoData、scheduler
│   └── test/                  # calc 16 场景 49 断言 + API 39 用例
└── web/                       # 前端
    ├── vite.config.js         # dev 5173 代理 /api → 8080；build 产物 dist/
    └── src/
        ├── main.js / App.vue
        ├── router/            # 17 个路由（含仅管理员可进的 /admin）
        ├── stores/            # Pinia：auth、portfolio（state + compute 单一数据源）
        ├── api/               # Axios 实例与各资源 API 封装
        ├── layout/            # 顶栏 + KPI 主布局
        ├── components/        # KPI 卡片、EChart 封装、资产卡片、8 类业务弹窗
        └── views/             # 17 个页面
```

---

## 四、快速开始（本地开发）

需要 Node.js ≥ 20（推荐 22）与 npm。

```bash
# 1) 后端
cd server
npm install
npm run seed:demo          # 可选：写入演示数据（3 账户 / 5 标的 / 13 流水 / 8 期快照基准）
npm start                  # 默认 http://localhost:8080
#    开发热更：npm run dev

# 2) 前端（另开一个终端）
cd web
npm install
npm run dev                # http://localhost:5173 ，/api 自动代理到 8080
```

生产形态下无需单独跑前端：`npm run build` 产物 `web/dist` 会被后端 Express 直接托管，访问 `http://localhost:8080` 即可。

### 默认账号（仅开发 / 演示）

| 用户名 | 密码 | 角色 | 说明 |
|---|---|---|---|
| `admin` | `admin12345` | 管理员 | 数据库中无管理员时首启自动创建，**生产环境务必修改** |
| `demo` | `demo1234` | 普通用户 | 执行 `seed:demo` 或页面“载入示例数据”后存在 |

详细步骤见 [`01 快速开始`](https://github.com/hanyuestar/Investment-Management-/wiki/01-快速开始)。

---

## 五、Docker 部署

**方式一：使用预构建镜像（推荐，无需本地构建）**

```bash
cp .env.example .env        # 修改 JWT_SECRET、CONFIG_SECRET、ADMIN_PASSWORD
docker compose pull         # 拉取 ghcr.io/hanyuestar/investment-management:latest
docker compose up -d
docker compose ps           # healthcheck 变为 healthy 后访问 http://localhost:8080
```

| 注册表 | 镜像 |
|---|---|
| GitHub Container Registry | `ghcr.io/hanyuestar/investment-management` |
| Docker Hub | `kyson666/investment-management` |

- 支持 **linux/amd64** 与 **linux/arm64**（x86 服务器与群晖 ARM 机型均可直接运行）；
- 版本 tag 形如 `v1.0.0`，`latest` 始终指向最新发布版；可用 `:v1.0.0` 锁定版本；
- 切换到 Docker Hub 源：`IMAGE=kyson666/investment-management:latest docker compose up -d`。

**方式二：本地构建**

```bash
cp .env.example .env
docker compose up -d --build
```

**通用说明**

- 数据库与备份持久化在宿主机 `./data`；
- 容器内时区默认 `Asia/Shanghai`；
- 定时任务（汇率 / 定投 / 备份 / 预警 / 月末快照）在容器内运行；
- 升级时 `docker compose pull && docker compose up -d`（或重新 `build`）即可，SQLite 表使用 `CREATE TABLE IF NOT EXISTS`，数据不丢。

详见 [`02 Docker 部署`](https://github.com/hanyuestar/Investment-Management-/wiki/02-Docker部署)。

---

## 六、文档索引（Wiki）

| 文档 | 内容 |
|---|---|
| [01 快速开始](https://github.com/hanyuestar/Investment-Management-/wiki/01-快速开始) | 环境要求、本地开发、演示数据、默认账号、首启做什么 |
| [02 Docker 部署](https://github.com/hanyuestar/Investment-Management-/wiki/02-Docker部署) | 镜像构建、compose 配置、环境变量、数据卷与升级 |
| [03 API 手册](https://github.com/hanyuestar/Investment-Management-/wiki/03-API手册) | 鉴权方式与全部 REST 端点、请求/响应字段说明 |
| [04 计算口径与公式](https://github.com/hanyuestar/Investment-Management-/wiki/04-计算口径与公式) | 成本、双币种、XIRR/TWR、分红税、资本利得、配置/集中度口径 |
| [05 前端页面说明](https://github.com/hanyuestar/Investment-Management-/wiki/05-前端页面说明) | 17 个页面的用途、操作与数据来源 |
| [06 管理后台与鉴权](https://github.com/hanyuestar/Investment-Management-/wiki/06-管理后台与鉴权) | JWT 机制、角色权限、用户管理、SMTP 与验证码 |
| [07 备份与导入导出](https://github.com/hanyuestar/Investment-Management-/wiki/07-备份与导入导出) | JSON 备份格式、自动备份策略、迁移与恢复 |
| [08 FAQ](https://github.com/hanyuestar/Investment-Management-/wiki/08-FAQ) | 常见问题与排查 |
| [09 开发与测试](https://github.com/hanyuestar/Investment-Management-/wiki/09-开发与测试) | 代码约定、测试如何运行、演示数据验收数字 |
| [10 交叉验证报告](https://github.com/hanyuestar/Investment-Management-/wiki/10-交叉验证报告) | 本版本的测试范围、结果、已知限制与修复清单 |
| [11 交叉验证与移动端适配报告](https://github.com/hanyuestar/Investment-Management-/wiki/11-交叉验证与移动端适配报告) | 独立复核发现的 8 项缺陷与修复、文档契约不一致、移动端响应式方案与真机验证证据 |
| [交叉验证上下文包](https://github.com/hanyuestar/Investment-Management-/wiki/HANDOFF-交叉验证上下文包) | 交给其他模型 / 审阅者复核用的完整上下文 |

---

## 七、测试

```bash
cd server
npm test                   # = calc.test.js（16 场景 49 断言）+ node --test test/api.test.js（39 用例）
```

当前结果：**calc 49/49 通过，API 39/39 通过**。前端无单元测试，验收方式为 `npm run build` 通过 + 浏览器逐页走查（记录见 [10 交叉验证报告](https://github.com/hanyuestar/Investment-Management-/wiki/10-交叉验证报告)）。

**移动端适配**：全站已做响应式（≤768px 单列堆叠 + 抽屉导航 + 触控友好尺寸，PC 布局与功能逻辑不变）。真机复核以 Chromium + CDP 完成 **4 视口 × 15 路由 = 60 组合**自动化：横向溢出 0、JS 报错 0、控制台 error 0。详见 [11 交叉验证与移动端适配报告](https://github.com/hanyuestar/Investment-Management-/wiki/11-交叉验证与移动端适配报告)。

演示数据的关键验收数字（汇率 6.6954）：

- 总资产 **¥463,480.44**；贵州茅台 **220 股**；第一大持仓集中度 **63.13%**
- 茅台 2026-06-30 分红 ¥300，持股 140 天落在 10% 档 → 分红税 **¥30**
- XIRR 校验场景：365 天前投 1000、当前 1100 → 年化 **10.00%**

---

## 八、推送（代码仓库 + Wiki）

**⚠️ 文档归属约定**：`docs/` 是 **Wiki 源文件，不提交到代码仓库**（已加入 `.gitignore`）。代码仓库只放源码、测试、`design/` 设计归档、Docker 文件与 README。

本仓库已配好 `.gitignore`（忽略 `docs/`、`node_modules/`、`web/dist/`、`data/*.db*`、`data/backups/`、`.env`、`*.log`、测试备份等）。在项目根目录执行：

```bash
# 注意：文件夹名 "Investment Management‌" 末尾含一个不可见字符（U+200C），
# 所有命令请用引号包裹路径，或直接在该文件夹内打开终端。

# ---- 代码仓库 ----
git add -A
git status                 # ★ 提交前务必检查：不得出现 node_modules、*.db、.env、web/dist、docs/
git commit -m "feat: 个人投资资产管理系统 v4.0（前后端 + Docker + 响应式适配）"

git remote add origin https://github.com/hanyuestar/Investment-Management-.git
git branch -M main
git push -u origin main

# ---- Wiki（文档单独推送，默认分支 master）----
git clone https://github.com/hanyuestar/Investment-Management-.wiki.git /tmp/imwiki
cp docs/*.md /tmp/imwiki/
cd /tmp/imwiki && git add -A && git commit -m "docs: 同步项目文档" && git push origin master
```

提交到代码仓库的内容应只有：源码、测试、`design/` 设计归档、Docker 文件、`.env.example`、`.gitignore`、`data/.gitkeep` 等占位文件。**`docs/`、`.env`、SQLite 数据库、备份 JSON、日志、依赖与构建产物永远不会被提交。**

> 提示：`docs/` 已在 `.gitignore` 中，若它在历史提交里已被跟踪，需执行一次 `git rm -r --cached docs/`。

---

## 九、已知限制

1. 本机开发环境无 Docker，Dockerfile / compose 未在本机实跑，仅做了等价的原生 Node 运行验证（详见 [10 交叉验证报告](https://github.com/hanyuestar/Investment-Management-/wiki/10-交叉验证报告)）。
2. 前端无单元测试，靠构建 + 浏览器走查验收；响应式部分已补 CDP 真机自动化（4 视口 × 15 路由），仍**未在 iOS Safari / Android Chrome 真机实测**，触摸手势与软键盘行为未覆盖（详见 [11 报告](https://github.com/hanyuestar/Investment-Management-/wiki/11-交叉验证与移动端适配报告) §八）。
3. 行情价格不做自动抓取：股票现价、非股票持仓市值需手工维护（数据页/持仓卡片编辑）。
4. 税务模块为辅助估算，不覆盖所有减免情形，不构成申报依据。**注意：资本利得按移动加权平均口径计算，不随「成本核算方法」的 FIFO 设置变化**，详见 [11 报告](https://github.com/hanyuestar/Investment-Management-/wiki/11-交叉验证与移动端适配报告) §三 B8。
5. 单节点、单 SQLite 文件设计，面向个人单实例使用，不做高可用。

---

## 十、许可

私有项目，默认保留所有权利。如需开源，请自行补充 LICENSE 文件。
