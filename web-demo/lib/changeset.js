/**
 * 知识库变更集：校验、SQL 规划、反向变更集
 * ------------------------------------------------------------------
 * 这是整个写库链路的唯一入口，也是安全边界所在。
 *
 * 四条铁律：
 *   1. 表名与列名**只从本文件的 SPEC 白名单里取**，绝不拼接模型给的字符串；
 *      所有值一律走绑定参数（?），没有例外。
 *   2. 结构约束在服务端兜底：`status` 只允许写在 L5 节点上，L1–L4 给了就丢掉并记一条 note。
 *      这条如果只在提示词里要求，模型迟早会违反，而上层状态一旦落库，
 *      聚合逻辑就再也算不回来了。
 *   3. `id` 与所有时间戳由服务端生成，模型给的一律忽略。
 *   4. 同一次变更集 ≤ 50 条语句（D1 单语句绑定参数上限 100，多行 INSERT 会被拆开）。
 *
 * 被三处共用：worker.js（执行）、前端变更卡片（预览与默认勾选）、测试（直接 import）。
 * ------------------------------------------------------------------
 */

import { LEAF_STATUS, CATEGORIES } from './kb-agg.js';

/** 变更集里允许出现的表，以及每张表允许被写的列 */
export const SPEC = {
  domains: {
    label: '领域',
    pk: 'id',
    fields: ['id', 'name', 'name_norm', 'aliases', 'parent_id', 'level', 'arxiv_categories', 'keywords', 'source', 'created_at'],
    json: ['aliases', 'arxiv_categories', 'keywords'],
    ints: ['level'],
    serverOnly: ['id', 'name_norm', 'created_at'],
    required: ['name'],
    touch: ['name', 'aliases', 'parent_id', 'level', 'arxiv_categories', 'keywords', 'source'],
  },
  nodes: {
    label: '知识点',
    pk: 'id',
    fields: ['id', 'parent_id', 'level', 'name', 'name_norm', 'summary', 'category', 'domain_ids',
      'status', 'confidence', 'manual_override', 'source', 'updated_at'],
    json: ['domain_ids'],
    ints: ['level'],
    reals: ['confidence'],
    serverOnly: ['id', 'name_norm', 'updated_at', 'manual_override', 'confidence'],
    required: ['name', 'level', 'category'],
    touch: ['parent_id', 'level', 'name', 'summary', 'category', 'domain_ids', 'status'],
    /** 只允许这几个值 */
    enums: { status: LEAF_STATUS, category: CATEGORIES },
  },
  projects: {
    label: '项目',
    pk: 'id',
    fields: ['id', 'name', 'source', 'source_url', 'description', 'readme', 'languages',
      'file_tree', 'key_files', 'domain_tags', 'analyzed_at', 'created_at'],
    json: ['languages', 'file_tree', 'key_files', 'domain_tags'],
    serverOnly: ['id', 'created_at'],
    required: ['name', 'source'],
    touch: ['name', 'source', 'source_url', 'description', 'readme', 'languages',
      'file_tree', 'key_files', 'domain_tags', 'analyzed_at'],
    enums: { source: ['github', 'manual'] },
  },
  evidence: {
    label: '证据',
    pk: 'id',
    fields: ['id', 'project_id', 'node_id', 'type', 'ref', 'detail', 'created_at'],
    json: [],
    serverOnly: ['id', 'created_at'],
    required: ['node_id', 'type'],
    touch: ['project_id', 'node_id', 'type', 'ref', 'detail'],
    enums: { type: ['code', 'course', 'self_report', 'conversation'] },
  },
  plans: {
    label: '计划',
    pk: 'id',
    fields: ['id', 'title', 'version', 'status', 'target_domain', 'goal', 'summary', 'profile',
      'ratio', 'start_date', 'end_date', 'daily_minutes', 'budget_minutes', 'constraints',
      'excluded', 'resources', 'created_at', 'updated_at'],
    json: ['ratio', 'constraints', 'excluded', 'resources'],
    ints: ['version', 'daily_minutes', 'budget_minutes'],
    serverOnly: ['id', 'created_at', 'updated_at'],
    required: ['title'],
    touch: ['title', 'version', 'status', 'target_domain', 'goal', 'summary', 'profile', 'ratio',
      'start_date', 'end_date', 'daily_minutes', 'budget_minutes', 'constraints', 'excluded', 'resources'],
    enums: { status: ['draft', 'active', 'archived'], profile: ['foundation', 'hybrid', 'research'] },
  },
  plan_stages: {
    label: '阶段',
    pk: 'id',
    fields: ['id', 'plan_id', 'sort_order', 'title', 'start_date', 'end_date', 'description', 'acceptance', 'daily_allocation'],
    json: ['daily_allocation'],
    ints: ['sort_order'],
    serverOnly: ['id'],
    required: ['plan_id', 'title'],
    touch: ['plan_id', 'sort_order', 'title', 'start_date', 'end_date', 'description', 'acceptance', 'daily_allocation'],
  },
  plan_items: {
    label: '每日任务',
    pk: 'id',
    fields: ['id', 'plan_id', 'stage_id', 'sort_order', 'date', 'title', 'resources', 'outcome',
      'reason', 'duration_min', 'status', 'node_ids', 'updated_at'],
    json: ['resources', 'node_ids'],
    ints: ['sort_order', 'duration_min'],
    serverOnly: ['id', 'updated_at'],
    required: ['plan_id', 'stage_id', 'title', 'outcome'],
    touch: ['plan_id', 'stage_id', 'sort_order', 'date', 'title', 'resources', 'outcome',
      'reason', 'duration_min', 'status', 'node_ids'],
    enums: { status: ['todo', 'doing', 'done', 'skipped'] },
  },
};

