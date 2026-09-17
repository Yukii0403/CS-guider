#!/usr/bin/env node
/**
 * 把仓库里的专家包同步到 LearnBuddy 的专家目录，并重新注册。
 *
 * 为什么需要它：
 *   LearnBuddy 只会从固定的专家目录加载专家（$WORKBUDDY_CONFIG_DIR/plugins/marketplaces/my-experts/plugins）。
 *   而我们把专家包的源码放在仓库里做版本管理。两边是镜像关系，改了仓库不跑这个脚本，
 *   LearnBuddy 里跑的还是旧版本 —— 这是最容易踩的坑。
 *
 * 用法：
 *   node expert/sync.mjs            # 同步 + 注册
 *   node expert/sync.mjs --dry-run  # 只看会同步什么，不实际写入
 *
 * 实现说明：
 *   本脚本**不使用任何删除操作**（fs.rmSync / unlink）。原因是本机环境会给删除操作挂安全拦截，
 *   且删除本身也没有必要 —— 逐文件覆盖即可。若目标目录残留了源目录里已不存在的文件，
 *   脚本会列出来提醒你手工处理，而不是替你删。
 *
 * 注意：修改 plugin.json 里的 name / agentName / expertType 后，本脚本会拒绝执行 ——
 *       这几项是专家的唯一标识，改了会导致专家丢失，必须重新创建。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO_ROOT, 'expert', 'academic-nav');
const EXPERT_NAME = 'academic-nav';

const dryRun = process.argv.includes('--dry-run');

// ---- 解析专家目录 ----
const configDir = process.env.WORKBUDDY_CONFIG_DIR || path.join(os.homedir(), '.learnbuddy');
const EXPERT_HOME = path.join(configDir, 'plugins', 'marketplaces', 'my-experts', 'plugins');
const DEST = path.join(EXPERT_HOME, EXPERT_NAME);

// ---- 需要同步的内容（avatars 由 ImageGen 单独产出，不在仓库里管）----
const ITEMS = ['.codebuddy-plugin', 'agents', 'skills'];
const REGISTER_SCRIPT =
  'D:/Program Files/LearnBuddy/resources/app.asar.unpacked/resources/builtin-skills/expert-manager/scripts/register_expert.py';

let failed = false;

function die(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

function assertExists(p, label) {
  if (!fs.existsSync(p)) die(`找不到${label}：${p}`);
}

function guardIdentity() {
  const srcJson = path.join(SRC, '.codebuddy-plugin', 'plugin.json');
  const dstJson = path.join(DEST, '.codebuddy-plugin', 'plugin.json');
  if (!fs.existsSync(srcJson) || !fs.existsSync(dstJson)) return;

  const a = JSON.parse(fs.readFileSync(srcJson, 'utf8'));
  const b = JSON.parse(fs.readFileSync(dstJson, 'utf8'));
  if (a.name !== b.name || a.agentName !== b.agentName || a.expertType !== b.expertType) {
    console.error('✗ 检测到专家标识字段发生变化：');
    console.error(`    仓库: name=${a.name} agentName=${a.agentName} type=${a.expertType}`);
    console.error(`    线上: name=${b.name} agentName=${b.agentName} type=${b.expertType}`);
    console.error('  name / agentName / expertType 是专家的唯一标识，不能原地修改。');
    console.error('  如需改名，必须删除后用新名字重新创建专家。同步已中止。');
    process.exit(1);
  }
}

/** 逐文件复制，不使用删除操作 */
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function listFiles(root, base) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

function findPython() {
  const candidates = [
    process.env.PYTHON,
    'C:/Users/Yukii/.workbuddy/binaries/python/versions/3.13.12/python.exe',
    'python3',
    'python',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      execFileSync(c, ['-V'], { stdio: 'ignore' });
      return c;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

// ---- 执行 ----
console.log('仓库源：' + SRC);
console.log('专家目录：' + DEST);
console.log(dryRun ? '（--dry-run 模式，不会写入）\n' : '');

assertExists(SRC, '专家包源目录');
if (!dryRun) guardIdentity();

for (const item of ITEMS) {
  const from = path.join(SRC, item);
  const to = path.join(DEST, item);
  assertExists(from, '待同步内容 ' + item);

  if (dryRun) {
    console.log(`  将同步 ${item}（${listFiles(from, from).length} 个文件）`);
    continue;
  }
  copyTree(from, to);
  console.log(`  ✓ 已同步 ${item}（${listFiles(from, from).length} 个文件）`);
}

// ---- 陈旧文件提醒（只报告，不删除）----
if (!dryRun) {
  const stale = [];
  for (const item of ITEMS) {
    const from = path.join(SRC, item);
    const to = path.join(DEST, item);
    const srcSet = new Set(listFiles(from, from));
    for (const rel of listFiles(to, to)) {
      if (!srcSet.has(rel)) stale.push(`${item}/${rel}`);
    }
  }
  if (stale.length) {
    console.log('\n⚠ 目标目录里存在源目录已没有的文件（未自动删除）：');
    stale.forEach((f) => console.log('    ' + f));
    console.log('  如果确认无用，请手工删除后再跑一次。');
    failed = true;
  }
}

if (dryRun) process.exit(0);

// ---- 重新注册 ----
if (!fs.existsSync(REGISTER_SCRIPT)) {
  console.log('\n⚠ 未找到注册脚本，已跳过注册。请手动运行 expert-manager 的 register_expert.py。');
  process.exit(failed ? 1 : 0);
}

const py = findPython();
if (!py) {
  console.log('\n⚠ 未找到可用的 Python，已跳过注册。请手动运行 register_expert.py。');
  process.exit(failed ? 1 : 0);
}

console.log('\n正在重新注册…');
try {
  const out = execFileSync(py, [REGISTER_SCRIPT, DEST], { encoding: 'utf8' });
  console.log(out.trim());
  console.log('\n完成。专家已更新，重启会话或刷新专家中心即可看到。');
} catch (e) {
  console.error('✗ 注册失败：');
  console.error((e.stdout || '') + (e.stderr || e.message));
  process.exit(1);
}

process.exit(failed ? 1 : 0);
