#!/usr/bin/env node
/**
 * 校验 web-demo/worker.js 内嵌的主提示词与 prompts/system.md 逐字一致。
 *
 * 为什么需要它：本作品有两个交付形态，提示词必须"两边同一份"。
 * 靠人记着同步一定会漂移，所以把这条纪律变成机器检查。
 *
 * 用法：
 *   node web-demo/scripts/check-prompts.mjs
 *
 * 退出码：0 = 一致；1 = 不一致或格式有问题
 */

import { readFileSync } from 'node:fs';

const MD = new URL('../../prompts/system.md', import.meta.url);
const JS = new URL('../worker.js', import.meta.url);

function fail(msg) {
  console.error('\n✗ ' + msg);
  process.exit(1);
}

/** 找第一处不同，输出上下文，便于直接定位 */
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      const from = Math.max(0, i - 60);
      return {
        index: i,
        md: JSON.stringify(a.slice(from, i + 60)),
        js: JSON.stringify(b.slice(from, i + 60)),
      };
    }
  }
  if (a.length !== b.length) {
    const longer = a.length > b.length ? 'system.md' : 'worker.js';
    return { index: n, md: `（${longer} 更长，多出的部分从这里开始）`, js: '' };
  }
  return null;
}

/* ---------- 1. 从 system.md 取正文 ---------- */
const mdRaw = readFileSync(MD, 'utf8');
const BEGIN = '<!-- PROMPT:BEGIN -->';
const END = '<!-- PROMPT:END -->';

const i0 = mdRaw.indexOf(BEGIN);
const i1 = mdRaw.indexOf(END);
if (i0 === -1 || i1 === -1 || i1 < i0) {
  fail('prompts/system.md 里找不到 PROMPT:BEGIN / PROMPT:END 标记，无法定位正文。');
}
const mdBody = mdRaw.slice(i0 + BEGIN.length, i1).trim();

/* ---------- 2. 从 worker.js 取正文 ---------- */
const jsRaw = readFileSync(JS, 'utf8');
const OPEN = 'const SYSTEM_PROMPT = `';
const o0 = jsRaw.indexOf(OPEN);
if (o0 === -1) fail('web-demo/worker.js 里找不到 `const SYSTEM_PROMPT = ` 的起止标记。');

const o1 = jsRaw.indexOf('`.trim();', o0 + OPEN.length);
if (o1 === -1) fail('web-demo/worker.js 里的 SYSTEM_PROMPT 没有以 `.trim(); 结尾。');

const jsBody = jsRaw.slice(o0 + OPEN.length, o1).trim();

/* ---------- 3. 正文里不允许出现的字符（会破坏模板字符串） ---------- */
for (const [label, body] of [['prompts/system.md', mdBody], ['web-demo/worker.js', jsBody]]) {
  const bad = [];
  if (body.includes('`')) bad.push('反引号 ( ` )');
  if (body.includes('${')) bad.push('模板插值 ( ${ ) ');
  if (bad.length) {
    fail(`${label} 的提示词正文里出现了 ${bad.join('、')}，会截断 worker.js 的模板字符串。\n` +
         '  结构化输出请用 [[PLAN]] 这种标记，不要用 Markdown 代码块。');
  }
}

/* ---------- 4. 逐字比对 ---------- */
const SIZE_HINT = `  system.md 正文 ${mdBody.length} 字符 / worker.js 正文 ${jsBody.length} 字符`;

if (mdBody === jsBody) {
  console.log('✓ 提示词一致：prompts/system.md ↔ web-demo/worker.js');
  console.log(SIZE_HINT);
  process.exit(0);
}

console.error('\n✗ 提示词不一致 —— 两边已经漂移了。');
console.error(SIZE_HINT);
const d = firstDiff(mdBody, jsBody);
if (d) {
  console.error(`\n  第一处不同在第 ${d.index} 个字符附近：`);
  console.error('  system.md  ：…' + d.md + '…');
  console.error('  worker.js  ：…' + d.js + '…');
}
console.error('\n  修法：把 prompts/system.md 的正文原样贴进 worker.js 的 SYSTEM_PROMPT，再跑一次本脚本。');
process.exit(1);
