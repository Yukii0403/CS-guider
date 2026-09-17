/**
 * 组装 Cloudflare Pages 的部署目录
 *
 * 为什么需要这一步：
 *   Pages 要求把「要部署的目录」整体上传，而 web-demo/ 里除了 index.html 与 worker.js，
 *   还有 .env（含密钥）、.dev.vars、test/、README 等不该上传的东西。
 *   所以这里只挑出两个必要文件，复制到 dist/，再对 dist/ 做部署。
 *
 *   - index.html  → 静态资源，Pages 直接提供访问
 *   - worker.js   → 改名为 _worker.js，这是 Pages「高级模式」的约定入口
 *
 * 用法：
 *   node scripts/build-pages.mjs
 *   npx wrangler pages deploy dist --project-name=academic-nav --branch=main
 *
 * 依赖：仅 Node 标准库。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(WEB_DIR, 'dist');

const FILES = [
  { from: 'index.html', to: 'index.html' },
  { from: 'worker.js', to: '_worker.js' }, // Pages 高级模式的固定入口名
];

// 不使用任何删除操作（本机删除会被安全拦截器接管且易失败），
// 逐文件覆盖即可 —— 源目录固定只有这两个文件，不会残留。
fs.mkdirSync(DIST, { recursive: true });

for (const f of FILES) {
  const src = path.join(WEB_DIR, f.from);
  const dst = path.join(DIST, f.to);
  if (!fs.existsSync(src)) {
    console.error('✗ 找不到源文件：' + src);
    process.exit(1);
  }
  fs.copyFileSync(src, dst);
  const kb = (fs.statSync(dst).size / 1024).toFixed(1);
  console.log(`  ✓ ${f.from} → dist/${f.to}  (${kb} KB)`);
}

console.log('\n已组装 dist/。下一步：');
console.log('  npx wrangler pages deploy dist --project-name=academic-nav --branch=main\n');
