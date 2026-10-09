# 投资管家 · 重构设计方案（第二轮）

> 来源：外部代码核查报告 §3–§6 + 我方复核。
> 原则：**先设计、后开发**；每项标注「收益 / 风险 / 影响面 / 验证方式」，按风险从低到高排序。
> 日期：2026-10-09 ｜ 设计基线：`90c417b`（Phase 1 已清理）

---

## 0. 已完成（Phase 1，`90c417b`）

| # | 项 | 处理 |
|---|---|---|
| 1 | `portfolio.js` 恒等包装 `pct()` | 已删除，3 处调用（5 个位置）就地展开 |
| 2 | `/api/admin/fx` GET/PUT 别名路由 | 已删除（核实前端/测试无调用方），无用 import 一并移除 |
| 3 | 部署配置未透传 | `docker-compose.yml` / `.env.example` 已补 `CRON_ENABLED`、`BACKUP_KEEP_DAYS` |

---

## 1. 设计总览：分级与建议

| 级 | 项 | 收益 | 风险 | 建议 |
|---|---|---|---|---|
| **A** | A1 汇率取值统一收敛到 service | 中 | 低 | ✅ 本轮做 |
| **A** | A2 前端不再自行排序汇率 | 低 | 极低 | ✅ 本轮做 |
| **A** | A3 修复代码格式与注释错位 | 低 | 极低 | ✅ 本轮做 |
| **B** | B1 抽 `useRemoveConfirm` 组合式函数 | 中 | 低（9 处视图） | ✅ 本轮做 |
| **B** | B2 抽 `buildBackupPayload()` | 中 | 低 | ✅ 本轮做 |
| **B** | B3 `OpsDialogs` 按需加载 | 中（首屏） | 低 | ✅ 本轮做 |
| **C** | C1 admin 路由守卫校验角色 | 中（体验） | 中（需处理 `fetchMe` 时序） | ⏸ 待讨论 |
| **C** | C2 死代码收窄（前后端未用导出/方法） | 低 | 中（易误删测试依赖） | ⏸ 待讨论 |
| **C** | C3 `compute.js` 8 个单用途接口去留 | ？ | 中 | ⏸ **需产品决策** |
| **C** | C4 引入 ESLint/Prettier | 中（长期） | 低但改动面大 | ⏸ 待讨论 |

> 说明：C 级未纳入本轮，理由见 §4。

---

## 2. A 级设计（本轮实施）

### A1 · 「当前生效汇率」四处实现统一收敛

**现状（4 处，口径相同但代码重复）**

| 位置 | 实现方式 | 缺陷 |
|---|---|---|
| `calc.js:40-45` | 内存数组过滤 + 排序 | 引擎侧重复实现 |
| `services/fx.js:76-83` `currentFx()` | SQL（只取 rate） | **权威实现** |
| `routes/fx.js:22-34` `/current` | 又写一遍类似 SQL（多取 date/source/note） | 未复用 service |
| `views/FxView.vue:79-84` | 前端再排序 `find` 一遍 | 未调接口，可能与后端不一致 |

**设计**
1. `services/fx.js` 新增 `currentFxRow(atDate)` → 返回 `{ rate, date, source }`（含元信息）
   - `currentFx(atDate)` 保持签名不变，内部改为 `currentFxRow()` 取值 → **向后兼容**
2. `routes/fx.js` 的 `/current` 改为调用 `fxService.currentFxRow()`，删除自写 SQL
3. `calc.js` 保留内存实现（引擎必须**不依赖 DB**，否则纯函数性被破坏）——**这是刻意的**，
   在注释中写明「与 services/fx.js 的 currentFx 同口径，引擎侧不可依赖 DB」。
   > ⚠️ 重要：不把 calc.js 合并进去，否则引擎被迫引入数据库依赖，破坏可测性。
4. `views/FxView.vue` 改为优先调 `fxApi.current()`，失败时回退本地排序（离线容忍）

**验证**：`GET /api/fx/current` 返回值与改造前逐字节一致（date/rate/source）；SQL 口径
（`date <= 今天`，同日 manual 优先）保持；API 测试全绿。

---

### A2 · 前端汇率排序与后端一致

合并进 A1 第 4 条。

