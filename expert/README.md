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

用 LearnBuddy 的**专家包管理器**能力（`expert-manager`）创建：

```
初始化目录 → 填充内容 → 生成头像 → 校验 → 注册 → 打包
```

专家必须生成到专家目录（`$WORKBUDDY_CONFIG_DIR/plugins/marketplaces/my-experts/plugins`），**生成到别处不会被检测到**。

## ⚠️ 修改后必须同步（最容易踩的坑）

仓库里的 `expert/academic-nav/` 是**源码副本**，LearnBuddy 实际运行的是专家目录里的那一份。

**两边是镜像关系，改了仓库不跑同步，LearnBuddy 里跑的还是旧版本。**

所以：**每次改完专家包，跑一次同步脚本**：

```bash
node expert/sync.mjs            # 同步 + 重新注册
node expert/sync.mjs --dry-run  # 只看会同步什么，不写入
```

脚本做了三件事：逐文件覆盖到专家目录 → 检查陈旧文件（只报告不删除）→ 重新注册。

它会自动拦住一类致命误操作：如果 `plugin.json` 里的 `name` / `agentName` / `expertType` 变了，
脚本会中止并提示——这几项是专家的唯一标识，改了会导致专家丢失，必须重新创建。

> 脚本刻意**不使用任何删除操作**：本机环境会给删除挂安全拦截，而且逐文件覆盖本来就够用。

## 当前状态

✅ **已建成并注册**（v1.0.0）

| 组成 | 状态 |
|---|---|
| `.codebuddy-plugin/plugin.json` | ✅ 展示字段全部填好，约束校验通过 |
| `agents/academic-nav.md` | ✅ 角色定义 + 五阶段 SOP + 写库铁律 + 边界红线 |
| `skills/domain-converge/` | ✅ SKILL.md + 查重脚本（前三步确定性查重，27 项测试通过） |
| `skills/analyze-project/` | ✅ SKILL.md（本专家最核心能力） |
| `skills/plan-skeleton/` | ✅ SKILL.md（两段式生成 + 六条硬规则） |
| `avatars/expert.png` | ⏳ **待生成**（需消耗图像生成额度，等确认） |
