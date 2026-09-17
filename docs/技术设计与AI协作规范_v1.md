# 技术设计与 AI 协作规范 · v1

> 赛题：粤港澳大湾区 AI Coding 创新大赛 · 方向二 · 学术前沿知识导航智能体
> 日期：2026-09-17　团队：2 人（编程基础较弱，前后端均以 AI Coding 实现）

---

## 0. 本轮最大变量：技术选型的判据变了

团队编程基础较弱、前后端全靠 AI Coding，因此选型标准不是"哪个技术先进"，而是三条：

1. **AI 生成得最准** —— 训练数据里主流栈的代码最多，出错率最低
2. **出错时你们能改得动** —— 单语言、单仓库、少依赖，报错信息能看懂
3. **一条命令能跑起来、一次部署能上线** —— 环境与部署是新手最大的坑

**结论：从"React + FastAPI 前后端分离"改为「Next.js 单仓库全栈」。**

## 1. 技术栈定稿

| 层 | 选型 | 为什么 |
|---|---|---|
| 框架 | **Next.js 15（App Router）+ TypeScript** | 前端后端一个项目、一种语言，AI 对它生成的准确率最高 |
| 样式 | **Tailwind CSS + shadcn/ui** | 组件复制即用，不用自己写样式 |
| 可视化 | **ECharts**（树图 + 时间轴） | 中文资料多，配置项开箱可用 |
| 数据库 | **SQLite + Prisma** | 一个文件、零运维、Prisma 迁移命令化 |
| 校验 | **Zod** | 强制 LLM 输出格式，是技术红线 1 的落地工具 |
| 模型 | **LearnBuddy 平台** | 顺带积累参赛所需的对话记录 |
| 论文源 | **arXiv API** | 免费、无需 key |
| 部署 | **腾讯云 CloudBase 云托管** | 服务端持有模型 key，不暴露到前端 |
| 仓库 | **GitHub + MIT LICENSE** | 方向二必须开源 |

**明确禁止引入**（新手 + AI Coding 的高危区）：微服务、GraphQL、Redis、Docker 自建编排、状态管理库（Redux 等）、自研 UI 组件库、>15 个依赖。

## 2. 单仓库里有什么

一个仓库装下全部：页面层 → API 路由层 → 数据层。外部只依赖模型和 arXiv。

<提示：此处的架构图见对话正文>

## 3. 页面清单（5 个，不再多）

| # | 路由 | 作用 | 演示价值 |
|---|---|---|---|
| 1 | `/` | 概览：能力地图缩略 + 当前计划 + 今日推荐论文 | 演示开场页 |
| 2 | `/import` | 项目导入与能力反推（含确认环节） | **核心卖点** |
| 3 | `/profile` | 能力画像：知识树 + 节点详情 + 证据链 | **核心卖点** |
| 4 | `/plan` | 对话式生成路线 + 计划可视化（合并为一个页面两个区） | 赛题要求 |
| 5 | `/papers` | 论文推荐：卡片列表 + 难度/关联知识点 | **赛题要求** |

导航栏固定这 5 项。**不做**：登录页、设置页、多用户、详情弹窗以外的复杂交互。

## 4. 数据模型（Prisma Schema 草案）

```
model Project      { id, title, sourceType(text|github|zip), rawInput, createdAt }
model ProjectSkill { id, projectId, name, evidence, confidence, accepted, nodeId? }
model Node         { id, parentId?, level(1-4), name, summary, domain, status, confidence, source, updatedAt }
model Evidence     { id, nodeId, type(code|course|self_report), ref, detail, createdAt }
model Plan         { id, title, targetDomain, status(draft|active|archived), createdAt }
model PlanItem     { id, planId, track(knowledge|paper), title, nodeId?, paperId?, startDate?, endDate?, status }
model Paper        { id, arxivId, title, abstract, url, publishedAt, difficulty(1-5), reason, cachedAt }
```

要点：
- `Node.status` 只有三个值：`locked` / `learning` / `mastered`
- `Node.source` 区分 `seed`（预置）/ `ai_inferred`（AI 推断）/ `user_confirmed`（用户确认）
- `Evidence` 独立成表，是为了让"AI 为什么这么判断"这条证据链**可展示**（体验分 + 技术分）
- `Paper.reason` 必须存下来 —— "为什么推给你"是论文推荐的灵魂

