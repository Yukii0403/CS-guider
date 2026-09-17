#!/usr/bin/env node
/**
 * Cloudflare 部署自检脚本
 *
 * 一条命令回答三个问题：
 *   ① 我的 Cloudflare Token 有效吗？
 *   ② Pages 项目的模型密钥设上了吗？
 *   ③ 线上服务到底通不通？
 *
 * 用法（在任何目录下都能跑）：
 *   node D:\Learnbuddy\2026-09-17-01-24-16\web-demo\scripts\check-cloudflare.mjs
 *
 * 依赖：仅 Node 标准库 + 系统自带的 curl。
 *      刻意用 curl 而不是 fetch —— curl 会自动遵循系统代理设置，
 *      而 Node 自带的 fetch 默认不走代理，在这台机器上会连不上。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(WEB_DIR, '.env');
const PROJECT = 'academic-nav';

function curlJson(url, token) {
  const args = ['-s', '--max-time', '30', '-H', `Authorization: Bearer ${token}`, url];
  try {
    const out = execFileSync('curl', args, { encoding: 'utf8' });
    return JSON.parse(out);
  } catch (e) {
    return { success: false, errors: [{ message: 'curl 调用失败：' + (e.message || e) }] };
  }
}

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.log('✗ 找不到 .env 文件：' + ENV_PATH);
    process.exit(1);
  }
  const vals = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    vals[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }
  return vals;
}

const env = readEnv();
const token = env.CLOUDFLARE_API_TOKEN || '';
const modelKey = env.MODEL_API_KEY || '';

console.log('配置文件：' + ENV_PATH);
console.log('  CLOUDFLARE_API_TOKEN 长度 ' + token.length);
console.log('  MODEL_API_KEY        长度 ' + modelKey.length);
console.log('');

if (token.length < 20) {
  console.log('✗ Cloudflare Token 明显没填。先去 https://dash.cloudflare.com/profile/api-tokens 创建。');
  process.exit(1);
}

// ---------- ① Token 是否有效 ----------
let tokenOk = false;
console.log('[1/3] 校验 Cloudflare Token …');
const verify = curlJson('https://api.cloudflare.com/client/v4/user/tokens/verify', token);

if (!verify.success) {
  const err = (verify.errors && verify.errors[0]) || {};
  console.log('  ✗ 无效 —— ' + (err.message || '未知错误') + '  (code ' + err.code + ')');
  console.log('');
  if (err.code === 1000 || err.code === 9109) {
    console.log('  这个值不是有效的 Cloudflare API Token。常见原因：');
    console.log('    · 复制的是 Token 名称 / Token ID，而不是 Token 值本身（值只在创建成功时显示一次）');
    console.log('    · 把旧 token 删掉或 Roll 之后，填的还是旧值');
    console.log('    · 从别的页面复制了 Global API Key（那个不是 API Token）');
    console.log('');
    console.log('  正确的获取方式：');
    console.log('    profile/api-tokens → Create Token → 选 "Edit Cloudflare Workers" 模板');
    console.log('    → Continue to summary → Create Token → 复制顶部绿色框里那一长串');
  } else if (err.code === 10502) {
    console.log('  连续失败触发了临时限流，等 15 分钟再试。');
  }
  console.log('');
  console.log('  （Token 无效不影响第 3 步的线上实测，继续…）');
} else {
  console.log('  ✓ Token 有效，状态：' + (verify.result && verify.result.status));
  tokenOk = true;
}

// ---------- ② Pages 环境变量 ----------
console.log('');
console.log('[2/3] 检查 Pages 项目的模型密钥 …');

if (!tokenOk) {
  console.log('  ⚠️ 跳过（需要有效的 Token 才能读项目配置）');
} else {
  const accounts = curlJson('https://api.cloudflare.com/client/v4/accounts', token);
  const acc = accounts.success && accounts.result && accounts.result[0];
  if (!acc) {
    console.log('  ⚠️ 拿不到账号列表，跳过这一步。Token 可能缺少 Account 读取权限。');
  } else {
    const proj = curlJson(
      `https://api.cloudflare.com/client/v4/accounts/${acc.id}/pages/projects/${PROJECT}`,
      token
    );
    if (!proj.success) {
      console.log('  ⚠️ 读不到项目配置：' + JSON.stringify(proj.errors));
    } else {
      const dc = (proj.result.deployment_configs || {}).production || {};
      const vars = dc.env_vars || {};
      const names = Object.keys(vars);
      console.log('  production 环境变量：' + (names.length ? names.join(', ') : '（一个都没有）'));

      if (vars.MODEL_API_KEY && vars.MODEL_API_KEY.value) {
        console.log('  ✓ MODEL_API_KEY 已设置（类型 ' + vars.MODEL_API_KEY.type + '）');
      } else {
        console.log('  ✗ MODEL_API_KEY 未设置 —— 这就是模型不能用的原因');
        console.log('    去 dashboard：Workers & Pages → academic-nav → Settings');
        console.log('    → Variables and secrets → Production → Add');
      }

      const dep = proj.result.latest_deployment;
      if (dep) {
        const st = dep.latest_stage || {};
        console.log(
          '  最新部署：' + dep.created_on + '  环境=' + dep.environment + '  ' + st.name + ':' + st.status
        );
        console.log('  ⚠️ 改了环境变量后必须再部署一次才生效：Deployments → ⋯ → Retry deployment');
      }
    }
  }
}

// ---------- ③ 线上是否真的通了 ----------
console.log('');
console.log('[3/3] 线上实测 …');
const host = 'https://academic-nav-82s.pages.dev';
try {
  const health = execFileSync('curl', ['-s', '--max-time', '30', host + '/api/health'], {
    encoding: 'utf8',
  });
  const h = JSON.parse(health);
  console.log('  /api/health → ' + JSON.stringify(h));
  if (h.hasKey) {
    console.log('  ✓✓ 全部就绪，模型可以正常调用。');
  } else {
    console.log('  ✗ hasKey 仍是 false —— 密钥没生效（没设，或设了但没重新部署）。');
  }
} catch (e) {
  console.log('  ✗ 访问失败：' + (e.message || e));
}
console.log('');