export const TABLES = Object.keys(SPEC);
export const OPS = ['insert', 'update', 'delete'];

/** 一次变更集最多多少条操作（D1 单语句绑定参数上限 100，这里留足拆句空间） */
export const MAX_ITEMS = 50;

/** 名字归一化：查重靠它，必须与数据库里的 name_norm 列一致 */
export function normalizeName(name) {
  return String(name == null ? '' : name).trim().toLowerCase();
}

/**
 * 默认勾选规则（前端卡片与后端校验共用同一份，避免两边判断不一致）
 *   >= 0.7  勾选
 *   0.6–0.7 勾选，但标注"建议核对"
 *   < 0.6   不勾选，标注"建议你确认"
 */
export function defaultChecked(confidence) {
  const c = Number(confidence);
  if (!Number.isFinite(c)) return { checked: false, hint: '没有置信度，建议你确认' };
  if (c >= 0.7) return { checked: true, hint: '' };
  if (c >= 0.6) return { checked: true, hint: '建议核对' };
  return { checked: false, hint: '建议你确认' };
}

function coerce(spec, col, value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (spec.json.includes(col)) {
    // 已经是字符串就原样透传（前端可能直接给 JSON 文本）
    if (typeof value === 'string') {
      try { JSON.parse(value); return value; } catch { return JSON.stringify([value]); }
    }
    return JSON.stringify(value);
  }
  if (spec.ints.includes(col)) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }
  if ((spec.reals || []).includes(col)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return String(value);
}

/** 读出来的行转回前端友好的形状（JSON 列解析成数组/对象） */
export function fromDbRow(table, row) {
  const spec = SPEC[table];
  if (!spec || !row) return row;
  const out = { ...row };
  for (const col of spec.json) {
    if (typeof out[col] === 'string') {
      try { out[col] = JSON.parse(out[col]); } catch { out[col] = []; }
    }
  }
  return out;
}

/**
 * 校验并规范化模型给出的变更集。
 *
 * @returns {{ops:Array, rejected:Array<{index:number,reason:string}>, notes:string[]}}
 */
