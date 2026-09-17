# AI Skill 设计与最小版本范围 · v1

> 赛题：粤港澳大湾区 AI Coding 创新大赛 · 方向二 · 学术前沿知识导航智能体
> 日期：2026-09-17
> 配套：《数据模型与接口契约_v1》（数据模型以那份为准）

---

## 1. 什么是 Skill（本文定义）

**一个 Skill = 一个 AI 能力单元**，有固定契约，独立成文件。

```
src/lib/skills/
  domain-converge.ts      领域追问
  domain-resolve.ts       领域树查重
  pick-key-files.ts       挑关键文件
  analyze-project.ts      项目反推能力
  parse-learned.ts        对话录入解析
  plan-profile.ts         判定计划形态
  plan-skeleton.ts        生成计划骨架
  expand-stage.ts         展开阶段到天
  recommend-papers.ts     论文推荐
  explain-plan.ts         解释排布理由
  review-domains.ts       领域树审阅建议
```

### 1.1 统一契约

```ts
export type SkillResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export interface Skill<I, O> {
  name: string
  description: string          // 一句话说清它干什么，AI coding 时当上下文用
  stage: 'locate' | 'diagnose' | 'profile' | 'generate' | 'evolve' | 'maintain'
  input: ZodSchema<I>
  output: ZodSchema<O>
  buildPrompt: (input: I, ctx: SkillContext) => string
  run: (input: I, ctx: SkillContext) => Promise<SkillResult<O>>
}

export interface SkillContext {
  domains: Domain[]            // 领域树切片
  nodes: Node[]                // 知识树切片（按策略裁剪）
  profile?: Profile            // 用户已掌握摘要
  plan?: Plan                  // 当前计划（生成类 skill 用）
}
```

**所有 skill 内部都走同一条链**：输入校验 → 组装上下文 → 调模型 → 输出校验（失败重试 ≤2 次）→ 返回。重试逻辑写在 `lib/llm.ts` 里，skill 本身不重复实现。

### 1.2 硬规则

1. **每个 skill 必须是纯函数**：同样的 input + ctx 得到同样结构的 output
2. **输出必须是结构化 JSON**，不接受自然语言段落（除了专门产出文案的字段）
3. **绝不允许 skill 直接写数据库**：skill 只产出"草案"，写入由 API 层在用户确认后执行
4. **每个 skill 必须能单独测试**：用一条固定输入跑通，不需要起整个应用

---

## 2. Skill 清单（11 个）

| # | Skill | 阶段 | 输入 | 输出 | 优先级 |
|---|---|---|---|---|---|
| 1 | `domain-converge` | ① 定位 | 用户描述 + 领域树 | 下一轮 2–4 个选项 / 收敛结论 | **P0** |
| 2 | `domain-resolve` | ① 定位 | 候选领域词 | 命中节点 / 新建提议 | **P0** |
| 3 | `pick-key-files` | ② 诊断 | 文件树 + 语言占比 | 5–10 个路径 + 挑选理由 | **P0** |
| 4 | `analyze-project` | ② 诊断 | 关键文件内容 + README | 证据 + 技能点 + 置信度 | **P0** |
| 5 | `parse-learned` | ② 诊断 | 一句口语（"我学过概率论"） | 候选知识点 + 掌握度 + **反问句** | P1 |
| 6 | `plan-profile` | ③ 形态 | 目标领域 + 缺口 + 意图 | `profile` + `ratio` | **P0** |
| 7 | `plan-skeleton` | ④ 生成 | 领域 + 缺口 + 时间预算 | `goal` + `summary` + 阶段划分 | **P0** |
| 8 | `expand-stage` | ④ 生成 | 单个阶段 + 预算 | 逐日 PlanItem（含 `outcome`） | **P0** |
| 9 | `recommend-papers` | ⑤ 演进 | 已掌握知识点 + 进度 | 论文 + 难度 + 理由 | **P0**（D8） |
| 10 | `explain-plan` | ⑤ 演进 | 计划片段 + 用户提问 | 一段解释 | P1 |
| 11 | `review-domains` | 维护 | `ai_added` 节点列表 | 合并 / 改名建议 | P1 |

**为什么这样组织对 AI Coding 特别友好**（这是你们当前最重要的理由）：

- 每个 skill 是**一个文件**，可以单独让 AI 生成、单独跑测试
- 契约固定 → 前端可以**先拿 mock 数据并行开发**，不必等后端
- 出问题能定位到**具体哪个 skill**，不会变成"整个系统都不对"
- 逐个替换升级：改 `plan-skeleton` 的提示词，不影响其他任何东西

---

## 3. 最小最简版本（MVP-0）

**目标**：一条主链路跑得通、演得出来。**一晚上到两天完成。**

### 3.1 做

- **1 个页面**（左对话 + 右结果，不做路由拆分）
- **3 个 skill**：`domain-converge`、`analyze-project`、`plan-skeleton`
- **4 张表**：`Domain`、`Node`、`Project`、`Plan` + `Stage`
- **手工领域树第一层**（8–12 个节点）
- **预置 MNIST 分析结果**作为兜底数据

