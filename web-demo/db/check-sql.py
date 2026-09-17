#!/usr/bin/env python3
"""
校验 db/schema.sql 与 db/seed.sql：能不能跑、跑完数据对不对、以及会不会撞上 D1 的硬限。

为什么用 Python：sqlite3 是 Python 标准库，本机直接可用；Node 没有内置 SQLite。
这只是开发期的校验脚本，不参与部署。

用法（在 web-demo/ 下）：
    python db/check-sql.py

退出码：0 = 全部通过；1 = 有失败项
"""
import json
import os
import re
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(HERE, 'schema.sql')
SEED = os.path.join(HERE, 'seed.sql')

# D1 官方硬限
MAX_BOUND_PARAMS = 100      # 单条语句的绑定参数上限
MAX_STATEMENT_BYTES = 102400  # 单条语句 100 KB

failed = 0


def ok(cond, label, extra=''):
    global failed
    print(('  PASS  ' if cond else '  FAIL  ') + label + (('   ' + extra) if extra else ''))
    if not cond:
        failed += 1


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


# ============================================================ 1. 静态检查
print('\n[SQL 静态检查：会不会撞上 D1 的硬限]')

for name, path in (('schema.sql', SCHEMA), ('seed.sql', SEED)):
    sql = read(path)
    stmts = [s.strip() for s in sql.split(';') if s.strip() and not s.strip().startswith('--')]
    too_big = [s[:60] for s in stmts if len(s.encode('utf-8')) > MAX_STATEMENT_BYTES]
    ok(not too_big, f'{name} 没有超过 100KB 的单条语句', f'({len(stmts)} 条语句)')

# 逐条检查多行 INSERT 的绑定参数数量（列数 × 行数 必须 <= 100）
over = []
for m in re.finditer(r'INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES(.*?);', read(SEED), re.S | re.I):
    table, cols, body = m.group(1), m.group(2), m.group(3)
    ncols = len([c for c in cols.split(',') if c.strip()])
    # 每行都写成从行首开始的元组，用行首的 ( 计数最稳（字段值里可能出现括号）
    rows = len(re.findall(r'^\s*\(', body, re.M))
    if ncols * rows > MAX_BOUND_PARAMS:
        over.append(f'{table}: {ncols} 列 × {rows} 行 = {ncols * rows}')
ok(not over, '每条多行 INSERT 的绑定参数都不超过 100', ('  → ' + '; '.join(over)) if over else '')

# ============================================================ 2. 真的跑一遍
print('\n[实际执行：schema + seed]')

con = sqlite3.connect(':memory:')
try:
    con.executescript(read(SCHEMA))
    ok(True, 'schema.sql 执行成功')
except sqlite3.Error as e:
    ok(False, 'schema.sql 执行失败', str(e))
    sys.exit(1)

try:
    con.executescript(read(SEED))
    ok(True, 'seed.sql 执行成功')
except sqlite3.Error as e:
    ok(False, 'seed.sql 执行失败', str(e))
    sys.exit(1)

# 再跑一次，验证幂等（部署脚本可能被重复执行）
try:
    con.executescript(read(SEED))
    ok(True, 'seed.sql 可重复执行（幂等）')
except sqlite3.Error as e:
    ok(False, 'seed.sql 重复执行会报错', str(e))

# ============================================================ 3. 数据正确性
print('\n[数据正确性]')

