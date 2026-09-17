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
    body: JSON.stringify({ mode: 'chat', messages: [{ role: 'user', content: '我想做多模态' }] }),
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
ok(sent.messages[0].content.includes('选项式追问'), 'chat 模式使用 chat 提示词');
ok(calls[calls.length - 1].headers.Authorization === 'Bearer sk-test', '上游带上了 Bearer 密钥');
ok(sent.messages[1].content === '我想做多模态', '用户消息被正确传入');

console.log('\n[模式差异]');

r = await handler(
  new Request('https://x/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'analyze', messages: [{ role: 'user', content: 'code' }] }),
  }),
  env
);
await r.text();
const sent2 = JSON.parse(calls[calls.length - 1].body);
ok(sent2.temperature === 0.2, 'analyze 模式温度 0.2（求稳）');
ok(sent2.messages[0].content.includes('能力反推'), 'analyze 模式使用 analyze 提示词');

const post = (mode) =>
  handler(
    new Request('https://x/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, messages: [{ role: 'user', content: 'x' }] }),
    }),
    env
  );

r = await post('plan');
await r.text();
const sent3 = JSON.parse(calls[calls.length - 1].body);
ok(sent3.temperature === 0.3, 'plan 模式温度 0.3');
ok(sent3.messages[0].content.includes('学习路线规划师'), 'plan 模式使用 plan 提示词');
ok(sent3.messages[0].content.includes('当天完成什么'), 'plan 提示词含可验证产出要求');
ok(sent3.messages[0].content.includes('缓冲日'), 'plan 提示词含缓冲日硬规则');

r = await post('不存在的模式');
await r.text();
const sent4 = JSON.parse(calls[calls.length - 1].body);
ok(sent4.temperature === 0.6, '未知模式回退到 chat 温度');
ok(sent4.messages[0].content.includes('选项式追问'), '未知模式回退到 chat 提示词');

r = await post(undefined);
await r.text();
ok(
  JSON.parse(calls[calls.length - 1].body).messages[0].content.includes('选项式追问'),
  'mode 缺省时回退到 chat'
);

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
