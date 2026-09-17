# 学术前沿知识导航 · Web 最小可运行版

一个静态页 + 一个云函数。**密钥只存在函数的环境变量里，永远不进浏览器。**

```
浏览器 (index.html)  →  你的云函数 (worker.js)  →  大模型接口
                          ↑ 密钥在这里
```

## 目录

| 文件 | 作用 |
|---|---|
| `index.html` | 前端。单文件、全部内联、零外部依赖，可直接托管到任何静态空间 |
| `worker.js` | 云函数。Cloudflare Workers 版；文件末尾附 Vercel Edge 的改法 |
| `README.md` | 本文件 |

---

## 五步跑起来

### 步骤 1 · 拿一个 API Key

任选一家，都提供 OpenAI 兼容接口，**新用户通常有免费额度**（具体以官网为准）：

| 服务商 | 控制台 | 默认 BASE_URL | 默认模型 |
|---|---|---|---|
| DeepSeek | platform.deepseek.com | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 智谱 GLM | open.bigmodel.cn | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 月之暗面 | platform.moonshot.cn | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |

> ⚠️ **不要用腾讯混元**（需要腾讯云账号并实名，流程更长）。除非你已经有腾讯云账号。

拿到 key 后先放一边，下一步要用。

### 步骤 2 · 部署云函数（Cloudflare Workers，推荐）

选它的原因：**邮箱注册即可，不需要实名、不需要信用卡**，免费额度对 demo 完全够用。

1. 打开 https://dash.cloudflare.com/sign-up ，用邮箱注册并登录
2. 左侧选 **Workers & Pages** → **Create** → **Create Worker**
3. 起个名字，比如 `academic-nav`，点 **Deploy**（先用默认代码占位）
4. 进入这个 Worker → **Edit code** → 把编辑器里的内容**全部删掉**，粘贴 `worker.js` 的全部内容 → **Deploy**
5. 回到 Worker 页面 → **Settings** → **Variables and Secrets**，添加以下变量：

| 变量名 | 值 | 是否加密 |
|---|---|---|
| `MODEL_API_KEY` | 步骤 1 拿到的 key | **是（选 Secret / Encrypt）** |
| `MODEL_BASE_URL` | 上表中的 BASE_URL | 否 |
| `MODEL_NAME` | 上表中的模型名 | 否 |
| `ALLOW_ORIGIN` | 先填 `*`，上线后再改 | 否 |

6. **Deploy** 一次让变量生效

你的函数地址就是 `https://<你起的名字>.<你的账号>.workers.dev`

### 步骤 3 · 验证函数活着

浏览器直接访问：

```
https://<你的函数地址>/api/health
```

正常会返回：

```json
{ "ok": true, "model": "deepseek-chat", "hasKey": true }
```

- 看到 `"hasKey": false` → 环境变量没配好或没重新 Deploy
- 打不开 → 地址写错了，回步骤 2 确认

### 步骤 4 · 托管前端页面

三种都行，选一个：

- **A（推荐）**：用 LearnBuddy 的**资料库**能力，把 `index.html` 发布成在线页面。免部署、直接拿公网链接。
- **B**：Cloudflare 控制台 → **Workers & Pages** → **Create** → **Pages** → **Upload assets**，把 `index.html` 拖进去
- **C（仅供本地测试）**：直接双击 `index.html`

### 步骤 5 · 填地址并测试

打开你的页面 → 右上角 **设置** → 填入步骤 2 的函数地址 → **保存并检测**。

右上角状态变成 **「已连接 · 模型名」** 就成功了。点首页的「反推我的能力」卡片，输入框里会自动填入一段示例 PyTorch 代码，直接发送试试。

---