export function normalizeChangeset(raw, opts = {}) {
  const maxItems = opts.maxItems || MAX_ITEMS;
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
  const ops = [];
  const rejected = [];
  const notes = [];

  if (!list.length) return { ops, rejected, notes };
  if (list.length > maxItems) {
    notes.push(`本次变更集有 ${list.length} 项，超过单次上限 ${maxItems} 项，已截断`);
  }

  list.slice(0, maxItems).forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      rejected.push({ index, reason: '不是合法对象' });
      return;
    }
    const table = String(item.table || '');
    const op = String(item.op || '').toLowerCase();
    const spec = SPEC[table];

    if (!spec) { rejected.push({ index, reason: `不允许写表 ${JSON.stringify(table)}` }); return; }
    if (!OPS.includes(op)) { rejected.push({ index, reason: `不支持的操作 ${JSON.stringify(op)}` }); return; }

    if (op === 'delete') {
      const id = item.key && item.key[spec.pk];
      if (!id) { rejected.push({ index, reason: 'delete 缺少主键' }); return; }
      ops.push({ op, table, id: String(id), confidence: item.confidence, reason: item.reason || '' });
      return;
    }

    const source = op === 'insert' ? (item.row || {}) : (item.patch || {});
    if (!source || typeof source !== 'object') {
      rejected.push({ index, reason: `${op} 缺少 ${op === 'insert' ? 'row' : 'patch'}` });
      return;
    }

    // 只取白名单里、且不是服务端专属的列
    const values = {};
    for (const col of spec.touch) {
      if (!(col in source)) continue;
      if (spec.serverOnly.includes(col)) continue;
      const v = coerce(spec, col, source[col]);
      if (v === undefined) continue;
      if (v === '' && spec.json.includes(col)) continue;
      values[col] = v;
    }

    // 枚举白名单
    for (const [col, allowed] of Object.entries(spec.enums || {})) {
      if (col in values && values[col] !== null && !allowed.includes(values[col])) {
        rejected.push({ index, reason: `${col} 只能是 ${allowed.join(' / ')}，收到 ${JSON.stringify(values[col])}` });
        return;
      }
    }

    // ★ 结构约束兜底：状态只能挂在 L5 知识点上
    if (table === 'nodes' && 'status' in values) {
      const lv = op === 'update' ? values.level : values.level;
      // update 时不带 level 就查不出层次，交给 worker 用 before 行兜底（见 applyLevelGuard）
      if (lv !== undefined && Number(lv) !== 5) {
        delete values.status;
        notes.push(`「${values.name || '该项'}」是 L${lv}，上层状态由子节点聚合，已忽略它带来的 status`);
      }
    }

    if (op === 'update') {
      const key = item.key || {};
      const id = key[spec.pk];
      if (!id) { rejected.push({ index, reason: 'update 缺少主键' }); return; }
      if (!Object.keys(values).length) { rejected.push({ index, reason: 'update 没有任何可写字段' }); return; }
      ops.push({
        op, table, id: String(id), values,
        confidence: item.confidence, reason: item.reason || '',
      });
      return;
    }

    // insert：补齐必填
    for (const col of spec.required) {
      if (!(col in values) || values[col] === null || values[col] === '') {
        rejected.push({ index, reason: `insert 缺少必填字段 ${col}` });
        return;
      }
    }
    ops.push({
      op, table, values,
      confidence: item.confidence, reason: item.reason || '',
      // 查重用的候选键，worker 会拿它去数据库里查有没有同名兄弟
      dedupeKey: dedupeKeyOf(table, values),
    });
  });

  return { ops, rejected, notes };
}

/** 同一父节点下同名 = 重复。返回用于查重的条件，没有则返回 null */
export function dedupeKeyOf(table, values) {
  if (table === 'nodes') {
    return { parent_id: values.parent_id || null, name_norm: normalizeName(values.name) };
  }
  if (table === 'domains') {
    return { level: values.level || 1, name_norm: normalizeName(values.name) };
  }
  if (table === 'projects' && values.source_url) {
    return { source_url: values.source_url };
  }
  return null;
}

/**
 * update 时如果没带 level，用数据库里已有的行来判定层次，
 * 决定 status 到底允不允许写。返回 true 表示该字段被丢弃。
 */
export function applyLevelGuard(table, values, before) {
  if (table !== 'nodes' || !('status' in values)) return false;
  const lv = before ? Number(before.level) : Number(values.level);
  if (Number.isFinite(lv) && lv !== 5) {
    delete values.status;
    return true;
  }
  return false;
}

/** 造一条 INSERT 语句（列名全部来自白名单） */
export function sqlInsert(table, row) {
  const spec = SPEC[table];
  const cols = spec.fields.filter((c) => c in row);
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  return { sql, params: cols.map((c) => row[c]) };
}

