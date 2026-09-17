-- ============================================================================
-- 学术前沿知识导航 · 知识库建表脚本（Cloudflare D1 / SQLite）
-- ============================================================================
-- 设计约束来自 docs/v3_产品结构设计骨架_v1.md：
--   · 7 张业务表，一张不改一张不减（domains / nodes / projects / evidence /
--     plans / plan_stages / plan_items）
--   · status 只挂 L5 知识点，L1–L4 由子节点聚合，不落库
--   · 会话（conversations / messages）不属于知识库，存在浏览器本地
--
-- 本脚本额外的两张表，理由写在各自注释里，是刻意加的：
--   · kb_snapshots   —— v3 要求「保存同步必须可撤销」
--   · paper_feedback —— 第二轮「不喜欢哪篇及原因」，逐条反馈
--
-- 执行：
--   线上： npx wrangler d1 execute academic-nav-kb --remote --file=db/schema.sql
--   本地： npx wrangler d1 execute academic-nav-kb --local  --file=db/schema.sql
--
-- 两点刻意的取舍：
--   1. 不加 FOREIGN KEY。D1 的外键默认行为未经验证，宁可改用应用层校验 + 索引，
--      换取跨环境行为一致。删除父节点时的清理由 worker 负责。
--   2. 每个名称类字段都配一个 name_norm 列 + 唯一索引，把「查重」这件事
--      从"AI 自己判断"变成"数据库直接拒绝"。这是知识树不重复的根本保障。
-- ============================================================================

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------- 元信息
-- 只存单行的键值（schema 版本、最后同步时间）。多行的历史记录放 kb_snapshots。
CREATE TABLE IF NOT EXISTS meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------- 1. domains
-- 领域树：追问收敛时的选项来源。根 + 第一层手工建，第二层起 AI 增量添加。
CREATE TABLE IF NOT EXISTS domains (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  name_norm        TEXT NOT NULL,              -- lower(trim(name))，查重用的确定列
  aliases          TEXT NOT NULL DEFAULT '[]', -- JSON 数组
  parent_id        TEXT,
  level            INTEGER NOT NULL DEFAULT 1,
  arxiv_categories TEXT NOT NULL DEFAULT '[]', -- 抓 arXiv 用，如 ["cs.CV","cs.CL"]
  keywords         TEXT NOT NULL DEFAULT '[]',
  source           TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed','ai_added')),
  created_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_domains_norm   ON domains(name_norm);
CREATE INDEX        IF NOT EXISTS ix_domains_parent ON domains(parent_id);

-- ------------------------------------------------------------------ 2. nodes
-- 知识树，五级：分类 → 子学科 → 课程 → 单元 → 知识点
-- status / confidence 只挂 level=5；上层由 lib/kb-agg.js 聚合算出。
CREATE TABLE IF NOT EXISTS nodes (
  id              TEXT PRIMARY KEY,
  parent_id       TEXT,
  level           INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
  name            TEXT NOT NULL,
  name_norm       TEXT NOT NULL,
  summary         TEXT,
  category        TEXT NOT NULL CHECK (category IN
                    ('数学基础','编程基础','理论基础','工具基础','科研素养')),
  domain_ids      TEXT NOT NULL DEFAULT '[]',
  status          TEXT CHECK (status IN ('untouched','learning','mastered','review')),
  confidence      REAL,
  manual_override INTEGER NOT NULL DEFAULT 0,  -- 1 = 用户手改过，聚合时不覆盖
  source          TEXT NOT NULL DEFAULT 'seed'
                    CHECK (source IN ('seed','ai_inferred','user_confirmed')),
  updated_at      TEXT NOT NULL
);
CREATE INDEX        IF NOT EXISTS ix_nodes_parent ON nodes(parent_id);
CREATE INDEX        IF NOT EXISTS ix_nodes_level  ON nodes(level);
CREATE INDEX        IF NOT EXISTS ix_nodes_status ON nodes(status) WHERE status IS NOT NULL;
CREATE INDEX        IF NOT EXISTS ix_nodes_cat    ON nodes(category);
-- 同一个父节点下不允许重名 —— 查重的第一道闸
CREATE UNIQUE INDEX IF NOT EXISTS ux_nodes_sibling ON nodes(ifnull(parent_id,''), name_norm);

-- --------------------------------------------------------------- 3. projects
-- 项目 = 证据来源。用户粘贴代码 / 给仓库链接 / 描述做过的项目时建一条。
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('github','manual')),
  source_url  TEXT,
  description TEXT,
  readme      TEXT,
  languages   TEXT NOT NULL DEFAULT '[]',
  file_tree   TEXT NOT NULL DEFAULT '[]',
  key_files   TEXT NOT NULL DEFAULT '[]',
  domain_tags TEXT NOT NULL DEFAULT '[]',
  analyzed_at TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_projects_url  ON projects(source_url);
CREATE INDEX IF NOT EXISTS ix_projects_name ON projects(name);

