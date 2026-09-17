/**
 * 学术前沿知识导航 · 云函数代理
 * ------------------------------------------------------------------
 * 部署目标：Cloudflare Workers（推荐，邮箱注册即可，无需实名）
 * 兼容：Vercel Edge Function —— 改法见文件末尾注释
 *
 * 作用：浏览器 → 本函数 → 大模型
 * 密钥只存在服务端环境变量里，永远不下发到浏览器。
 *
 * 环境变量：
 *   MODEL_API_KEY   必填。模型服务商的 API Key
 *   MODEL_BASE_URL  选填。默认 https://api.deepseek.com/v1
 *   MODEL_NAME      选填。默认 deepseek-chat
 *   ALLOW_ORIGIN    选填。默认 *（上线后建议改成你自己的页面地址）
 * ------------------------------------------------------------------
 */

const DEFAULTS = {
  MODEL_BASE_URL: 'https://api.deepseek.com/v1',
  MODEL_NAME: 'deepseek-chat',
};

/* ============================ 提示词（skill 逻辑）============================
 * 三段提示词是本产品的核心资产，分别对应三种模式：
 *   chat    —— 通用对话与领域定位
 *   analyze —— 从项目代码反推能力
 *   plan    —— 学习路线规划
 *
 * 注意：Web 版与 LearnBuddy 专家智能体版必须保持同一份文本，避免两个交付形态分叉。
 * 本仓库 prompts/ 目录是它们共同的来源。
 * ========================================================================= */

const SYSTEM_PROMPTS = {
  chat: `你是「学术前沿知识导航」助手，服务对象是刚开始接触科研的本科生与研究生。

你的职责：帮助用户把模糊的兴趣收敛成具体的研究方向，并规划可达成的学习路径。

工作原则：
1. 用户说不清方向时，用**选项式追问**——一次给出 2 到 4 个具体方向让他挑，不要开放式地问"你想学什么"。
2. 追问最多 2 到 3 轮，之后必须给出你的判断："我理解你想做的是 X，对吗？"
3. 只要涉及学习顺序，就必须说明**为什么是这个顺序**，而不是只给结论。
4. 严禁编造论文标题、作者、会议名和链接。不确定就直接说不确定。
5. 回答使用简体中文，结构清楚，控制在 400 字以内。

如果用户的输入与"目标领域定位""学习路径规划""能力诊断"无关，就当作普通对话正常回答，不要强行往这三个方向拽。`,

  analyze: `你是「能力反推」分析器。用户会粘贴一段项目代码、代码片段或项目文件结构。你要从中反推他**可能已经掌握**的知识点。

输出格式必须严格遵守，不要添加额外章节：

## 反推结果

**1. 知识点名称**
- 证据：引用代码里具体的位置或写法
- 推断：说明他掌握了什么
- 置信度：0.XX

**2. 知识点名称**
（同上结构，最多 6 条）

## 需要确认

- 列出置信度低于 0.6 的项，逐条说明为什么不确定

规则：
1. **只依据代码里真实存在的证据。** 不能因为"做图像分类一般会用到 CNN"就推断他会 CNN。
2. 证据必须具体到函数名、库调用、写法特征，不能写"这段代码体现了深度学习能力"这类空话。
3. 置信度标准：**0.9 以上**＝代码中有明确直接证据；**0.6 到 0.9**＝有较强特征但可能来自教程模板；**0.6 以下**＝仅为弱信号。
4. 如果某个方面没有发现证据，明确写"未发现证据"，不要略过也不要猜。
5. 按置信度从高到低排列。`,

  plan: `你是「学习路线规划师」。根据用户的目标领域、当前掌握情况与可投入时间，产出一份分阶段的学习计划。

**第一步：先确认信息**
如果缺少以下任何一项，先用一句话问清楚，不要自己假设一个数值就开始排：
- 目标领域
- 期限（到什么时候）
- 每天或每周能投入多少小时

**第二步：先出骨架**

## 计划目标
一句话说明结束时用户应该能做什么。必须可验证，不要写"掌握深度学习"这种无法检验的话。

## 缺口分析
列出达成目标所缺的关键能力，按重要性排序，并标注属于哪一类：
数学基础 / 编程基础 / 理论基础 / 工具基础 / 科研素养。

## 阶段安排

**阶段一 · 名称**（起止日期，共 N 天）
- 这一阶段解决什么
- 关键产出：做到什么算过关

（后续阶段同上，最多 5 个）

## 时间预算
- 总可用：X 小时
- 各阶段分配：……
- 缓冲安排：缓冲日放在哪里

## 明确不做
这次不打算覆盖什么，以及为什么。

**第三步：用户确认骨架后**
如果他说"展开阶段一"之类，就把该阶段逐日展开成表格：

| 日期 | 内容 | 来源 | 时长 | 当天完成什么 |

「当天完成什么」必须是可验证的产出，例如"能在简单情形套用两个不等式"，不能写"读 6.2 节"。

规则：
1. 阶段按前置依赖排：后一个阶段必须真的需要前一个阶段的产出，不能只是主题相近。
2. 每 1 到 2 周必须留一个缓冲日，不允许把时间排满。
3. 各阶段时间之和不得超过用户给出的可投入时间。超了要明说需要删掉什么，不要假装排得下。
4. 用户缺口大但时间紧时，直接说出来，并建议缩小目标范围，而不是硬排一份做不到的计划。
5. 必须写"这次不做的事"。敢于说"不做什么"的计划，比什么都想覆盖的计划更可信。
6. 计划形态按缺口分，不按学历身份分：缺口大则知识线 80 比论文线 20；有基础则 50 比 50；前置扎实则 25 比 75。配比是建议起点，告诉用户可以改。
7. 一次只展开一个阶段，不要一次性排出几十天。`,
};