### 3.2 不做（这一版全部砍掉）

| 砍掉的东西 | 什么时候加回来 |
|---|---|
| 5 个页面拆分 | MVP-1 |
| 计划展开到天（`expand-stage`） | MVP-1 |
| 论文推荐 | MVP-2（D8） |
| 对话式知识录入 | MVP-1 |
| 项目导入的 GitHub API 对接（先用粘贴） | MVP-1 |
| 领域树审阅 | MVP-2 |
| 计划版本化 | MVP-2 |
| 登录 / 多用户 | 不做 |
| 论文缓存与定时刷新 | 不做 |

### 3.3 MVP-0 的验收标准

跑通这一条，就算成功：

```
输入「我想做多模态」
  → AI 追问一轮 → 确认目标领域
  → 粘贴 MNIST 项目代码
  → 输出带证据的技能点 → 用户勾选确认 → 写入知识库
  → 生成计划骨架（goal + summary + 阶段划分）
  → 页面展示
```

### 3.4 拓宽路径

| 版本 | 加什么 | 目标 |
|---|---|---|
| **MVP-0** | 3 skill + 单页 + 主链路 | 今晚–D2 |
| **MVP-1** | 页面拆分成 5 个 + `expand-stage` + `parse-learned` + 项目 GitHub 导入 | D3–D6 |
| **MVP-2** | `recommend-papers` + 领域树审阅 + 计划版本化 + 预置演示数据 | D7–D9 |

**每次只加一个 skill 或一个区块，加完必须保持随时能跑。**

---

## 4. 部署方案

### 4.1 现实约束

**「国内访问稳定 + 免实名 + 免费」这三个条件基本无法同时满足。** 所以分两层处理：先拿到链接让开发不阻塞，提交前解决可访问性。

### 4.2 方案对比

| 方案 | 注册门槛 | 国内访问 | 支持 Next.js | 备注 |
|---|---|---|---|---|
| **Cloudflare Pages** | 邮箱即可 | **较好**（亚洲边缘节点多） | 静态导出完全支持；完整 SSR 需 adapter | **推荐首选** |
| **Vercel** | GitHub 登录 | 可能不稳定 | 完整支持 | 最简单，但国内有风险 |
| **Netlify** | 邮箱即可 | 可能不稳定 | 静态导出 | 免费额度已收紧（300 credits/月） |
| **GitHub Pages** | 已有 GitHub | 不稳定 | 仅静态 | 零配置兜底 |
| 国内云厂商（腾讯 / 阿里 / 华为 / 火山） | **需实名认证** | 最好 | 支持 | 换一家注册即可 |
| CloudStudio 沙箱 | 无需 | 可以 | 静态站 | 可立即使用，适合临时演示 |

### 4.3 建议路径

1. **今晚**：用 **Cloudflare Pages** 部署一个空项目，把链路跑通（邮箱注册，无门槛）
2. **D2–D7**：正常开发，每次 push 自动部署
3. **D8**：用手机 4G 实测链接能否打开；打不开就切国内云厂商
4. **提交前**：确认链接在**手机流量**下可访问

### 4.4 两条必须注意的坑

- **不要绑自己的域名。** 国内服务器 + 自定义域名需要 ICP 备案，周期约 20 天，**绝对来不及**。用平台提供的默认域名（如 `xxx.pages.dev`、`xxx.tcloudbase.com`），**免备案**。
- **如果实名认证环节卡住了**（例如没有内地身份证或银行卡），不要在那里耗时间，直接走 Cloudflare Pages，它不需要实名。

### 4.5 架构上的一个取舍

如果最终只能用静态托管（Cloudflare Pages / GitHub Pages），需要把 Next.js 改成**静态导出**（`output: 'export'`），代价是**没有服务端 API 路由**。这会导致：

- 模型 API key 暴露在前端 → 工程完整性会被扣分
- 数据只能存浏览器本地（IndexedDB）→ 换设备就丢

**所以：如果条件允许，优先保留服务端。** 但如果时间不够、部署实在搞不定，静态版也能演完整个 Demo——**先跑起来比架构完美重要**，这个取舍要你们自己拍板。

---

## 5. 更新后的 D1–D3 安排

| 时间 | 任务 | 完成标志 |
|---|---|---|
| **D1 今晚** | 账号与部署链路打通 + 初始化项目 + Prisma schema + 领域树第一层 + 跑通一次模型调用 | 一个公网可访问的空页面 |
| **D2** | MVP-0：`domain-converge` + 单页对话界面 | 输入"我想做多模态"能追问并收敛 |
| **D3** | MVP-0：`analyze-project` + 知识树写入 | 粘贴 MNIST 代码能输出带证据的技能点 |

> D1 的完成标志就是那一句「一个公网可访问的空页面」。**它比任何一行业务代码都重要。**