-- --------------------------------------------------------------- 4. evidence
-- 证据：把「掌握某知识点」这个结论挂到具体出处上。没有证据就不该有结论。
CREATE TABLE IF NOT EXISTS evidence (
  id         TEXT PRIMARY KEY,
  project_id TEXT,
  node_id    TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('code','course','self_report','conversation')),
  ref        TEXT,        -- 文件名:行号 / 课程名 / 对话摘要
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_evidence_node    ON evidence(node_id);
CREATE INDEX IF NOT EXISTS ix_evidence_project ON evidence(project_id);
-- 同一出处对同一知识点只记一次
CREATE UNIQUE INDEX IF NOT EXISTS ux_evidence_dup
  ON evidence(node_id, ifnull(project_id,''), type, ifnull(ref,''));

-- ------------------------------------------------------------------ 5. plans
CREATE TABLE IF NOT EXISTS plans (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','active','archived')),
  target_domain    TEXT,
  goal             TEXT,          -- 一句话说清结束时能做什么，必须可验证
  summary          TEXT,
  profile          TEXT CHECK (profile IN ('foundation','hybrid','research')),
  ratio            TEXT NOT NULL DEFAULT '{"knowledge":50,"paper":50}',
  start_date       TEXT,
  end_date         TEXT,
  daily_minutes    INTEGER,
  budget_minutes   INTEGER,
  constraints      TEXT NOT NULL DEFAULT '[]',
  excluded         TEXT NOT NULL DEFAULT '[]',  -- 明确不做的事
  resources        TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_plans_status ON plans(status);

-- ----------------------------------------------------------- 6. plan_stages
CREATE TABLE IF NOT EXISTS plan_stages (
  id               TEXT PRIMARY KEY,
  plan_id          TEXT NOT NULL,
  sort_order       INTEGER NOT NULL,
  title            TEXT NOT NULL,
  start_date       TEXT,
  end_date         TEXT,
  description      TEXT,
  acceptance       TEXT,        -- 做到什么算过关
  daily_allocation TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stage_order ON plan_stages(plan_id, sort_order);
CREATE INDEX        IF NOT EXISTS ix_stage_plan  ON plan_stages(plan_id);

-- ------------------------------------------------------------ 7. plan_items
-- 日任务。outcome 必填且必须可验证 —— 这是整个计划能不能执行的关键。
CREATE TABLE IF NOT EXISTS plan_items (
  id           TEXT PRIMARY KEY,
  plan_id      TEXT NOT NULL,
  stage_id     TEXT NOT NULL,
  sort_order   INTEGER NOT NULL,
  date         TEXT,
  title        TEXT NOT NULL,
  resources    TEXT NOT NULL DEFAULT '[]',   -- 论文链接也放这里（第二轮"加入学习计划"）
  outcome      TEXT NOT NULL,
  reason       TEXT,
  duration_min INTEGER,
  status       TEXT NOT NULL DEFAULT 'todo'
                 CHECK (status IN ('todo','doing','done','skipped')),
  node_ids     TEXT NOT NULL DEFAULT '[]',   -- 这一天练到哪些知识点
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_items_stage       ON plan_items(stage_id);
CREATE INDEX IF NOT EXISTS ix_items_plan        ON plan_items(plan_id);
CREATE INDEX IF NOT EXISTS ix_items_status_date ON plan_items(status, date);
-- 同一天同一序号不允许重复排
CREATE UNIQUE INDEX IF NOT EXISTS ux_item_day ON plan_items(plan_id, ifnull(date,''), sort_order);

-- ------------------------------------------------------- 8. kb_snapshots ★新增
-- 为什么必须加：v3 把「保存同步必须可撤销」列为硬要求。
-- 撤销需要按时间保留多条反向变更集，meta 表只能存一行，装不下。
-- 另外它不该混进业务表，否则「知识库有哪些事实」这件事会被审计记录污染。
CREATE TABLE IF NOT EXISTS kb_snapshots (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  label      TEXT,
  origin     TEXT CHECK (origin IN ('chat','manual','undo')),
  changeset  TEXT NOT NULL,          -- 本次变更集（展示用）
  inverse    TEXT NOT NULL,          -- 反向变更集（撤销时直接执行）
  row_counts TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_snap_created ON kb_snapshots(created_at DESC);

-- ----------------------------------------------------- 9. paper_feedback ★新增
-- 为什么必须加：第二轮要支持「告诉 AI 不喜欢哪篇论文及原因」。
-- 这是"人对某篇论文的逐条判断"，塞进 papers（论文自身的元数据）或
-- evidence（知识点证据）都会污染语义 —— 单独一张表最干净。
CREATE TABLE IF NOT EXISTS paper_feedback (
  id         TEXT PRIMARY KEY,
  arxiv_id   TEXT NOT NULL,
  title      TEXT,
  verdict    TEXT NOT NULL CHECK (verdict IN ('like','dislike','later')),
  reason     TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_paper_feedback ON paper_feedback(arxiv_id);
