/**
 * 知识库核心逻辑测试
 * 运行：node test/kb.test.mjs
 *
 * 这三块逻辑出事的方式都很隐蔽：
 *   · 聚合阈值差一点 → 上层状态全错，但页面看起来"挺正常"
 *   · 变更集校验漏一条 → 模型可以往 L1–L4 写状态，聚合从此算不回来
 *   · 检索没过滤零命中 → 模型开始凭关键词编用户画像
 * 所以这里逐条钉死，而不是靠"看起来对"。
 */
import { LEAF_STATUS, CATEGORIES, SCORE, statusFromScore, buildAggregates,
  summarizeByCategory, findGaps, labelOf } from '../lib/kb-agg.js';
import { SPEC, TABLES, MAX_ITEMS, normalizeChangeset, normalizeName, defaultChecked,
  dedupeKeyOf, fromDbRow, planOp, assembleBatch, sqlSelectDedupe, describeOp }
  from '../lib/changeset.js';
import { extractKeywords, clampPattern, likePatterns, rankNodes, matchDomains,
  renderContextSummary, renderNoHitNote } from '../lib/kb-context.js';
import { splitBlocks, parseBlockJSON } from '../lib/blocks.js';

let failed = 0;
function ok(cond, label, extra = '') {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra ? '   ' + extra : ''));
  if (!cond) failed++;
}
const eq = (a, b, label) => ok(a === b, label, a === b ? '' : `期望 ${JSON.stringify(b)}，得到 ${JSON.stringify(a)}`);

/* ======================================================== 1. 状态聚合 */
console.log('\n[状态聚合：阈值与多级传播]');

eq(statusFromScore(0.8, 5), 'mastered', '0.80 → 已掌握（含边界）');
eq(statusFromScore(0.79, 5), 'learning', '0.79 → 学习中');
eq(statusFromScore(0.2, 5), 'learning', '0.20 → 学习中（含边界）');
eq(statusFromScore(0.19, 5), 'locked', '0.19 → 未开始');
eq(statusFromScore(0, 0), 'locked', '没有子节点 → 未开始，不会除零');
eq(SCORE.learning, 0.5, 'L5「学习中」记 0.5 分（唯一需要拍板的一处）');
ok(LEAF_STATUS.length === 4, 'L5 只有四种状态');
ok(CATEGORIES.length === 5, '一级分类固定五个');
ok(!LEAF_STATUS.includes('locked'), 'locked 不是 L5 的合法状态（它只出现在聚合结果里）');

// 三棵子树分别制造 mastered / learning / locked 三种结果
const TREE = [
  { id: 'a', parent_id: null, level: 1, category: '理论基础' },
  { id: 'b', parent_id: 'a', level: 2, category: '理论基础' },
  { id: 'c', parent_id: 'b', level: 3, category: '理论基础' },
  { id: 'd1', parent_id: 'c', level: 4, category: '理论基础' },
  { id: 'd2', parent_id: 'c', level: 4, category: '理论基础' },
  { id: 'd3', parent_id: 'c', level: 4, category: '理论基础' },
  { id: 'e1', parent_id: 'd1', level: 5, category: '理论基础', status: 'mastered', domain_ids: ['multimodal'] },
  { id: 'e2', parent_id: 'd1', level: 5, category: '理论基础', status: 'mastered' },
  { id: 'e3', parent_id: 'd1', level: 5, category: '理论基础', status: 'mastered' },
  { id: 'e4', parent_id: 'd1', level: 5, category: '理论基础', status: 'review' },
  { id: 'e5', parent_id: 'd1', level: 5, category: '理论基础', status: 'learning' },
  { id: 'e6', parent_id: 'd2', level: 5, category: '理论基础', status: 'mastered' },
  { id: 'e7', parent_id: 'd2', level: 5, category: '理论基础', status: 'learning' },
  { id: 'e8', parent_id: 'd2', level: 5, category: '理论基础', domain_ids: ['multimodal'] },
  { id: 'e9', parent_id: 'd2', level: 5, category: '理论基础' },
  { id: 'e10', parent_id: 'd2', level: 5, category: '理论基础' },
  { id: 'e11', parent_id: 'd3', level: 5, category: '理论基础', status: 'learning' },
  { id: 'e12', parent_id: 'd3', level: 5, category: '理论基础' },
  { id: 'e13', parent_id: 'd3', level: 5, category: '理论基础' },
  { id: 'e14', parent_id: 'd3', level: 5, category: '理论基础' },
  { id: 'e15', parent_id: 'd3', level: 5, category: '理论基础' },
];