/** 造一条 UPDATE 语句 */
export function sqlUpdate(table, id, values) {
  const spec = SPEC[table];
  const cols = spec.fields.filter((c) => c in values && c !== spec.pk);
  if (!cols.length) return null;
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(',')} WHERE ${spec.pk}=?`;
  return { sql, params: [...cols.map((c) => values[c]), id] };
}

export function sqlDelete(table, id) {
  return { sql: `DELETE FROM ${table} WHERE ${SPEC[table].pk}=?`, params: [id] };
}

/** 造一条 SELECT（读旧行用于生成反向变更） */
export function sqlSelectByPk(table, id) {
  return { sql: `SELECT * FROM ${table} WHERE ${SPEC[table].pk}=?`, params: [id] };
}

export function sqlSelectDedupe(table, key) {
  const cols = Object.keys(key);
  return {
    sql: `SELECT * FROM ${table} WHERE ${cols.map((c) => `${c} IS ?`).join(' AND ')} LIMIT 1`,
    params: cols.map((c) => key[c]),
  };
}

/**
 * 为一条操作生成「正向语句 + 反向语句」。
 *
 * @param {object} op        normalizeChangeset 产出的操作
 * @param {object} ctx       { before, now, newId, conflict }
 *   before   —— 该主键当前的行（update / delete 必传，insert 传 null）
 *   conflict —— insert 时已存在的同名行（用于"已存在就跳过"）
 */
export function planOp(op, ctx) {
  const spec = SPEC[op.table];
  const now = ctx.now;
  const newId = ctx.newId;

  if (op.op === 'insert') {
    if (ctx.conflict) {
      return { action: 'skip', table: op.table, id: ctx.conflict[spec.pk], reason: '已存在同名条目，跳过' };
    }
    const row = { ...op.values };
    if (!row[spec.pk]) row[spec.pk] = newId;
    if (spec.fields.includes('name_norm')) row.name_norm = normalizeName(row.name);
    if (spec.fields.includes('created_at')) row.created_at = now;
    if (spec.fields.includes('updated_at')) row.updated_at = now;
    if (spec.fields.includes('source') && !row.source) row.source = 'ai_inferred';
    if (spec.fields.includes('manual_override')) row.manual_override = 0;
    return {
      action: 'insert', table: op.table, id: row[spec.pk], row,
      forward: [sqlInsert(op.table, row)],
      inverse: [sqlDelete(op.table, row[spec.pk])],
    };
  }

  if (op.op === 'update') {
    if (!ctx.before) return { action: 'skip', table: op.table, id: op.id, reason: '要修改的条目不存在' };
    const values = { ...op.values };
    if (spec.fields.includes('updated_at')) values.updated_at = now;
    // 用户手改过状态 → 标记 manual_override，聚合时不覆盖它
    if (op.table === 'nodes' && 'status' in values && Number(ctx.before.level) === 5) {
      values.manual_override = 1;
    }
    if ('name' in values && spec.fields.includes('name_norm')) values.name_norm = normalizeName(values.name);
    const forward = sqlUpdate(op.table, op.id, values);
    if (!forward) return { action: 'skip', table: op.table, id: op.id, reason: '没有可写字段' };
    // 反向：把 before 里的**所有**列原样写回，而不是只回填 touch 里的列。
    // 为什么：正向写入会顺带改 updated_at 和 manual_override（这两个不在 touch 里），
    // 如果反向只恢复 touch，撤销之后 manual_override 会永远停在 1 ——
    // 那条记录从此被标记成"用户亲手改过"，聚合时不再被覆盖，而实际上改动已经被撤销了。
    // 实测过：只回填 touch 时，撤销后 manual_override 仍是 1。
    const backValues = {};
    for (const col of spec.fields) {
      if (col === spec.pk) continue;
      if (col in ctx.before) backValues[col] = ctx.before[col];
    }
    const inverse = sqlUpdate(op.table, op.id, backValues);
    return {
      action: 'update', table: op.table, id: op.id, before: ctx.before, values,
      forward: [forward], inverse: inverse ? [inverse] : [],
    };
  }

  if (op.op === 'delete') {
    if (!ctx.before) return { action: 'skip', table: op.table, id: op.id, reason: '要删除的条目不存在' };
    return {
      action: 'delete', table: op.table, id: op.id, before: ctx.before,
      forward: [{ sql: `DELETE FROM ${op.table} WHERE ${spec.pk}=?`, params: [op.id] }],
      inverse: [sqlInsert(op.table, ctx.before)],
    };
  }

  return { action: 'skip', table: op.table, id: op.id, reason: '未知操作' };
}

/** 把若干次 planOp 的结果汇成「一次原子写入」所需的全部语句 */
export function assembleBatch(planned, extras = []) {
  const forward = [];
  const inverse = [];
  const applied = [];
  const skipped = [];
  for (const p of planned) {
    if (!p || p.action === 'skip') { if (p) skipped.push({ table: p.table, id: p.id, reason: p.reason }); continue; }
    forward.push(...p.forward);
    inverse.push(...p.inverse);
    applied.push({ action: p.action, table: p.table, id: p.id });
  }
  return { forward: [...forward, ...extras], inverse, applied, skipped };
}

/** 给变更卡片用的短标签，例：新增 知识点「二叉树」 */
export function describeOp(op) {
  const spec = SPEC[op.table] || {};
  const verb = { insert: '新增', update: '修改', delete: '删除' }[op.op] || op.op;
  const name = (op.values && (op.values.name || op.values.title)) || op.before && (op.before.name || op.before.title) || op.id || '';
  return `${verb} ${spec.label || op.table}${name ? '「' + name + '」' : ''}`;
}
