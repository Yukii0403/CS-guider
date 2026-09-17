/**
 * 云函数接口测试
 * 运行：node test/worker.test.mjs   （或 npm test）
 *
 * 用 mock 掉的上游模型接口，验证 worker.js 的全部对外行为。
 * 这些断言本身就是工程完整性的证明材料：
 * 接口不是"写完就上"，而是有明确契约并逐条验证过的。
 */
import { fileURLToPath } from 'node:url';

const calls = [];

// ---- mock 掉上游模型接口 ----
globalThis.fetch = async (url, init) => {
  calls.push({
    url: String(url),
    method: init && init.method,
    headers: init && init.headers,
    body: init && init.body,
  });
  const body = JSON.parse(init.body);
  if (!body.stream) throw new Error('应该以 stream=true 调用上游');
  const chunks = [
    'data: {"choices":[{"delta":{"content":"## 反推结果\\n\\n"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"**1. PyTorch 基础**\\n- 证据：使用了 nn.Module\\n- 置信度：0.9\\n"}}]}\n\n',
    'data: [DONE]\n\n',
  ];
  const stream = new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      chunks.forEach((s) => c.enqueue(enc.encode(s)));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

const worker = (await import(new URL('../worker.js', import.meta.url).href)).default;
const handler = worker.fetch;
const env = { MODEL_API_KEY: 'sk-test', MODEL_NAME: 'mock-model' };

let failed = 0;
function ok(cond, label) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failed++;
}

console.log('\n[CORS 与健康检查]');

let r = await handler(new Request('https://x/api/chat', { method: 'OPTIONS' }), env);
ok(r.status === 204, 'OPTIONS 预检返回 204');
ok(r.headers.get('Access-Control-Allow-Origin') === '*', 'OPTIONS 带 CORS 头');

r = await handler(new Request('https://x/api/health'), env);
let j = await r.json();
ok(r.status === 200 && j.ok === true && j.hasKey === true, '健康检查返回 ok/hasKey');

r = await handler(new Request('https://x/api/health'), {});
j = await r.json();
ok(j.ok === true && j.hasKey === false, '未配置密钥时 hasKey=false');

console.log('\n[对话请求与流式透传]');

r = await handler(
  new Request('https://x/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '我想做多模态' }] }),
  }),
  env
);
ok(r.status === 200, '对话请求返回 200');
ok((r.headers.get('Content-Type') || '').includes('text/event-stream'), '响应是 SSE 流');
const text = await r.text();
ok(text.includes('反推结果'), '流内容能完整读出');

const sent = JSON.parse(calls[calls.length - 1].body);
ok(sent.model === 'mock-model', '透传了 MODEL_NAME');
ok(sent.messages[0].role === 'system', '自动注入了 system 提示词');
ok(sent.messages[1].content === '我想做多模态', '用户消息被正确传入');
ok(calls[calls.length - 1].headers.Authorization === 'Bearer sk-test', '上游带上了 Bearer 密钥');
ok(sent.temperature === 0.3, '统一温度 0.3');

console.log('\n[统一提示词：三种能力都在场，路由由模型判断]');

const sys = sent.messages[0].content;
ok(sys.includes('能力一 · 方向收敛'), '含能力一（方向收敛）');
ok(sys.includes('能力二 · 能力反推'), '含能力二（能力反推）');
ok(sys.includes('能力三 · 学习路线'), '含能力三（学习路线）');
ok(sys.includes('选项式追问'), '能力一保留了选项式追问');
ok(sys.includes('未发现证据'), '能力二保留了"未发现证据"铁律');
ok(sys.includes('真实存在的证据'), '能力二只依据代码中真实存在的证据');
ok(sys.includes('缓冲日'), '能力三保留缓冲日硬规则');
ok(sys.includes('这次不做的事'), '能力三保留"明确不做"');
ok(sys.includes('多模态'), '内置了领域树（选项的唯一来源）');
ok(/今天是 \d{4}-\d{2}-\d{2}/.test(sys), '注入了当天日期，供日期推算使用');

console.log('\n[路由规则与篇幅策略（v1 反馈的三个问题）]');

ok(sys.includes('不要问用户'), '禁止反问用户"你想用哪个功能"');
ok(sys.includes('也不要向用户说明你正在使用哪种能力'), '禁止向用户宣告正在用哪种能力');
ok(!/\d+ ?字以内|控制在 ?\d+ ?字|不超过 ?\d+ ?字/.test(sys), '已无任何字数上限（v1 的 400 字限制移除）');
ok(sys.includes('不要自我截断'), '明确禁止自我截断');
ok(sys.includes('不要向用户解释篇幅限制'), '明确禁止解释篇幅限制');
ok(sys.includes('[[PLAN]]'), '含结构化路线块契约');
ok(!sys.includes('`'), '提示词正文里没有反引号（否则会截断 worker.js 的模板字符串）');

console.log('\n[向后兼容]');

// 老客户端仍会传 mode —— 现在应被忽略，提示词与不带 mode 时完全一致
r = await handler(
  new Request('https://x/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'analyze', messages: [{ role: 'user', content: 'code' }] }),
  }),
  env
);
await r.text();
const sysLegacy = JSON.parse(calls[calls.length - 1].body).messages[0].content;
ok(sysLegacy === sys, '传了老的 mode 也不再切换提示词');

console.log('\n[异常处理]');

r = await handler(
  new Request('https://x/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }),
  env
);
j = await r.json();
ok(r.status === 400 && j.ok === false, '空 messages 返回 400');

const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{"error":"invalid key"}', { status: 401 });
r = await handler(
  new Request('https://x/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }),
  env
);
j = await r.json();
ok(r.status === 502 && j.error.includes('401'), '上游报错时返回 502 + 可读错误');
globalThis.fetch = realFetch;

r = await handler(new Request('https://x/foo'), env);
ok(r.status === 404, '未知路径返回 404');

console.log('\n' + (failed === 0 ? '全部通过。' : failed + ' 项失败。') + '\n');
process.exit(failed === 0 ? 0 : 1);