const agg = buildAggregates(TREE);
eq(agg.get('e1').status, 'mastered', 'L5 用自己的状态，不参与聚合');
eq(agg.get('e4').status, 'review', 'L5「需复习」原样保留');
eq(agg.get('d1').status, 'mastered', '4 已掌握 + 1 学习中 = 0.90 → 已掌握');
eq(agg.get('d2').status, 'learning', '1 已掌握 + 1 学习中 + 3 未接触 = 0.30 → 学习中');
eq(agg.get('d3').status, 'locked', '1 学习中 + 4 未接触 = 0.10 → 未开始');
eq(agg.get('c').status, 'learning', 'L3 取三个子节点的平均（0.43）→ 学习中');
eq(agg.get('b').status, 'learning', 'L2 继续往上传播');
eq(agg.get('a').status, 'learning', 'L1 也拿到聚合结果');
ok(Math.abs(agg.get('c').score - (0.9 + 0.3 + 0.1) / 3) < 1e-9, 'L3 得分是子节点的算术平均');
eq(agg.get('d1').childCount, 5, 'childCount 记录参与聚合的子节点数');
eq(agg.get('d1').counts.mastered, 3, 'counts 分别统计各状态（mastered 3 个）');
eq(agg.get('d1').counts.review, 1, 'counts 里 review 单独一桶，不与 mastered 混在一起');
eq(agg.get('e1').childCount, 0, '叶子的 childCount 是 0');

// 空树与脏输入不能炸
ok(buildAggregates([]).size === 0, '空数组返回空 Map');
ok(buildAggregates(null).size === 0, '传 null 不抛错');
ok(buildAggregates([{ id: 'x', level: 5 }, null, { level: 1 }]).size === 1, '跳过没有 id 的脏行');

console.log('\n[分类统计与缺口]');
const catStats = summarizeByCategory(TREE, agg);
const theory = catStats.find((c) => c.category === '理论基础');
eq(theory.l5, 15, '只统计 L5 作为分母');
ok(theory.percent > 0 && theory.percent < 100, '百分比在 0–100 之间', `实际 ${theory.percent}%`);
ok(catStats.length === 5, '五个分类都有条目，缺的补 0');

const gaps = findGaps(TREE, ['multimodal']);
ok(gaps.length === 1 && gaps[0].id === 'e8', '缺口 = 命中领域且没有任何状态的知识点', `实际 ${gaps.length} 个`);
ok(!gaps.some((g) => g.id === 'e1'), '已经有状态的知识点不算缺口（哪怕它是已掌握）');
ok(findGaps(TREE, []).length === 0, '没给领域时不返回任何缺口');
eq(labelOf('review'), '需复习', 'labelOf 输出中文标签');
eq(labelOf('unknown_xyz'), 'unknown_xyz', '未知状态原样返回，不吞掉信息');

/* ======================================================== 2. 变更集 */
console.log('\n[变更集：白名单与结构约束]');

ok(TABLES.length === 7, '恰好 7 张业务表可写', `实际 ${TABLES.length}`);
ok(!TABLES.includes('kb_snapshots') && !TABLES.includes('meta'),
  '快照表与元信息表不允许由模型写（否则可以伪造审计记录）');

let r = normalizeChangeset([
  { op: 'insert', table: 'nodes', confidence: 0.7,
    row: { parent_id: 'n_x', level: 5, name: '二叉树', category: '编程基础', status: 'learning' } },
]);
eq(r.ops.length, 1, '合法的 insert 被接受');
eq(r.ops[0].values.name, '二叉树', '字段值原样保留');
eq(r.ops[0].dedupeKey.name_norm, '二叉树', '自动生成查重键');
eq(r.ops[0].values.status, 'learning', 'L5 允许带 status');

r = normalizeChangeset([
  { op: 'insert', table: 'nodes', row: { parent_id: 'n_x', level: 3, name: '多模态学习', category: '理论基础', status: 'mastered' } },
]);
eq(r.ops[0].values.status, undefined, '★ L3 带 status 会被丢掉（上层状态必须靠聚合）');
ok(r.notes.some((n) => n.includes('聚合')), '并且会留一条说明，不是静默丢弃');

