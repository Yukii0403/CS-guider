/**
 * 知识库 → 提示词的注入摘要
 * ------------------------------------------------------------------
 * 知识库会长到上百个知识点，**整库塞进 system prompt 一定会把上下文撑爆**。
 * 所以每次对话只做一次检索，注入命中的那几十条，并明确告诉模型"这是检索结果，不是全量"。
 *
 * 检索两路召回：
 *   · 结构路：关键词命中领域树 → 取领域 id → 命中带该 domain_ids 的节点
 *   · 文本路：逐关键词对 名称 / 摘要 做 LIKE
 *
 * 纯函数、无 IO、无 DOM，被 worker.js 与测试共用。
 * SQL 由调用方执行 —— 本模块只负责「怎么挑」和「怎么写成一段话」。
 * ------------------------------------------------------------------
 */

/** 中文与英文的常见虚词。只做粗过滤，不追求完备 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'you', 'your', 'can',
  'what', 'how', 'why', 'not', 'but', 'all', 'any', 'how', 'help', 'want', 'need', 'please',
  'i', 'me', 'my', 'we', 'it', 'is', 'of', 'to', 'in', 'on', 'at', 'as', 'by', 'or', 'if',
  '帮我', '我想', '我要', '一下', '怎么', '什么', '哪些', '可以', '应该', '需要', '就是',
  '这个', '那个', '现在', '然后', '还有', '但是', '因为', '所以', '如果', '还是', '已经',
  '我们', '你们', '他们', '自己', '知道', '觉得', '可能', '有点', '比较', '非常', '真的',
]);

/** LIKE 模式最长 50 字节（D1 硬限），中文一个字 3 字节，所以关键词长度要卡住 */
const MAX_PATTERN_BYTES = 50;
const MAX_KEYWORDS = 12;

const CJK = /[\u4e00-\u9fff]/;

/**
 * UTF-8 字节数。Cloudflare Workers 里不一定有 Buffer（取决于 nodejs_compat），
 * 所以用 TextEncoder —— 它在 Worker、浏览器、Node 三处都有。
 */
const ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
function byteLength(s) {
  if (ENCODER) return ENCODER.encode(s).length;
  let n = 0;
  for (const ch of s) n += ch.codePointAt(0) > 127 ? 3 : 1;
  return n;
}

/** 关键词长度超过上限时截断，保证 '%kw%' 不超 50 字节 */
export function clampPattern(kw) {
  let s = String(kw == null ? '' : kw);
  while (byteLength('%' + s + '%') > MAX_PATTERN_BYTES && s.length > 1) {
    s = s.slice(0, -1);
  }
  return s;
}

/**
 * 从用户最近的几句话里抽出检索关键词。
 * 中文切 2-gram（对 LIKE 足够，也不需要分词库），英文按词切。
 */
