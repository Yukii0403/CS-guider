/**
 * 本地预览服务器（仅用于开发时看效果，不用于部署）
 *
 * 运行：node test/preview-server.mjs   （或 npm run preview）
 * 打开：http://localhost:8787
 *
 * 说明：
 * - 复用真实的 worker.js 代码路径（不是另写一份假接口）
 * - 上游模型调用被 mock 掉，返回一段固定的示例内容
 * - 目的是在没有 API Key 的情况下也能看到完整的界面与流式效果
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);

const MOCK_REPLY = `## 反推结果

**1. PyTorch 张量与自动求导**
- 证据：forward 中直接用 \`x.flatten(1)\` 操作张量，训练循环里调用 \`loss.backward()\`
- 推断：你理解张量形状变换，也知道反向传播需要显式调用 backward
- 置信度：0.92

**2. 神经网络模块化定义**
- 证据：使用 \`nn.Module\` 子类 + \`super().__init__()\`，层定义在 \`__init__\`、前向写在 \`forward\`
- 推断：掌握了 PyTorch 的标准建模范式，不是把网络写成一串函数
- 置信度：0.90

**3. 卷积层与通道概念**
- 证据：\`nn.Conv2d(1, 32, 3, padding=1)\` 中显式指定了输入通道 1、输出通道 32 与 padding
- 推断：你至少用过一次卷积，且知道通道数的含义
- 置信度：0.78

**4. 优化器与损失函数**
- 证据：\`torch.optim.Adam\` + \`cross_entropy\`，且按 \`zero_grad → backward → step\` 的顺序写了循环
- 推断：掌握了标准训练循环；但 Adam 是教程里最常见的默认选择，无法据此判断你会不会调参
- 置信度：0.68

**5. GPU 训练**
- 证据：\`model = Net().cuda()\`
- 推断：知道要把模型放到 GPU 上
- 置信度：0.55

## 需要确认

- **第 5 项（0.55）**：代码里只把模型移到了 GPU，**没有看到把数据 \`x, y\` 也搬上去**，也没有 \`.to(device)\` 的统一写法。这通常意味着是从教程里抄的片段，未必完整跑通过 GPU 训练。请确认。
- **未发现证据**：数据加载与划分（没有看到 \`DataLoader\` 或任何数据集代码）。如果你确实做过，把数据加载那部分也贴出来。`;

// ---- 用 mock 掉上游，复用真实 worker.js ----
const realFetch = globalThis.fetch;
globalThis.fetch = async () => {
  const enc = new TextEncoder();
  const chars = [...MOCK_REPLY];
  let i = 0;
  return new Response(
    new ReadableStream({
      async pull(c) {
        if (i >= chars.length) return c.close();
        const n = 3 + Math.floor(Math.random() * 4);
        c.enqueue(
          enc.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: chars.slice(i, i + n).join('') } }] })}\n\n`
          )
        );
        i += n;
        await new Promise((r) => setTimeout(r, 18));
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
};

const worker = (await import(new URL('../worker.js', import.meta.url).href)).default;
const ENV = { MODEL_API_KEY: 'demo-key', MODEL_NAME: 'demo-mock', ALLOW_ORIGIN: '*' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const request = new Request('http://localhost' + req.url, {
        method: req.method,
        headers: { 'Content-Type': req.headers['content-type'] || 'application/json' },
        body: req.method === 'POST' ? body : undefined,
      });
      const out = await worker.fetch(request, ENV);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      if (out.body) {
        const reader = out.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      }
      return res.end();
    }

    const file = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = path.join(WEB_DIR, file);
    if (!full.startsWith(WEB_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not Found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log('本地预览已启动： http://localhost:' + PORT);
    console.log('（上游模型是模拟的，用于预览界面与流式效果）');
    realFetch; // 保留引用，便于将来切换真实调用
  });