## 环境变量一览

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `MODEL_API_KEY` | ✅ | — | 模型服务商的密钥，**设为加密变量** |
| `MODEL_BASE_URL` | | `https://api.deepseek.com/v1` | 接口地址，末尾不要带 `/` |
| `MODEL_NAME` | | `deepseek-chat` | 模型名 |
| `ALLOW_ORIGIN` | | `*` | 允许的页面来源。上线后建议改成你的页面域名 |

---

## 安全说明（这段可以写进 PPT）

1. **密钥不下发前端。** 浏览器只认识你的函数地址，密钥存在函数的环境变量里，查看页面源码也拿不到。
2. **对话历史不落库。** 当前版本是纯内存，刷新即清空。要持久化再接数据层。
3. **输入有上限。** 函数里对单条消息截断到 24000 字符，并且只取最近 12 条，防止上下文被撑爆。
4. **CORS 可控。** `ALLOW_ORIGIN` 上线后应改成你自己的页面域名，避免函数被别人的站点白嫖。
5. **建议后续补的**：函数侧限流（按 IP 计数）、按会话计费上限、敏感词过滤。这三件事写进 PPT 的"后续规划"即可，demo 阶段不必实现。

---

## 常见问题

**Q：页面提示"连不上后端"**
A：① 地址末尾有没有多余的 `/`；② 函数地址在浏览器里单独打开 `/api/health` 是否正常；③ 函数是否已经 Deploy 过。

**Q：返回 401 / 403**
A：key 错了或没额度。注意有些服务商的 key 需要带前缀，直接复制完整的。

**Q：返回 404、模型不存在**
A：`MODEL_NAME` 写错了。用上表里的默认值先跑通。

**Q：回复是空的**
A：换一个模型试。部分服务商的 `stream` 参数行为有差异。

**Q：怎么换服务商？**
A：只改两个环境变量（`MODEL_BASE_URL` 和 `MODEL_NAME`），前端和函数代码都不用动 —— 这就是走 OpenAI 兼容格式的好处。

---

## 与 LearnBuddy 专家智能体版本的关系

本目录的 `worker.js` 里内置了三段提示词，对应页面上三个模式：

| 模式 | 提示词 | 作用 | 温度 |
|---|---|---|---|
| 通用对话 | `SYSTEM_PROMPTS.chat` | 领域定位与路线讨论 | 0.6 |
| 能力反推 | `SYSTEM_PROMPTS.analyze` | 从项目代码反推能力 | 0.2 |
| 路线规划 | `SYSTEM_PROMPTS.plan` | 分阶段学习计划 | 0.3 |

**这三段必须与专家智能体版本里的 SKILL.md 保持同一份文本。** 两个交付形态（公网页面 / 专家智能体）共享一套 AI 逻辑，只换外壳，**避免日后改了一边忘了另一边**。

仓库根目录的 `prompts/` 是它们共同的来源，改动流程：

```
改 prompts/<name>.md
  → 同步到 web-demo/worker.js 的 SYSTEM_PROMPTS
  → 同步到 expert/academic-nav/skills/<name>/SKILL.md
  → 跑 node expert/sync.mjs 让专家包生效
```

---

## 前端三个模式分别对应什么

| 页面上 | 模式 | 演示时怎么用 |
|---|---|---|
| 通用对话 | `chat` | "我想做多模态，但不知道具体往哪边走" → 它会给 2–4 个方向让你选 |
| 能力反推 | `analyze` | 点首页那张卡片，输入框会自动填一段 PyTorch 代码，直接发送 |
| 路线规划 | `plan` | "我是本科生，想在大三进实验室" → 它会先问期限和每天可投入时长 |

> **演示重点放在「能力反推」上。** 那是本作品最独特的能力，也是最容易让人眼前一亮的一环。

---

## 当前版本没做的事（有意识地砍掉的）

- 多轮对话历史的持久化（刷新即清空）
- 知识库读写与可视化（需要数据层）
- 论文推荐
- 用户登录

这些留给后续版本；本版本的唯一目标是：**让评委打开链接、输入一句话、真的收到模型回复。**