tables = [r[0] for r in con.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
expect_tables = {'domains', 'nodes', 'projects', 'evidence', 'plans', 'plan_stages',
                 'plan_items', 'kb_snapshots', 'paper_feedback', 'meta'}
ok(expect_tables.issubset(set(tables)), '九张业务表 + meta 都存在',
   f'({len(tables)} 张：{", ".join(tables)})')

n_domains = con.execute('SELECT count(*) FROM domains').fetchone()[0]
ok(n_domains == 10, '领域树第一层 10 个节点', f'(实际 {n_domains})')

by_level = dict(con.execute('SELECT level, count(*) FROM nodes GROUP BY level').fetchall())
total = sum(by_level.values())
ok(total > 60, '知识树骨架已种入', f'(共 {total} 个节点，分布 {dict(sorted(by_level.items()))})')
ok(all(1 <= lv <= 5 for lv in by_level), '节点层级都在 1–5 之间')

# 结构一致性：每个节点的 level 必须等于父节点 level + 1
bad_level = con.execute('''
  SELECT c.id, c.level, p.level FROM nodes c JOIN nodes p ON c.parent_id = p.id
  WHERE c.level != p.level + 1''').fetchall()
ok(not bad_level, '子节点层级 = 父节点层级 + 1', str(bad_level[:3]) if bad_level else '')

# 没有孤儿节点
orphans = con.execute('''
  SELECT id FROM nodes WHERE parent_id IS NOT NULL
  AND parent_id NOT IN (SELECT id FROM nodes)''').fetchall()
ok(not orphans, '没有指向不存在父节点的孤儿节点', str(orphans[:3]) if orphans else '')

# 一级节点必须没有 parent，且只有 5 个（五个一级分类不可改）
l1 = con.execute('SELECT name FROM nodes WHERE level=1 ORDER BY name').fetchall()
ok(len(l1) == 5 and con.execute(
    'SELECT count(*) FROM nodes WHERE level=1 AND parent_id IS NOT NULL').fetchone()[0] == 0,
   '一级分类恰好 5 个且都没有父节点', f'({", ".join(r[0] for r in l1)})')

# 每个节点的 category 必须与它所在的一级分类一致
bad_cat = con.execute('''
  WITH RECURSIVE up(id, root) AS (
    SELECT id, id FROM nodes WHERE parent_id IS NULL
    UNION ALL
    SELECT n.id, up.root FROM nodes n JOIN up ON n.parent_id = up.id
  )
  SELECT n.id, n.category, r.name FROM nodes n
  JOIN up ON n.id = up.id JOIN nodes r ON up.root = r.id
  WHERE n.category != r.name''').fetchall()
ok(not bad_cat, '每个节点的 category 与所属一级分类一致', str(bad_cat[:3]) if bad_cat else '')

# 同一父节点下不允许重名（唯一索引已保证，这里验它真的生效）
dup = con.execute('''
  SELECT ifnull(parent_id,'') p, name_norm, count(*) c FROM nodes
  GROUP BY p, name_norm HAVING c > 1''').fetchall()
ok(not dup, '同一父节点下没有重名节点', str(dup[:3]) if dup else '')

# 唯一索引确实挡得住重复插入
try:
    con.execute("INSERT INTO nodes(id,parent_id,level,name,name_norm,category,updated_at) "
                "VALUES('dup_test','n_code_ds_sort_basic',5,'二分查找','二分查找','编程基础','x')")
    ok(False, '重复节点应被唯一索引拒绝，但插进去了')
except sqlite3.IntegrityError:
    ok(True, '重复节点会被数据库直接拒绝（查重不靠 AI 自觉）')

# L5 必须有 status 字段可用，但种子里不允许预置状态
n_status = con.execute('SELECT count(*) FROM nodes WHERE status IS NOT NULL').fetchone()[0]
ok(n_status == 0, '种子里没有任何预置的掌握状态（状态必须由证据产生）')
n_l5 = con.execute('SELECT count(*) FROM nodes WHERE level=5').fetchone()[0]
ok(n_l5 >= 30, 'L5 知识点数量足够做检索演示', f'({n_l5} 个)')

# status 白名单真的生效
try:
    con.execute("UPDATE nodes SET status='精通' WHERE id='n_math_la_svd'")
    ok(False, '非法 status 应被 CHECK 拒绝')
except sqlite3.IntegrityError:
    ok(True, 'status 只能取白名单里的值（未接触/学习中/已掌握/需复习）')

n_cat = con.execute(
    "SELECT count(*) FROM nodes WHERE category NOT IN "
    "('数学基础','编程基础','理论基础','工具基础','科研素养')").fetchone()[0]
ok(n_cat == 0, 'category 全部落在五个一级分类里')

# 元信息
keys = [r[0] for r in con.execute('SELECT key FROM meta ORDER BY key').fetchall()]
ok('synced_at' in keys and 'schema_version' in keys, 'meta 里有 synced_at 与 schema_version', f'({keys})')

# 领域树的 arxiv_categories 必须能解析成非空数组（第二轮抓论文要用）
bad_json = []
for did, cats in con.execute('SELECT id, arxiv_categories FROM domains').fetchall():
    try:
        v = json.loads(cats)
        if not isinstance(v, list) or not v:
            bad_json.append(did)
    except json.JSONDecodeError:
        bad_json.append(did)
ok(not bad_json, '每个领域都有可用的 arXiv 分类（第二轮抓取用）', str(bad_json) if bad_json else '')

# 索引是否真的建起来了
idx = [r[0] for r in con.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").fetchall()]
need = ['ux_domains_norm', 'ux_nodes_sibling', 'ux_evidence_dup', 'ix_nodes_status', 'ux_item_day']
missing = [i for i in need if i not in idx]
ok(not missing, '关键索引都已建立', f'(共 {len(idx)} 个)' + (f' 缺 {missing}' if missing else ''))

print('\n' + ('全部通过。' if failed == 0 else f'{failed} 项失败。') + '\n')
sys.exit(0 if failed == 0 else 1)
