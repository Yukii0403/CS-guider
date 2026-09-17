/**
 * 前端页面测试
 * 运行：node test/frontend.test.mjs
 *
 * 分两部分：
 *   ① 静态检查 —— index.html 里不该出现的东西（外部资源、预置输入、模式按钮）
 *   ② 逻辑检查 —— 从页面里抽出纯函数（路线块切分 / JSON 解析 / 增量合并）直接跑
 *
 * 为什么值得单写一份：路线页面的合并逻辑最容易出错，
 * 而它错了的表现是"用户勾选的完成状态被下一次展开冲掉"——这种 bug 肉眼很难发现。
 */
import { readFileSync } from 'node:fs';

const HTML = new URL('../index.html', import.meta.url);
const html = readFileSync(HTML, 'utf8');

let failed = 0;
function ok(cond, label) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failed++;
}

/* ==================== ① 静态检查 ==================== */

console.log('\n[页面自包含性]');
ok(!/<script[^>]+\bsrc=/.test(html), '没有外链脚本');
ok(!/<link[^>]+\bhref=/.test(html), '没有外链样式');
const externals = html.match(/(?:src|href)=["']https?:\/\/[^"']+/g) || [];
ok(externals.length === 0, '零外部资源引用（可直接托管到任何静态空间）');

console.log('\n[去掉模式按钮与预置输入]');
ok(!html.includes('data-mode'), '没有 data-mode（不再让用户选模式）');
ok(!html.includes('data-fill'), '没有 data-fill（不再预置任何输入文字）');
ok(!html.includes('class="tab"'), '没有模式标签按钮');
ok(html.includes('不是输入模板'), '页面明确说明卡片只是能力说明，不是输入模板');
ok(/placeholder="用自己的话说/.test(html), '输入框提示语是"用自己的话说"');
ok(html.includes('不需要选模式'), '底部提示说明了不需要选模式');

console.log('\n[路线页面存在]');
ok(html.includes('id="planView"'), '有路线页面容器');
ok(html.includes('id="planInner"'), '有路线渲染区');
ok(html.includes('id="planBadge"'), '顶部有进度徽章');
ok(html.includes('id="planCopy"') && html.includes('id="planClear"'), '有复制与清空按钮');
ok(html.includes('还没有学习路线'), '有空状态文案');

console.log('\n[发送请求不再带 mode]');
ok(!/JSON\.stringify\(\{\s*mode:/.test(html), '请求体里没有 mode 字段');

/* ==================== ② 抽出纯函数直接跑 ==================== */

const pk = html.match(/var PLAN_KEY\s*=\s*'([^']+)'/);
ok(!!pk, '能读到 PLAN_KEY 定义');

const from = html.indexOf('function splitPlan(src){');
const to = html.indexOf('function renderPlan(){');
ok(from !== -1 && to !== -1 && to > from, '能从页面里切出路线相关函数的代码块');

const code = html.slice(from, to);
const store = {};
const fakeLS = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const build = new Function(
  'localStorage',
  'var PLAN_KEY = ' + JSON.stringify(pk[1]) + ';\n' + code +
  '\nreturn { splitPlan, parsePlanJSON, mergePlan, planStats, fmtDate };'
);
const api = build(fakeLS);

console.log('\n[路线块切分 splitPlan]');

let r = api.splitPlan('前面的说明\n[[PLAN]]\n{"a":1}\n[[/PLAN]]\n后面的话');
ok(r.json && r.json.includes('"a"'), '能取出 [[PLAN]] 块里的 JSON');
ok(r.text.includes('前面的说明') && r.text.includes('后面的话'), '正文里保留了块前后的内容');
ok(r.text.includes('[[PLAN]]') === false, '正文里不再残留标记');
ok(r.streaming === false, '闭合的块 streaming=false');

r = api.splitPlan('正在写\n[[PLAN]]\n{"a":');
ok(r.streaming === true && r.json === null, '未闭合的块标记为 streaming，正文只留前半部分');
ok(r.text === '正在写', '未闭合时正文不包含块内容');

r = api.splitPlan('兜底写法\n```plan\n{"b":2}\n```\n尾巴');
ok(r.json && r.json.includes('"b"'), 'Markdown 代码块写法也能切出来');
ok(r.streaming === false, '代码块写法 streaming=false');

r = api.splitPlan('普通回答，没有任何结构化块');
ok(r.json === null && r.streaming === false && r.text === '普通回答，没有任何结构化块', '普通回答原样返回');

console.log('\n[路线 JSON 解析 parsePlanJSON]');
ok(api.parsePlanJSON('{"goal":"x"}').goal === 'x', '标准 JSON 可解析');
ok(api.parsePlanJSON('```json\n{"goal":"y"}\n```').goal === 'y', '带代码围栏时也能解析');
ok(api.parsePlanJSON('{"goal":}') === null, '非法 JSON 返回 null 而不是抛错');
ok(api.parsePlanJSON('') === null, '空内容返回 null');

console.log('\n[增量合并 mergePlan]');

const merged1 = api.mergePlan({
  goal: '复现一篇多模态检索论文',
  form: '混合型',
  startDate: '2026-09-18',
  endDate: '2026-12-11',
  hoursPerWeek: 10,
  stages: [{
    name: '阶段一 · 数学补缺',
    goal: '能手算矩阵运算',
    startDate: '2026-09-18',
    endDate: '2026-09-30',
    items: [
      { day: 1, date: '2026-09-18', outcome: '能手写矩阵乘法', reason: '后面要用', domain: '数学基础 › 线性代数', minutes: 90 },
      { day: 2, date: '2026-09-19', outcome: '能解释广播规则', reason: '常见报错来源', domain: '编程基础 › numpy', minutes: 90 },
    ],
  }],
});
let st = api.planStats(merged1);
ok(st.total === 2 && st.done === 0, '首次合并：2 天，完成 0');
ok(merged1.goal === '复现一篇多模态检索论文', '目标被写入');
ok(merged1.stages[0].items[0].day === 1, '阶段一有逐日条目');

// 用户勾掉第 1 天
const saved = JSON.parse(store[pk[1]]);
saved.stages[0].items[0].done = true;
store[pk[1]] = JSON.stringify(saved);

// 第二次展开：只给阶段二，且重发一次阶段一（模拟模型重复输出）
const merged2 = api.mergePlan({
  stages: [
    { name: '阶段一 · 数学补缺', goal: '能手算矩阵运算', items: [
      { day: 1, date: '2026-09-18', outcome: '能手写矩阵乘法', reason: '后面要用', domain: '数学基础 › 线性代数', minutes: 90 },
      { day: 2, date: '2026-09-19', outcome: '能解释广播规则', reason: '常见报错来源', domain: '编程基础 › numpy', minutes: 90 },
    ] },
    { name: '阶段二 · 跑通基线', goal: '能训出一个能用的模型', items: [
      { day: 3, date: '2026-10-01', outcome: '能在自己的数据上跑通训练', reason: '先有基线', domain: '工具基础 › PyTorch', minutes: 120 },
    ] },
  ],
});
st = api.planStats(merged2);
ok(merged2.stages.length === 2, '第二次展开后是两个阶段（同名阶段被合并，没有重复）');
ok(st.total === 3, '天数累加到 3 天（day=1、2 没有重复计入）');
ok(st.done === 1, '用户已勾选的完成状态被保留下来');
ok(merged2.stages[1].items[0].day === 3, '新阶段的条目按 day 编号接在后面');
ok(merged2.goal === '复现一篇多模态检索论文', '第二次展开没有把已有的目标冲掉');

// 排序：乱序给出 day，应被排序
const merged3 = api.mergePlan({ stages: [{
  name: '阶段三 · 乱序测试',
  items: [
    { day: 9, outcome: '第九天' },
    { day: 4, outcome: '第四天' },
    { day: 7, outcome: '第七天' },
  ],
}]});
const days = merged3.stages[2].items.map((i) => i.day);
ok(days.join(',') === '4,7,9', '条目按 day 升序排列');

// 非法输入不应炸
ok(api.mergePlan(null) !== null, '传入 null 时返回已有计划，不抛错');
ok(api.mergePlan({ stages: 'not-an-array' }) !== null, 'stages 不是数组时不抛错');

console.log('\n[日期格式化 fmtDate]');
ok(api.fmtDate('2026-09-18') === '9/18', '2026-09-18 → 9/18');
ok(api.fmtDate('2026-12-01') === '12/1', '2026-12-01 → 12/1');
ok(api.fmtDate('') === '', '空值返回空串');
ok(api.fmtDate('随便写的') === '随便写的', '非标准格式原样返回，不丢信息');

console.log('\n' + (failed === 0 ? '全部通过。' : failed + ' 项失败。') + '\n');
process.exit(failed === 0 ? 0 : 1);
