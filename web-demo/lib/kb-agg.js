/**
 * 知识树状态聚合
 * ------------------------------------------------------------------
 * v3 的硬规则：status 只挂最细的知识点层（L5），上层由子节点聚合算出。
 * 一旦允许上层直接改状态，下层和上层必然互相矛盾。
 *
 * 这个模块是纯函数，被三处共用：
 *   · worker.js   —— 读知识库时附上聚合结果
 *   · 前端知识库页 —— 渲染上层节点时直接用
 *   · 测试        —— 直接 import，不经过任何 IO
 *
 * 阈值来自文档：mastered 占比 ≥ 0.8 → 已掌握；≥ 0.2 → 学习中；否则 未开始。
 * 唯一需要拍板的地方是「L5 的分值映射」（见 SCORE），已在文档里标注。
 * ------------------------------------------------------------------
 */

/** L5 的四种状态，与数据库 CHECK 约束一一对应 */
export const LEAF_STATUS = ['untouched', 'learning', 'mastered', 'review'];

/** 中文标签，给界面用 */
export const STATUS_LABEL = {
  untouched: '未接触',
  learning: '学习中',
  mastered: '已掌握',
  review: '需复习',
  // 以下三个只出现在 L1–L4 的聚合结果里，不会写进数据库
  locked: '未开始',
};

/** 五个一级分类固定，不可改（结构归开发者） */
export const CATEGORIES = ['数学基础', '编程基础', '理论基础', '工具基础', '科研素养'];

/**
 * L5 状态 → 分值。
 *
 * 0.8 / 0.2 两个阈值来自 v3 文档；但文档只说了「mastered 占比」，
 * 没定义"学习中"该算几分。这里取 0.5，理由是：
 *   · 算 0 会让"学过一半"和"完全没学"看起来一样，缺口分析就失效了；
 *   · 算 1 会让"学过"直接顶到已掌握，比自评还激进。
 * 0.5 是唯一能同时避免这两种失真的取值。**要改就改这里，别改阈值。**
 */
export const SCORE = { untouched: 0, learning: 0.5, mastered: 1, review: 1 };

export const MASTERED_THRESHOLD = 0.8;
export const LEARNING_THRESHOLD = 0.2;

/**
 * 把平均得分映射成上层节点的聚合状态。
 * 注意返回值可能是 `locked`，它不是 L5 的合法状态，只用于显示。
 */
export function statusFromScore(score, childCount) {
  if (!childCount) return 'locked';
  if (score >= MASTERED_THRESHOLD) return 'mastered';
  if (score >= LEARNING_THRESHOLD) return 'learning';
  return 'locked';
}

function emptyCounts() {
  return { untouched: 0, learning: 0, mastered: 0, review: 0, none: 0 };
}

/**
 * 自底向上算出每个节点的聚合结果。
 *
 * @param {Array<{id:string,parent_id:string|null,level:number,status?:string,
 *                manual_override?:number,name?:string}>} nodes 全部节点
 * @returns {Map<string, {
 *   status:string,            // 聚合状态；L5 就是它自己的 status（没有则 untouched）
 *   score:number,             // 0–1，上层节点的平均得分
 *   childCount:number,        // 参与聚合的直接子节点数
 *   counts:object,            // 直接子节点里各状态的个数（只对 L4 有意义）
 *   overridden:boolean        // 是否被手改覆盖
 * }>}
 */
export function buildAggregates(nodes) {
  const byId = new Map();
  const childrenOf = new Map();

  for (const n of nodes || []) {
    if (!n || !n.id) continue;
    byId.set(n.id, n);
    const p = n.parent_id || '';
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(n);
  }

  const result = new Map();
  // 按 level 从细到粗处理，保证算父节点时子节点已经有结果
  const levels = [...new Set([...byId.values()].map((n) => n.level))].sort((a, b) => b - a);

  for (const lv of levels) {
    for (const n of byId.values()) {
      if (n.level !== lv) continue;
      const kids = childrenOf.get(n.id) || [];

      let score, counts, childCount;

      if (lv === 5 || !kids.length) {
        // 叶子，或者没有子节点的中间层：直接用自己的状态
        score = SCORE[n.status] !== undefined ? SCORE[n.status] : 0;
        counts = emptyCounts();
        childCount = 0;
        if (n.status) counts[n.status] = 1;
      } else {
        counts = emptyCounts();
        let sum = 0;
        for (const k of kids) {
          const agg = result.get(k.id);
          if (!agg) continue;
          sum += agg.score;
          // 统计直接子节点落在哪个桶：L5 用真实状态，上层用聚合状态
          const bucket = k.level === 5 ? (k.status || 'none') : agg.status;
          counts[bucket] = (counts[bucket] || 0) + 1;
        }
        childCount = kids.length;
        score = childCount ? sum / childCount : 0;
      }

      const overridden = lv !== 5 && Number(n.manual_override) === 1;
      const computed = lv === 5 || !kids.length
        ? (n.status || 'untouched')
        : statusFromScore(score, childCount);

      result.set(n.id, {
        status: computed,
        score,
        childCount,
        counts,
        overridden,
      });
    }
  }

  return result;
}

/** 按一级分类统计节点数与平均得分，给知识库页顶部的分布条用 */
export function summarizeByCategory(nodes, aggregates) {
  const out = new Map(CATEGORIES.map((c) => [c, { category: c, total: 0, l5: 0, learned: 0, score: 0 }]));
  for (const n of nodes || []) {
    const row = out.get(n.category);
    if (!row) continue;
    row.total++;
    if (n.level === 5) {
      row.l5++;
      const agg = aggregates.get(n.id);
      const sc = agg ? agg.score : 0;
      row.score += sc;
      if (sc > 0) row.learned++;
    }
  }
  return [...out.values()].map((r) => ({
    ...r,
    // 百分比只按 L5 算，否则分类里塞几层空壳就会把分母做大
    percent: r.l5 ? Math.round((r.score / r.l5) * 100) : 0,
  }));
}

/**
 * 找出"缺口"：目标领域下有证据链、但完全没有状态的知识点。
 * 学习路线的起点应该是这些，而不是所有未掌握的点。
 */
export function findGaps(nodes, domainIds) {
  const wanted = new Set(domainIds || []);
  if (!wanted.size) return [];
  return (nodes || []).filter(
    (n) => n.level === 5 && (n.domain_ids || []).some((d) => wanted.has(d)) &&
      (!n.status || n.status === 'untouched')
  );
}

/** 供显示用的短标签；未知状态原样返回，不吞掉信息 */
export function labelOf(status) {
  return STATUS_LABEL[status] || status || STATUS_LABEL.untouched;
}