---

### A3 · 代码格式与注释错位

| 位置 | 问题 | 处理 |
|---|---|---|
| `calc.js:266` | `const assetTotal` 缩进多 2 空格 | 修正缩进（纯空白改动） |
| `scheduler.js:112` | 注释「判断今天是否本月最后一天」悬空，实际属于 `isLastDayOfMonth` | 移到函数上方 |
| `scheduler.js:113` | 注释错位到 `jobSyncBenchmark` | 归位 |

**验证**：改动仅注释/空白 → `node --check` + 全量测试通过即可。

---

## 3. B 级设计（本轮实施）

### B1 · 抽 `useRemoveConfirm({ text, request })`

**现状**：9 处视图重复同一段「确认弹窗 → 调删除 API → 成功提示 → 全量刷新」：
`AccountsView:102`、`HoldingsView:65`、`DashboardView:144`、`TransactionsView:216`、
`CashFlowsView:94`、`DcaView:101`、`FxView:100`、`AdminView:195`、`DataView:131/149`

**设计**：新增 `web/src/composables/useRemoveConfirm.js`
```js
export function useRemoveConfirm() {
  return async function confirmRemove({ text, request, successText = '已删除', onDone }) {
    try { await ElMessageBox.confirm(text, '确认删除', { type: 'warning' }); }
    catch { return false; }                      // 用户取消
    try {
      await request();
      ElMessage.success(successText);
      if (onDone) await onDone(); else await usePortfolioStore().refreshAll();
      return true;
    } catch (e) { ElMessage.error(e.message); return false; }
  };
}
```
**迁移策略**：**逐视图替换、每替换 1–2 个视图即回归**，不做一次性大改。
优先替换结构最一致的 3 个（AccountsView / CashFlowsView / DcaView）作为样板，
其余保持现状待分批。

> ⚠️ 风险控制：`DataView:131/149` 两处文案与刷新逻辑不同，**不强制迁移**。

**验证**：每个迁移后的删除功能手动/E2E 走一遍（取消 + 确认两条路径）。

---

### B2 · 抽 `buildBackupPayload(uid, { full })`

**现状**：`routes/data.js` 三处结构雷同（导出 `17-32`、导入前备份 `53-64`、`/demo` 备份 `143-148`），
仅 SELECT 列与是否含设置不同。

**设计**
```js
function buildBackupPayload(uid, { includeSettings = true } = {}) {
  const db = getDb();
  const pick = (t, order) => db.prepare(`SELECT * FROM ${t} WHERE user_id=? ${order||''}`).all(uid);
  return {
    schema: 'invest-manager/v4',          // ⚠️ 格式标识，勿改
    exportedAt: now(),
    version: APP_VERSION,                  // 新增：便于导入时提示版本差异
    accounts: pick('account'), assets: pick('asset'), events: pick('event'),
    cashFlows: pick('cash_flow'), snapshots: pick('snapshot','ORDER BY month'),
    benchmarks: pick('benchmark'), dcaPlans: pick('dca_plan'),
    settings: includeSettings ? getSettings(uid) : undefined,
  };
}
```
**注意**：`/demo` 那处会**替换**用户数据，需保留其原有语义（先备份再替换）。

**验证**：导出→导入往返测试（现有测试已覆盖备份导入）；导出 JSON 的字段集合与改造前**逐字段一致**。

---

### B3 · `OpsDialogs` 按需加载

**现状**：`OpsDialogs.vue` 聚合 7 个弹窗，被 6 个视图引用；
其中 Asset / Account / CashFlow / DcaPlan / Fx **共 5 个随宿主立即实例化**
（Event、Alert 已有 `v-if`）。视图只用一个弹窗也会挂载多个。

**设计（两步，先做低风险的第 1 步）**
1. **给剩余 5 个弹窗补 `v-if="modelValue"`**（与 Event/Alert 一致）——
   零结构改动、即刻减少挂载。
2. （可选，后续）拆分为 `defineAsyncComponent` 按需加载。

> ⚠️ 需确认各个弹窗内部依赖 `props.modelValue` 的时机（部分弹窗 watch `modelValue` 才初始化表单），
> 加 `v-if` 后**挂载即打开**，需保证 watch + immediate 逻辑不受影响 → 逐个验证。

