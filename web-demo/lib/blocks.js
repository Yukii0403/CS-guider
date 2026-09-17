/**
 * 模型输出里的结构化块切分
 * ------------------------------------------------------------------
 * 模型会在正常回答的末尾追加结构化块，前端据此渲染。目前有两种：
 *   [[PLAN]] … [[/PLAN]]   学习路线的逐日数据
 *   [[KB]]   … [[/KB]]     知识库变更草案
 *
 * 为什么用自定义标记而不是 Markdown 代码块：
 *   1. 提示词正文里出现反引号会截断 worker.js 的模板字符串（硬约束）；
 *   2. JSON 里本身可能含反引号，代码块的两侧不好切。
 *
 * 两个块可能同时出现在一条回答里（先改知识库、再排路线），
 * 所以这里一次把两者都切掉，正文只留真正给人看的部分。
 * ------------------------------------------------------------------
 */

export const TAGS = ['KB', 'PLAN'];

/**
 * 切出单个标记块。
 * @returns {{found:boolean, json:string|null, streaming:boolean, ranges:Array}}
 *   json      —— 块内文本（未解析）；streaming 为 true 时是 null
 *   streaming —— 块已经开头但还没闭合（正在流式输出）
 */
export function splitOne(src, tag) {
  const open = `[[${tag}]]`;
  const close = `[[/${tag}]]`;
  const i = src.indexOf(open);
  if (i === -1) return { found: false, json: null, streaming: false, ranges: [] };

  const after = src.slice(i + open.length);
  const end = after.indexOf(close);
  if (end === -1) {
    // 还没写完：把这之后的内容整段当作"未完成块"，正文里不要显示
    return { found: true, json: null, streaming: true, ranges: [[i, src.length]] };
  }
  return {
    found: true,
    json: after.slice(0, end),
    streaming: false,
    ranges: [[i, i + open.length + end + close.length]],
  };
}

/**
 * 一次切掉所有结构化块。
 * @param {string} src
 * @param {string[]} tags 要处理的标记名，默认 ['KB','PLAN']
 * @returns {{text:string, blocks:Object, streaming:string[]}}
 */
export function splitBlocks(src, tags = TAGS) {
  const s = String(src == null ? '' : src);
  const ranges = [];
  const blocks = {};
  const streaming = [];

  for (const tag of tags) {
    const r = splitOne(s, tag);
    if (!r.found) continue;
    ranges.push(...r.ranges);
    if (r.streaming) streaming.push(tag);
    else blocks[tag] = r.json;
  }

  // 按起点排序后去掉被覆盖的区间（未闭合块会吃掉它后面的所有内容）
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [a, b] of ranges) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }

  let text = '';
  let cursor = 0;
  for (const [a, b] of merged) {
    text += s.slice(cursor, a);
    cursor = b;
  }
  text += s.slice(cursor);

  return { text: text.trim(), blocks, streaming };
}

/**
 * 解析块里的 JSON，容忍模型多包了一层 Markdown 代码围栏或写了尾逗号。
 * 解析失败返回 null —— 调用方负责把原始内容保留下来给用户看，绝不静默丢弃。
 */
export function parseBlockJSON(raw) {
  if (!raw) return null;
  let t = String(raw).trim()
    .replace(/^```(?:json|plan|kb)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    // 只做一种修复：去掉对象/数组末尾多余的逗号（模型最常见的失误）
    const repaired = t.replace(/,(\s*[}\]])/g, '$1');
    try { return JSON.parse(repaired); } catch { return null; }
  }
}