r = normalizeChangeset([{ op: 'insert', table: 'sqlite_master', row: { name: 'x' } }]);
ok(r.ops.length === 0 && r.rejected[0].reason.includes('不允许'), '不在白名单的表直接被拒');

r = normalizeChangeset([{ op: 'upsert', table: 'nodes', row: { name: 'x' } }]);
ok(r.ops.length === 0 && r.rejected[0].reason.includes('不支持'), '不认识的操作被拒');

r = normalizeChangeset([{ op: 'insert', table: 'nodes',
  row: { id: '模型的id', parent_id: 'n_x', level: 5, name: 'x', category: '编程基础', created_at: '1999', name_norm: '伪造', manual_override: 1 } }]);
eq(r.ops[0].values.id, undefined, 'id 不接受模型给的值（服务端生成）');
eq(r.ops[0].values.created_at, undefined, '时间戳不接受模型给的值');
eq(r.ops[0].values.name_norm, undefined, 'name_norm 由服务端算，防止绕过查重');
eq(r.ops[0].values.manual_override, undefined, 'manual_override 不允许模型设置');

r = normalizeChangeset([{ op: 'insert', table: 'nodes',
  row: { parent_id: 'n_x', level: 5, name: 'x', category: '摸鱼学', status: 'learning' } }]);
ok(r.ops.length === 0 && r.rejected[0].reason.includes('category'), 'category 必须在五个一级分类里');

r = normalizeChangeset([{ op: 'insert', table: 'nodes',
  row: { parent_id: 'n_x', level: 5, name: 'x', category: '编程基础', status: '精通' } }]);
ok(r.ops.length === 0 && r.rejected[0].reason.includes('status'), 'status 必须在四种状态里');

r = normalizeChangeset([{ op: 'insert', table: 'nodes', row: { level: 5, category: '编程基础' } }]);
ok(r.ops.length === 0 && r.rejected[0].reason.includes('name'), '缺必填字段的 insert 被拒');

r = normalizeChangeset([{ op: 'update', table: 'nodes', patch: { status: 'mastered' } }]);
ok(r.ops.length === 0 && r.rejected[0].reason.includes('主键'), 'update 没有主键被拒');

r = normalizeChangeset([{ op: 'update', table: 'nodes', key: { id: 'n1' }, patch: {} }]);
ok(r.ops.length === 0, 'update 没有任何可写字段被拒');

r = normalizeChangeset(new Array(MAX_ITEMS + 5).fill(0).map(() =>
  ({ op: 'insert', table: 'nodes', row: { parent_id: 'n_x', level: 5, name: 'x', category: '编程基础' } })));
eq(r.ops.length, MAX_ITEMS, `超过 ${MAX_ITEMS} 项时截断`);
ok(r.notes.some((n) => n.includes('上限')), '截断会留下说明');

r = normalizeChangeset([{ op: 'update', table: 'nodes', key: { id: 'n1' }, patch: { status: 'mastered' }, confidence: 0.66, reason: '你提到能手写快排' }]);
eq(r.ops[0].reason, '你提到能手写快排', 'reason 被保留（卡片要显示依据）');
eq(r.ops[0].confidence, 0.66, 'confidence 保留（卡片按它决定默认勾选）');

console.log('\n[默认勾选规则]');
ok(defaultChecked(0.9).checked && !defaultChecked(0.9).hint, '≥0.7 默认勾选，无提示');
ok(defaultChecked(0.7).checked && !defaultChecked(0.7).hint, '0.70 边界算高置信');
ok(defaultChecked(0.65).checked && defaultChecked(0.65).hint === '建议核对', '0.6–0.7 勾选但提示核对');
ok(defaultChecked(0.6).checked, '0.60 边界算中等');
ok(!defaultChecked(0.59).checked && defaultChecked(0.59).hint.includes('确认'), '<0.6 默认不勾，提示用户确认');
ok(!defaultChecked(undefined).checked, '没有置信度时不勾选');
ok(!defaultChecked('abc').checked, '置信度是垃圾值时按不勾选处理');

