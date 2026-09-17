# expert/ —— LearnBuddy 专家智能体

本目录存放**交付物一**：运行在 LearnBuddy 里的专家智能体包。

## 为什么做专家智能体

赛事允许作品以「专家智能体」形态提交，而 LearnBuddy 的专家包天生具备：

- **对话界面**（不需要自己写）
- **Skills 机制**（可以内嵌多个能力单元）
- **资料库能力**（在线存储 + 页面发布 + 跨设备同步）

也就是说，本产品最重的三块基础设施——对话、Agent 调度、部署——**平台已经提供了**。我们只需要写角色定义、skill 规范和数据表结构。

## 目录结构

```
expert/
└── academic-nav/
    ├── .codebuddy-plugin/plugin.json    展示字段：名称、职业、分类、标签、推荐提示词
    ├── agents/academic-nav.md           角色定义 + 五阶段 SOP + 输出规范
    ├── avatars/expert.png               头像
    └── skills/                          内嵌的能力单元
        ├── domain-converge/SKILL.md
        ├── analyze-project/SKILL.md
        └── plan-skeleton/SKILL.md
```

## 与 prompts/ 的关系

**skill 的指令正文来自 `prompts/` 目录，不要在这里另写一份。**

| prompts 文件 | 对应 skill |
|---|---|
| `prompts/chat.md` | `domain-converge` |
| `prompts/analyze-project.md` | `analyze-project` |
| `prompts/plan-skeleton.md` | `plan-skeleton` |

改提示词时只改 `prompts/`，然后同步过来。

## 创建方式

用 LearnBuddy 的**专家包管理器**能力（`expert-manager`）创建，它会走标准流程：

```
初始化目录 → 填充内容 → 生成头像 → 校验 → 注册 → 打包
```

专家必须生成到专家目录（`$WORKBUDDY_CONFIG_DIR/plugins/marketplaces/my-experts/plugins`），**生成到别处不会被检测到**。

## 当前状态

⏳ **待建**（计划 D3–D5 完成）