## 5. API 契约

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/projects/analyze` | 输入项目 → 返回候选技能点（含证据、置信度），**不落库** |
| POST | `/api/projects/:id/confirm` | 用户勾选后写入知识库 |
| GET | `/api/knowledge/tree` | 知识树（支持 `?maxLevel=` 裁剪，对应"按场景下探"） |
| GET | `/api/knowledge/nodes/:id` | 节点详情 + 证据链 |
| PATCH | `/api/knowledge/nodes/:id` | 修改状态 |
| POST | `/api/plan/draft` | 对话一轮：返回「AI 追问」或「计划草案」 |
| POST | `/api/plan/:draftId/commit` | 确认落库 |
| GET | `/api/plan/:id` | 计划详情（含 items） |
| PATCH | `/api/plan/items/:id` | 修改任务状态 |
| POST | `/api/papers/recommend` | 按 `planId` 或 `nodeIds` 返回推荐论文 |
| GET | `/api/papers` | 已缓存论文列表 |

**统一返回格式**（所有接口一致，AI 生成时照抄即可）：

```
{ "ok": true, "data": {...} }            成功
{ "ok": false, "error": "可读的错误信息" }  失败
```

**LLM 调用统一封装**：所有模型调用走一个 `lib/llm.ts`，内部用 Zod 校验输出结构；校验失败自动重试最多 2 次；仍失败则返回 `ok:false` 并由前端展示兜底文案。**这是技术红线 1 的唯一落地点，不要在每个接口里各写一遍。**

## 6. AI Coding 协作规范（最重要的一节）

基础较弱时，项目失败的主因不是"写不出来"，而是**"改不动了"**。以下规则请两人严格执行：

1. **一次只做一个功能**：明确到"今天只做 `/import` 页的提交按钮"。永远不要对 AI 说"帮我做个学习路线系统"。
2. **先定接口和数据结构，再让 AI 写实现**：把第 4、5 节的内容直接贴给 AI 作为上下文，避免它自由发挥。
3. **每个功能保持"最小可运行"**：宁可功能少，不可跑不起来。每个功能完成后立刻手动点一遍。
4. **随时可运行是最高优先级**：每天收工前项目必须能 `npm run dev` 跑起来。破坏性重构一律禁止。
5. **每完成一个功能就 git commit**：commit 信息写清楚做了什么。这是你唯一的安全网。
6. **报错就把完整报错原文贴给 AI**，不要自己猜、不要只贴一行。
7. **冻结技术栈**：中途绝不换库、不升级大版本、不引入新依赖。
8. **让 AI 解释它写了什么**：至少要知道每个文件负责什么。改不动往往是因为"完全不知道这段代码在干嘛"。
9. **每天记录进展**：一句话即可。这既是 LearnBuddy 对话记录，也是 PPT 和社媒的素材。

**一个反直觉但重要的提醒**：你们"基础弱 + 全靠 AI Coding 做出完整产品"这件事，**是这次 AI Coding 大赛最有说服力的参赛故事**，不是短板。把它写进 PPT 和视频，并把"卡在哪里、怎么用 AI 解决"的过程记录下来——这直接对应评分里 25% 的「AI 工具使用」分。

## 7. 种子与演示数据方案

你手上的 MNIST 和 C++ 作业是**极好的演示素材**，因为是真实项目，视频里讲起来可信。

### 7.1 能力反推映射表（预先生成，存成 JSON）

**MNIST 项目（Python）** → 可反推：

| 层级 | 推断出的节点 |
|---|---|
| L1 数学基础 | 线性代数（矩阵乘法）、微积分（链式法则 / 梯度）、概率统计（softmax、交叉熵） |
| L1 编程基础 | Python 语法、NumPy 数组运算 |
| L1 理论基础 | 神经网络、卷积、反向传播、梯度下降 |
| L1 工具基础 | PyTorch（或 TensorFlow）、Matplotlib |
| L1 项目经历 | MNIST 手写数字识别 |

**缺口标注**（用于演示"该补什么"）：现代架构（ResNet / ViT）、数据增强与正则化、训练调参与评估、论文阅读方法

**C++ 作业** → 可反推：C++ 语法、指针与内存管理、面向对象、数据结构与算法、编译与调试
→ 缺口：现代 C++（智能指针 / 模板）、CMake 工程化、性能分析

### 7.2 演示脚本（3 分钟视频按此走）

1. **开场**：`/import` 导入 MNIST 项目 → AI 输出带证据的技能点 → 点确认
2. **看点 1**：`/profile` 能力地图亮起一片节点，点开"概率统计"看到证据是"MNIST 代码中使用了 softmax 与交叉熵损失"
3. **看点 2**：`/plan` 对话生成"图像识别"路线 → AI 追问收敛方向 → 生成知识线 + 论文线 → 确认落库
4. **看点 3**：`/papers` 按当前进度推荐 LeNet → AlexNet → ResNet 的难度递进论文，每篇带"为什么推给你"
5. **收尾**：`/import` 再导入 C++ 作业，证明同一套机制跨领域可用

### 7.3 演示数据必须预生成（技术红线 4）

MNIST 的分析结果、生成的计划、论文推荐结果，**全部提前跑好存进 SQLite**。现场演示只保留"对话追问"这一个实时环节作为亮点，其余走预置数据。**断网也要能演完。**

## 8. 部署方案（腾讯云）

- **主方案**：腾讯云 CloudBase 云托管，部署 Next.js 应用；模型 key 放服务端环境变量
- **保底方案**：Vercel 或静态托管 + 静态导出，确保有一个可访问的在线链接
- **D1 必须做**：先部署一个 Hello World 把链路跑通，**不要等到 D9 才发现部署不通**

## 9. 更新后的排期

| 天 | 日期 | 任务 |
|---|---|---|
| D1 | 9/17 | 立项、定 schema、建仓库与 LICENSE、**跑通一次空项目部署**、验证模型调用 |
| D2–D3 | 9/18–19 | 数据层 + 知识树可视化（`/profile`） |
| D4–D5 | 9/20–21 | 项目导入与能力反推（`/import`）—— **差异化最强，必须按时完成** |
| D6–D7 | 9/22–23 | 对话式路线生成 + 计划可视化（`/plan`） |
| D8 | 9/24 | 论文按水平推送（`/papers`） |
| D9 | 9/25 | 首页串联、预置演示数据、真实环境联调 |
| D10 | 9/26 | 3 分钟视频、PPT、提交 |

## 10. 待确认

1. **GitHub 仓库和腾讯云账号是否已具备？**（上一轮第 5 问未回答，D1 就要用）
2. 两人是否同一专业？（跨专业组队可加 2 分，需在 PPT 体现分工）
3. 本机是否已装 Node.js 20+？没有的话 D1 第一步就是装环境
4. 是否接受"5 个页面、不做登录"的精简范围？