console.log('\n[查重键]');
eq(JSON.stringify(dedupeKeyOf('nodes', { parent_id: 'p', name: ' SVD ' })), JSON.stringify({ parent_id: 'p', name_norm: 'svd' }),
  '同一父节点下同名（忽略大小写与空格）= 重复');
eq(dedupeKeyOf('nodes', { parent_id: null, name: 'X' }).parent_id, null, '根节点的父 id 是 null');
ok(dedupeKeyOf('evidence', { node_id: 'x' }) === null, '证据表靠唯一索引查重，不在这里判');
eq(dedupeKeyOf('projects', { source_url: 'https://github.com/a/b' }).source_url, 'https://github.com/a/b', '项目按仓库地址查重');

console.log('\n[SQL 规划与反向变更]');

const ins = planOp(
  { op: 'insert', table: 'nodes', values: { parent_id: 'n_x', level: 5, name: 'InfoNCE', category: '理论基础', status: 'learning' }, dedupeKey: {} },
  { now: '2026-09-18T00:00:00Z', newId: 'n_new_1' }
);
eq(ins.action, 'insert', 'insert 被规划');
ok(ins.row.id === 'n_new_1', '主键由服务端生成');
eq(ins.row.source, 'ai_inferred', 'insert 默认来源标为 AI 推断');
eq(ins.forward.length, 1, '正向一条语句');
ok(ins.forward[0].sql.startsWith('INSERT INTO nodes (') && ins.forward[0].sql.includes('?'), 'SQL 用占位符，值走绑定参数');
ok(!ins.forward[0].sql.includes('InfoNCE'), 'SQL 文本里不出现任何用户数据（没有拼接注入面）');
ok(ins.inverse[0].sql.startsWith('DELETE FROM nodes'), 'insert 的反向是 delete');

const conflict = planOp(
  { op: 'insert', table: 'nodes', values: { name: 'InfoNCE' } },
  { now: 'x', newId: 'n_new_2', conflict: { id: 'n_exist' } }
);
eq(conflict.action, 'skip', '已存在同名条目时跳过，而不是整批失败');
ok(conflict.reason.includes('已存在'), '跳过原因可读');

const before = { id: 'n1', level: 5, name: 'InfoNCE', status: 'untouched', confidence: 0.5,
  updated_at: '2026-09-01T00:00:00Z', source: 'seed', parent_id: 'p', manual_override: 0 };
const upd = planOp(
  { op: 'update', table: 'nodes', id: 'n1', values: { status: 'mastered' } },
  { now: '2026-09-18T00:00:00Z', before }
);
eq(upd.action, 'update', 'update 被规划');
eq(upd.values.manual_override, 1, '★ 用户改过状态 → 打上 manual_override 标记');
eq(upd.inverse.length, 1, '反向语句存在');
ok(upd.inverse[0].params.includes('untouched'), '反向语句能把状态还原成改动前的值');
ok(upd.inverse[0].params.includes(0.5), '反向语句连置信度一起还原');
ok(upd.inverse[0].sql.includes('manual_override=?') && upd.inverse[0].params.includes(0),
   '★ 反向语句把 manual_override 也还原（否则撤销后仍被标记成"用户手改过"）');
ok(upd.forward[0].params.includes('2026-09-18T00:00:00Z'), '正向写入新的 updated_at');

const updMissing = planOp({ op: 'update', table: 'nodes', id: 'none', values: { status: 'x' } }, { now: 'x', before: null });
eq(updMissing.action, 'skip', '要改的条目不存在时跳过，不抛错');

const del = planOp({ op: 'delete', table: 'nodes', id: 'n1' }, { before });
eq(del.action, 'delete', 'delete 被规划');
ok(del.inverse[0].sql.startsWith('INSERT INTO nodes'), 'delete 的反向是 insert（整行写回）');
ok(del.inverse[0].params.includes('InfoNCE'), '反向语句带回了完整旧行，撤销能真的复原');

const batch = assembleBatch([ins, conflict, upd], [{ sql: 'UPDATE meta SET value=? WHERE key=?', params: ['t', 'synced_at'] }]);
eq(batch.applied.length, 2, '批量里记录 2 条实际生效的操作');
eq(batch.skipped.length, 1, '跳过的那条单独记录，会回给前端显示');
eq(batch.forward.length, 3, '正向语句 = 2 条业务 + 1 条附加（更新同步时间）');
eq(batch.inverse.length, 2, '反向语句与生效操作一一对应');

