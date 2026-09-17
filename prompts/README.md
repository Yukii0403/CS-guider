# prompts/ —— 提示词正文的单一事实来源

这个目录存放本产品**三段 AI 提示词的正文**（第 2 层）。

## 先说清楚一件事：提示词有两层

```
第 1 层 · 触发描述   → 「什么时候该启动我」   ← 不在本目录，见下
第 2 层 · 正文       → 「启动了之后怎么做」   ← 本目录就是这一层
```

在**自建 Web 版**里这不成问题——`worker.js` 用 `mode: 'chat' | 'analyze' | 'plan'` 显式指定用哪段，路由由代码做完了。

但在**专家包里，路由是模型自己做的**：模型只能读到 SKILL.md frontmatter 的 `description`，读不到正文。**没有触发描述 = 这个技能要么永远不被调用，要么到处被误调用。**

所以：**第 2 层在这里，第 1 层只在专家包里。**

## 三行映射表（改东西前先看这个）

| 提示词正文 | 触发描述（第 1 层） | Web 版路由 |
|---|---|---|
| `chat.md` | `expert/.../skills/domain-converge/SKILL.md` 的 frontmatter | `mode: 'chat'` |
| `analyze-project.md` | `expert/.../skills/analyze-project/SKILL.md` 的 frontmatter | `mode: 'analyze'` |
| `plan-skeleton.md` | `expert/.../skills/plan-skeleton/SKILL.md` 的 frontmatter | `mode: 'plan'` |

## 两个交付形态怎么用它

| 交付物 | 位置 | 怎么用它 |
|---|---|---|
| 公网可对话页面 | `web-demo/worker.js` | 把正文原样复制进 `SYSTEM_PROMPTS` |
| LearnBuddy 专家智能体 | `expert/academic-nav/skills/*/SKILL.md` | 正文写进指令区，触发描述另外写 |

**正文必须两边同一份。** 不允许任何一方自己另写——否则两周后你会发现两个交付形态的 AI 行为不一样，而那时已经没时间对齐了。

## 修改流程

1. 改这里的 `.md`（只改正文）
2. 同步到 `web-demo/worker.js` 的 `SYSTEM_PROMPTS`
3. 同步到 `expert/.../skills/*/SKILL.md` 的正文区
4. 跑 `node expert/sync.mjs` 让专家包生效
5. 改提示词属于实质性变更，提交信息里写清楚改了什么、为什么改

> **触发描述改在 SKILL.md 里，不要抄回这里。** 两层的职责不同：正文回答"怎么做"，触发描述回答"什么时候做"。

## 文件清单

| 文件 | 作用 |
|---|---|
| `chat.md` | 通用对话与领域定位 |
| `analyze-project.md` | 从项目代码反推能力（**本产品最核心的一段**） |
| `plan-skeleton.md` | 生成学习计划骨架 |

## 编写约定

1. **输出格式必须写死。** 越具体的格式约束，模型越不容易跑偏。
2. **必须写清"什么时候不该用"。** 这是防止模型强行套用的关键。
3. **禁止编造事实**（论文标题、作者、链接）要显式写进规则。
4. **要求模型暴露不确定性。** 低置信度的项要单独列出让用户确认，而不是混在一起下结论。