**验证**：6 个宿主视图逐个打开/关闭弹窗，确认表单初始化正常、无 JS 异常（E2E）。

---

## 4. C 级（本轮不做，附理由与前置条件）

| 项 | 不做理由 | 前置条件 |
|---|---|---|
| **C1 admin 守卫校验角色** | 前端守卫只判 token，普通用户可进 `/admin` 页面（接口有 `adminRequired` 兜底，**安全无碍**，只是体验差）。改动需处理「刷新页面时 `fetchMe` 尚未返回」的时序，否则会误踢管理员 | 先确定 `auth` store 的 `ready` 状态语义 |
| **C2 死代码收窄** | `calc.js` 导出中有多个**被集成测试直接调用**（如 `portfolioFlows`/`realizedByMonth`），误删会破坏测试；前端未用的 getter/API 可能是**预留给后续功能** | 需你确认「是否计划对外提供开放 API / 多客户端」 |
| **C3 `compute.js` 8 个单用途接口** | 前端未用但**测试覆盖中**；保留则存在「每次全量重算」的性能浪费 | **产品决策**：是否对外提供细粒度 REST 接口 |
| **C4 ESLint/Prettier** | 收益长期、但一次性引入会产生大量格式改动 diff，与「只改事实性错误」的原则冲突 | 建议**版本稳定后单独开一次「格式化专场」**提交 |

---

## 5. 实施顺序与验证基线

```
A3（格式） → A1/A2（汇率收敛） → B2（备份抽函数） → B1（删除确认，试点 3 视图） → B3（弹窗懒加载）
```

每步完成后必须满足：
1. `node server/test/calc.test.js` → **114/114**
2. `node --test server/test/api.test.js` → **43/43**
3. `cd web && npm run build` → 零错误
4. `cp server/src/calc.js design/server/calc.js` 保持交付包一致
5. 涉及 UI 的步骤：CDP E2E 确认目标功能可用且 **JS 异常 0**

---

## 6. 实施记录

| 阶段 | 提交 | 实际落地与设计的差异 |
|---|---|---|
| Phase 1 | `90c417b` | 按设计执行，无差异 |
| Phase 3-A | `a79a966` | 按设计执行（`currentFxRow()` 为权威实现）；额外修正缩进 |
| Phase 3-B2 | `894a7c4` | **偏离设计**：抽为 `buildPortablePayload` / `buildFullSnapshot` **两个**函数，而非一个带 flag 的函数（三处用途不同，不可合并） |
| demo 备份修复 + 版本号 1.0.4 + B3 | `201ccff` | B3 加 `v-if` 前**须先补 `watch(modelValue, …, { immediate: true })`**，否则破坏表单初始化（设计未预见到） |
| B1 试点 | `a741671` | 组合式函数实际签名比设计多 `successText` / `beforeRefresh` / `refresh`；弹窗标题取「删除确认」（设计草稿写的是「确认删除」） |
| **B1 收尾（本轮）** | `8015cd9` | 迁移剩余 8 视图 / 9 处；**额外新增 `animate` 选项**——FxView / AdminView 原走 `refreshAll(false)`（不闪 KPI），无此选项会引入行为变化 |

**B1 完成度**：10 处删除确认（9 视图，DataView 2 处）全部迁移完毕，`ElMessageBox.confirm` 在删除场景已无残留
（仅剩 DataView 的导入/示例数据确认、AllocationView 的比例超限提示、AdminView 的禁用用户/重置密码等**非删除**确认）。

**验证基线（B1 收尾）**：calc 114/114、API 43/43、构建零错误、`design/server/calc.js` 与实现逐字节一致；
CDP E2E 对 10 处逐条走「取消 → 数据不变；确认 → 数据 −1 + 成功提示」，弹窗均为「删除确认 / 删除 / 取消」，**JS 异常 0**。
> 注：DcaView 的删除按钮在资产被级联删除后消失 —— 首次全量 E2E 因前序用例先删了资产而漏测该视图；
> 把 DcaView 提到删除类用例之前后复跑，**10/10 全过**。（E2E 脚本：`...\Temp\imv\b1-remove-e2e.js`）