const sel = sqlSelectDedupe('nodes', { parent_id: null, name_norm: 'svd' });
ok(sel.sql.includes('IS ?'), '查重 SQL 用 IS 而不是 =，否则 null 永远匹配不上');

ok(fromDbRow('nodes', { id: 'n', domain_ids: '["multimodal"]' }).domain_ids[0] === 'multimodal', '读出来的 JSON 列会解析成数组');
eq(fromDbRow('nodes', { id: 'n', domain_ids: '坏数据' }).domain_ids.length, 0, 'JSON 坏了给空数组，不让页面炸');
ok(describeOp({ op: 'insert', table: 'nodes', values: { name: '二叉树' } }).includes('二叉树'), '变更描述带上了名字');

/* ======================================================== 3. 上下文检索 */
console.log('\n[关键词抽取]');

let kw = extractKeywords('我想做多模态检索，但不知道具体往哪个方向走');
ok(kw.includes('检索'), '中文切成 2-gram 并命中「检索」', `得到 ${kw.join('/')}`);
ok(!kw.includes('我想'), '虚词被过滤');
ok(new Set(kw).size === kw.length, '关键词不重复');
ok(kw.length <= 12, '关键词数量有上限');

kw = extractKeywords('I want to learn contrastive learning with PyTorch');
ok(kw.includes('pytorch'), '英文单词被抽出并转小写');
ok(!kw.includes('want') && !kw.includes('the'), '英文虚词被过滤');

ok(extractKeywords('').length === 0, '空字符串返回空数组');
ok(extractKeywords(null).length === 0, '传 null 不抛错');

console.log('\n[LIKE 模式与长度限制]');
const long = '超'.repeat(40);
eq(clampPattern(long).length, 16, '超长关键词被截断到 16 个汉字（%kw% ≤ 50 字节）');
ok(new TextEncoder().encode('%' + clampPattern(long) + '%').length <= 50, '截断后的模式确实不超过 50 字节');
eq(clampPattern('svd'), 'svd', '短关键词不动');
ok(likePatterns(['svd', '']).length === 1, '空关键词不生成模式');
ok(likePatterns(['svd'])[0] === '%svd%', '模式两侧带通配符');

console.log('\n[候选排序]');
const CAND = [
  { id: '1', level: 5, name: '信息检索', summary: '', status: 'untouched', category: '理论基础' },
  { id: '2', level: 5, name: '检索中的对比学习', summary: '正负样本与温度系数', status: 'review', category: '理论基础' },
  { id: '3', level: 5, name: '鸭子的饲养', summary: '跟养殖有关', status: 'mastered', category: '理论基础' },
  { id: '4', level: 3, name: '多模态学习', summary: '图文检索方向', status: null, category: '理论基础' },
  { id: '5', level: 5, name: '文本检索', summary: '', status: 'learning', category: '理论基础' },
];
const ranked = rankNodes(CAND, ['检索']);
ok(!ranked.leafHits.some((n) => n.id === '3'), '★ 零命中的节点不会被塞进摘要（否则模型开始编）');
eq(ranked.leafHits.map((n) => n.id).join(','), '2,5,1',
  '命中强度相同时按状态排序：需复习 > 学习中 > 未接触');
ok(ranked.leafHits[0].name.includes('检索'), '名字里带关键词的排在没有的之前');
eq(ranked.upperHits.length, 1, 'L3 及以上的进 upperHits');
eq(ranked.upperHits[0].id, '4', '学科骨架单独一组');

// 名字命中比摘要命中更相关（权重 3 : 1）
const nameVsSummary = rankNodes([
  { id: 'n', level: 5, name: '检索指标', summary: '', status: null, category: '理论基础' },
  { id: 's', level: 5, name: '评测方法', summary: '包括检索指标', status: 'review', category: '理论基础' },
], ['检索']);
eq(nameVsSummary.leafHits[0].id, 'n', '名字命中优先于摘要命中，即使摘要那条状态权重更高');

const capped = rankNodes(CAND.concat(new Array(50).fill(0).map((_, i) =>
  ({ id: 'x' + i, level: 5, name: '检索 ' + i, summary: '', status: 'learning', category: '理论基础' }))), ['检索'], { maxLeaf: 30, maxUpper: 10 });