/* ============================== 工具函数 ============================== */

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function withCors(res, env) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', env.ALLOW_ORIGIN || '*');
  h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}

/* ============================== 主逻辑 ============================== */

async function handleChat(request, env) {
  const apiKey = env.MODEL_API_KEY;
  if (!apiKey) {
    return json({ ok: false, error: '服务端未配置 MODEL_API_KEY 环境变量' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: '请求体不是合法 JSON' }, 400);
  }

  // 三种模式：chat 通用对话 / analyze 能力反推 / plan 路线规划
  const mode = ['analyze', 'plan'].includes(body.mode) ? body.mode : 'chat';

  // 最多保留最近 12 条消息，防止上下文无限膨胀
  const messages = Array.isArray(body.messages)
    ? body.messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-12)
    : [];

  if (!messages.length) {
    return json({ ok: false, error: 'messages 不能为空' }, 400);
  }

  // 单条消息长度上限，防止有人塞一本书进来
  const MAX_CHARS = 24000;
  const cleaned = messages.map((m) => ({
    role: m.role,
    content: m.content.slice(0, MAX_CHARS),
  }));

  const base = String(env.MODEL_BASE_URL || DEFAULTS.MODEL_BASE_URL).replace(/\/+$/, '');
  const model = env.MODEL_NAME || DEFAULTS.MODEL_NAME;

  const upstream = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model,
      stream: true,
      // 需要稳定结构的模式温度调低，闲聊时高一点
      temperature: { analyze: 0.2, plan: 0.3, chat: 0.6 }[mode],
      messages: [{ role: 'system', content: SYSTEM_PROMPTS[mode] }, ...cleaned],
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return json(
      { ok: false, error: `模型接口返回 ${upstream.status}：${text.slice(0, 300)}` },
      502
    );
  }

  // 直接透传上游的 SSE 流
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

/* ============================== 入口 ============================== */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), env);
    }

    // 健康检查：部署完先访问这个地址确认函数活着
    if (url.pathname === '/api/health') {
      return withCors(
        json({
          ok: true,
          model: env.MODEL_NAME || DEFAULTS.MODEL_NAME,
          hasKey: Boolean(env.MODEL_API_KEY),
        }),
        env
      );
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        return withCors(await handleChat(request, env), env);
      } catch (err) {
        return withCors(
          json({ ok: false, error: '服务端异常：' + String((err && err.message) || err) }, 500),
          env
        );
      }
    }

    // Cloudflare Pages 高级模式：非 /api/ 的请求交给静态资源（index.html）。
    // Workers 模式下环境里没有 env.ASSETS，这段会自动跳过，行为不变。
    //
    // 为什么要走 Pages：*.workers.dev 这个域名在国内被 DNS 污染 + SNI 阻断，
    // 而同样部署在 Cloudflare 上的 *.pages.dev 域名国内可以正常访问。
    if (env.ASSETS && !url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    return withCors(json({ ok: false, error: '未知路径，请使用 /api/chat' }, 404), env);
  },
};

/* ============================== Vercel 改法 ==============================
 * 如果你要用 Vercel 而不是 Cloudflare Workers：
 *
 * 1. 把本文件复制为 api/chat.js（放在项目根的 api/ 目录下）
 * 2. 删掉末尾的 `export default { async fetch(...) }` 整块，替换为：
 *
 *      export const config = { runtime: 'edge' };
 *
 *      export default async function handler(request) {
 *        const env = process.env;
 *        const url = new URL(request.url);
 *        if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), env);
 *        if (url.pathname === '/api/health') return withCors(json({ ok: true }), env);
 *        if (url.pathname === '/api/chat' && request.method === 'POST') {
 *          try { return withCors(await handleChat(request, env), env); }
 *          catch (err) { return withCors(json({ ok: false, error: String(err) }, 500), env); }
 *        }
 *        return withCors(json({ ok: false, error: '未知路径' }, 404), env);
 *      }
 *
 * 3. 环境变量在 Vercel 控制台 Settings → Environment Variables 里配置
 * 4. 部署后你的函数地址是 https://<项目名>.vercel.app/api/chat
 * ======================================================================= */