export function extractKeywords(text, opts = {}) {
  const max = opts.max || MAX_KEYWORDS;
  const src = String(text == null ? '' : text).toLowerCase();
  const out = [];
  const seen = new Set();

  const push = (w) => {
    const s = w.trim();
    if (!s || s.length < 2) return;
    if (STOPWORDS.has(s)) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  // 英文/数字词
  for (const w of src.match(/[a-z][a-z0-9+#._-]{2,}/g) || []) push(w);

  // 中文 2-gram（按连续汉字串切，跨标点不组词）
  for (const run of src.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    for (let i = 0; i + 2 <= run.length; i++) push(run.slice(i, i + 2));
  }

  // 长词优先：短的如果被长的包含就丢掉，减少冗余召回
  const kept = out.filter((w) => !out.some((o) => o !== w && o.length > w.length && o.includes(w)));
  return (kept.length ? kept : out).slice(0, max);
}

/** 生成 LIKE 用的参数 */
export function likePatterns(keywords) {
  return (keywords || []).map((k) => '%' + clampPattern(k) + '%').filter((p) => p.length > 2);
}

/** 状态优先级：要先看到"该复习的"和"正在学的"，最后才是"已掌握的" */
const STATUS_WEIGHT = { review: 3, learning: 2, untouched: 1, mastered: 0 };

function hitScore(node, keywords) {
  const name = String(node.name || '').toLowerCase();
  const summary = String(node.summary || '').toLowerCase();
  let hits = 0;
  for (const k of keywords) {
    if (name.includes(k)) hits += 3;
    else if (summary.includes(k)) hits += 1;
  }
  return hits;
}

/**
 * 给候选节点排序并裁剪。
 *
 * @param {Array} nodes     候选节点（已由 SQL 粗筛过）
 * @param {string[]} keywords
 * @returns {{leafHits:Array, upperHits:Array}}
 */
export function rankNodes(nodes, keywords, opts = {}) {
  const maxLeaf = opts.maxLeaf || 30;
  const maxUpper = opts.maxUpper || 10;

  const scored = (nodes || []).map((n) => {
    const hits = hitScore(n, keywords);
    const sw = STATUS_WEIGHT[n.status] !== undefined ? STATUS_WEIGHT[n.status] : (n.status ? 1 : 0);
    return { node: n, score: hits * 10 + sw, hits };
  });

  // 至少要沾一个关键词才进摘要，否则宁可注入"无命中"也不编画像
  const relevant = scored.filter((s) => s.hits > 0);
  const byScore = (a, b) => b.score - a.score || String(a.node.name).localeCompare(String(b.node.name));

  const leaf = relevant.filter((s) => Number(s.node.level) >= 4).sort(byScore).slice(0, maxLeaf);
  const upper = relevant.filter((s) => Number(s.node.level) < 4).sort(byScore).slice(0, maxUpper);

  return { leafHits: leaf.map((s) => s.node), upperHits: upper.map((s) => s.node) };
}

/** 从关键词里认出用户在说哪个领域（命中领域树的名字或别名） */
export function matchDomains(domains, keywords) {
  const kws = (keywords || []).map((k) => String(k).toLowerCase());
  const out = [];
  for (const d of domains || []) {
    const pool = [d.name, ...(d.aliases || []), ...(d.keywords || [])].map((x) => String(x).toLowerCase());
    const hit = kws.some((k) => pool.some((p) => p && (p.includes(k) || k.includes(p))));
    if (hit) out.push(d);
  }
  return out;
}

function pathOf(node, byId) {
  const parts = [];
  let cur = node;
  let guard = 0;
  while (cur && guard++ < 6) {
    parts.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return parts.join(' › ');
}

const STATUS_TAG = {
  untouched: '未接触', learning: '学习中', mastered: '已掌握', review: '需复习',
};

/**
 * 渲染注入用的摘要文本。**零命中时返回空串**，由调用方注入"未命中"提示 ——
 * 这里绝不返回一段看起来像画像的编造内容。
 *
 * @param {object} input
 *   hits       rankNodes 的结果
 *   allNodes   全部节点（算路径与总数用）
 *   extraNodes 结构路召回的节点（按 domain_ids 命中）
 *   domains    命中的领域
 *   plan       当前激活的计划（可为 null）
 *   syncedAt   知识库最后同步时间
 *   today      YYYY-MM-DD
 */
export function renderContextSummary(input) {
  const {
    hits = { leafHits: [], upperHits: [] },
    allNodes = [],
    domains = [],
    plan = null,
    syncedAt = '',
    today = '',
  } = input;

  const byId = new Map((allNodes || []).map((n) => [n.id, n]));
  const leaf = hits.leafHits || [];
  const upper = hits.upperHits || [];
  if (!leaf.length && !upper.length && !domains.length) return '';

  const lines = [];
  lines.push('## 用户知识库摘要（系统自动检索，不是全量）');
  lines.push(
    `同步时间：${syncedAt || '未知'}｜知识库共 ${allNodes.length} 个节点，本次命中 ${leaf.length + upper.length} 个` +
    (today ? `｜今天 ${today}` : '')
  );

  if (domains.length) {
    lines.push('相关领域：' + domains.map((d) => d.name).join('、'));
  }

  // 按一级分类统计命中分布，帮模型判断"这个人偏工程还是偏理论"
  const catCount = {};
  for (const n of [...leaf, ...upper]) catCount[n.category] = (catCount[n.category] || 0) + 1;
  const catLine = Object.entries(catCount).map(([k, v]) => `${k} ${v}`).join(' / ');
  if (catLine) lines.push('命中分布：' + catLine);

  if (upper.length) {
    lines.push('学科骨架（用户正在这个范围内的方向）：');
    for (const n of upper) lines.push(`- L${n.level} ${pathOf(n, byId)}`);
  }

  if (leaf.length) {
    lines.push('命中的知识点（按相关度，状态来自证据或用户自评）：');
    for (const n of leaf) {
      const tag = STATUS_TAG[n.status] || '未评估';
      const conf = n.confidence != null ? `，置信度 ${n.confidence}` : '';
      const sum = n.summary ? `：${n.summary}` : '';
      lines.push(`- [${tag}] ${pathOf(n, byId)}${sum}（等级 L${n.level}${conf}）`);
    }
  }

  if (plan) {
    lines.push(
      `当前计划：${plan.profile || '未定形态'} ${plan.start_date || '?'} → ${plan.end_date || '?'}` +
      (plan.goal ? `，目标「${plan.goal}」` : '')
    );
  }

  lines.push('');
  lines.push('使用要求：以上是"自评 + 证据"的汇总，不是事实。不要复述这份摘要；');
  lines.push('不要把摘要里没有的项说成用户已掌握；需要确认时直接问他，而不是替他断定。');

  return lines.join('\n');
}

/** 零命中时的提示 —— 明确说明"没有画像"，避免模型自由发挥 */
export function renderNoHitNote(totalNodes) {
  return [
    '## 用户知识库摘要',
    `知识库有 ${totalNodes || 0} 个节点，但**本次检索没有命中任何与当前话题相关的条目**。`,
    '',
    '这意味着你对这个用户目前一无所知。不要假设他的水平，',
    '需要背景信息时用一句具体的问题问他（比如"你之前跑过训练循环吗"），而不是猜。',
  ].join('\n');
}