eq(capped.leafHits.length, 30, 'L4/L5 最多 30 条，防止把上下文撑爆');
ok(rankNodes(CAND, ['完全不存在的东西']).leafHits.length === 0, '全不命中时返回空，交给调用方注入"无命中"');

console.log('\n[领域识别与摘要渲染]');
const DOMAINS = [
  { id: 'multimodal', name: '多模态', aliases: ['multimodal', '跨模态'], keywords: ['图文'] },
  { id: 'cv', name: '计算机视觉', aliases: ['CV'], keywords: ['图像'] },
];
eq(matchDomains(DOMAINS, ['多模态'])[0].id, 'multimodal', '按名字命中领域');
eq(matchDomains(DOMAINS, ['cv'])[0].id, 'cv', '按别名命中领域');
eq(matchDomains(DOMAINS, ['区块链']).length, 0, '命中不了就不返回');

const SUMMARY_INPUT = {
  hits: { leafHits: [CAND[1], CAND[0]], upperHits: [CAND[3]] },
  allNodes: TREE.concat(CAND),
  domains: [DOMAINS[0]],
  plan: { profile: 'hybrid', start_date: '2026-09-18', end_date: '2026-12-31', goal: '跑通图文检索基线' },
  syncedAt: '2026-09-18 11:00',
  today: '2026-09-18',
};
const summary = renderContextSummary(SUMMARY_INPUT);
ok(summary.includes('用户知识库摘要'), '摘要带标题');
ok(summary.includes('不是全量'), '★ 明确告诉模型这只是检索结果');
ok(summary.includes('多模态'), '带上命中的领域');
ok(summary.includes('需复习'), '带上状态标签');
ok(summary.includes('hybrid') && summary.includes('跑通图文检索基线'), '带上当前计划');
ok(summary.includes('不是事实') && summary.includes('不要复述'), '带上使用护栏');
ok(!summary.includes('鸭子的饲养'), '没命中的节点不会出现在摘要里');

eq(renderContextSummary({ hits: { leafHits: [], upperHits: [] }, allNodes: [], domains: [] }), '',
  '零命中返回空串，由调用方决定怎么提示');
ok(renderNoHitNote(88).includes('88'), '无命中提示里带上总节点数');
ok(renderNoHitNote(0).includes('一无所知'), '无命中时明确说"对这个用户一无所知"');

/* ======================================================== 4. 块切分 */
console.log('\n[结构化块切分]');

let blk = splitBlocks('先说一段话。\n\n[[KB]]\n{"items":[]}\n[[/KB]]\n\n[[PLAN]]\n{"goal":"x"}\n[[/PLAN]]');
eq(blk.text, '先说一段话。', '两个块都被切掉，正文只留人看的部分');
eq(JSON.parse(blk.blocks.KB).items.length, 0, 'KB 块能取出来');
eq(JSON.parse(blk.blocks.PLAN).goal, 'x', 'PLAN 块能取出来');

blk = splitBlocks('正在写\n[[KB]]\n{"items":');
ok(blk.streaming.includes('KB'), '未闭合的块标记为 streaming');
eq(blk.text, '正在写', '未闭合块的内容不出现在正文里（避免刷屏原始 JSON）');
eq(blk.blocks.KB, undefined, '未闭合时不返回半截 JSON');

blk = splitBlocks('只有普通回答，没有任何块');
eq(blk.text, '只有普通回答，没有任何块', '没有块时正文原样返回');
eq(Object.keys(blk.blocks).length, 0, '没有块时 blocks 为空');

blk = splitBlocks('[[PLAN]]\n{"a":1}\n[[/PLAN]]');
eq(blk.text, '', '整个回答只有一个块时，正文为空串');

eq(parseBlockJSON('{"a":1}').a, 1, '标准 JSON');
eq(parseBlockJSON('```json\n{"a":2}\n```').a, 2, '带代码围栏也能解析');
eq(parseBlockJSON('{"a":3,}').a, 3, '尾逗号会被修复（模型最常见的失误）');
eq(parseBlockJSON('{"a":}'), null, '实在解析不了返回 null，不抛错');
eq(parseBlockJSON(''), null, '空内容返回 null');

console.log('\n' + (failed === 0 ? '全部通过。' : failed + ' 项失败。') + '\n');
process.exit(failed === 0 ? 0 : 1);
