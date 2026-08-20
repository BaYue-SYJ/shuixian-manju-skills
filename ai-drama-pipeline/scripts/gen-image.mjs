#!/usr/bin/env node
// gen-image.mjs — 文本生图模块 + CLI（读取 config.mjs 的配置：endpoint / apiKey / model）
// ─────────────────────────────────────────────────────────────────────────────
// 支持两类 provider（由配置 provider 决定）：
//   · tongyi : 通义万相(wanx-v1) 异步任务协议（默认，endpoint 用通义官方地址）
//   · openai : OpenAI 兼容的 /v1/images/generations（含多数国内免费服务、本地开源模型）
// 所有敏感配置（endpoint/key）来自 config.json 或环境变量，绝不硬编码。详见 CONFIG.md。
// 零依赖：Node >= 18 内置 fetch。
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfig, redactKey } from './config.mjs';

const DEFAULT_STYLE = '<auto>';

// 通义万相 / OpenAI 对尺寸分隔符要求不同：
//   · 通义万相 wanx-v1 接收 "1280*720"（星号）
//   · OpenAI / ChatGPT 兼容接口接收 "1024x1024"（小写 x）
// 两者都接受用户输入 "1280x720" 或 "1280*720"，这里按目标 provider 统一重写分隔符。
function formatSize(s, sep) {
  const raw = String(s || '').trim();
  if (!raw) return null; // 调用方负责按 provider 兜底默认
  return raw.replace(/[xX*]/g, sep);
}

// 带重试的 fetch：网络异常与 5xx 重试；4xx 直接抛错
async function fetchWithRetry(url, options, { retries = 3, baseDelay = 800 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(baseDelay * 2 ** attempt + Math.random() * 300);
    }
  }
  throw new Error(`请求失败（已重试 ${retries} 次）：${lastErr?.message || lastErr}`);
}

// 通义万相错误码 → 可读中文
function mapDashError(status, data) {
  const code = data?.code || '';
  const msg = data?.message || data?.Message || JSON.stringify(data);
  const table = {
    InvalidApiKey: 'API Key 无效或未配置（检查配置中的 apiKey / IMG_API_KEY）',
    Authentication: '鉴权失败：API Key 无效',
    NoPermission: '无权限：通义万相服务未开通或额度不足',
    Throttling: '触发限流（429），请降低并发或稍后重试',
    InvalidParameter: '请求参数错误',
    DataInspectionFailed: '内容安全审核未通过：prompt 含不合规内容，请修改后重试',
  };
  const hint = table[code] || table[String(status)] || '';
  return new Error(`[DashScope ${status}] ${hint || msg}` + (data?.requestId ? ` (requestId=${data.requestId})` : ''));
}

// 通用 OpenAI 兼容错误 → 可读中文
function mapOpenAIError(status, data) {
  const msg = data?.error?.message || data?.message || JSON.stringify(data);
  const table = {
    401: 'API Key 无效或未配置',
    403: '无权限或额度不足',
    429: '触发限流，请降低并发或稍后重试',
    400: '请求参数错误',
  };
  const hint = table[status] || '';
  return new Error(`[HTTP ${status}] ${hint || msg}`);
}

// 下载图片到本地（支持 http(s) URL 与 data:image base64）
async function download(urlOrData, dest) {
  if (urlOrData.startsWith('data:')) {
    const m = urlOrData.match(/^data:image\/(\w+);base64,(.*)$/);
    if (!m) throw new Error('无法解析 data: 图片');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    const target = dest.replace(/\.(png|jpg|jpeg)$/i, '.' + ext);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
    return target;
  }
  const res = await fetch(urlOrData);
  if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}: ${urlOrData}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return dest;
}

// 把一组图片 URL 落盘（out 单张 / downloadDir 批量）
async function finalize(urls, opts) {
  if (opts.out || opts.downloadDir) {
    const saved = [];
    for (let i = 0; i < urls.length; i++) {
      const local = opts.out
        ? opts.out
        : path.join(opts.downloadDir, `img-${i + 1}.png`);
      await download(urls[i], local);
      saved.push(local);
    }
    return { urls, saved };
  }
  return { urls };
}

// ── 通义万相（异步任务）──
async function generateViaTongyi(cfg, opts) {
  const body = {
    model: cfg.model,
    input: { prompt: String(opts.prompt).trim() },
    parameters: {
      size: formatSize(opts.size || cfg.size, '*') || '1280*720',
      n: Math.min(Math.max(1, parseInt(opts.n, 10) || 1), 4),
      style: opts.style || cfg.style || DEFAULT_STYLE,
    },
  };
  if (opts.negativePrompt && String(opts.negativePrompt).trim()) body.input.negative_prompt = String(opts.negativePrompt).trim();

  const res = await fetchWithRetry(cfg.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw mapDashError(res.status, data);
  const taskId = data?.output?.task_id;
  if (!taskId) throw new Error('未返回 task_id，响应：' + JSON.stringify(data));

  // 任务轮询地址取 endpoint 的 origin + /api/v1/tasks/{id}
  const base = new URL(cfg.endpoint).origin;
  const taskUrl = (id) => `${base}/api/v1/tasks/${id}`;

  const deadline = Date.now() + (cfg.timeoutMs || 180000);
  while (Date.now() < deadline) {
    const t = await fetch(taskUrl(taskId), { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    const td = await t.json().catch(() => ({}));
    if (!t.ok) throw mapDashError(t.status, td);
    const status = td?.output?.task_status;
    if (status === 'SUCCEEDED') {
      const results = td?.output?.results || [];
      if (!results.length) throw new Error('任务成功但未返回图片：' + JSON.stringify(td));
      return { taskId, provider: 'tongyi', ...(await finalize(results.map((r) => r.url), opts)) };
    }
    if (status === 'FAILED') throw new Error('生图任务失败：' + (td?.output?.message || td?.message || JSON.stringify(td)));
    await sleep(2000);
  }
  throw new Error(`轮询超时（>${cfg.timeoutMs}ms），任务 ${taskId} 未完成`);
}

// ── OpenAI 兼容（同步返回）──
async function generateViaOpenAI(cfg, opts) {
  const body = {
    model: cfg.model,
    prompt: String(opts.prompt).trim(),
    n: Math.min(Math.max(1, parseInt(opts.n, 10) || 1), 4),
    size: formatSize(opts.size || cfg.size, 'x') || '1024x1024',
  };
  if (opts.negativePrompt) body.negative_prompt = String(opts.negativePrompt).trim();

  const res = await fetchWithRetry(cfg.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw mapOpenAIError(res.status, data);

  const items = data?.data || [];
  const urls = items
    .map((it) => (it.url ? it.url : it.b64_json ? `data:image/png;base64,${it.b64_json}` : null))
    .filter(Boolean);
  if (!urls.length) throw new Error('未返回图片，响应：' + JSON.stringify(data).slice(0, 300));
  return { provider: 'openai', ...(await finalize(urls, opts)) };
}

/**
 * 生成图片（模块导出入口）。配置（endpoint/key/model）来自 config.mjs。
 */
export async function generateImage(opts = {}) {
  if (!opts.prompt || !String(opts.prompt).trim()) throw new Error('缺少 prompt（文本提示词）');
  const cfg = loadConfig(opts);
  validateConfig(cfg); // 必填项：endpoint + apiKey + model
  console.error('· 使用配置：' + JSON.stringify(redactKey(cfg)));
  if (cfg.provider === 'openai' || cfg.provider === 'compatible') return generateViaOpenAI(cfg, opts);
  return generateViaTongyi(cfg, opts);
}

// ── CLI ──
function parseArgs(argv) {
  const o = { _positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompt') o.prompt = argv[++i];
    else if (a === '--negative-prompt') o.negativePrompt = argv[++i];
    else if (a === '--size') o.size = argv[++i];
    else if (a === '--n') o.n = parseInt(argv[++i], 10);
    else if (a === '--style') o.style = argv[++i];
    else if (a === '--provider') o.provider = argv[++i];
    else if (a === '--endpoint') o.endpoint = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--api-key') o.apiKey = argv[++i];
    else if (a === '--config') o.configFile = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--dir') o.downloadDir = argv[++i];
    else if (a === '--timeout') o.timeoutMs = parseInt(argv[++i], 10);
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else o._positional.push(a);
  }
  if (!o.prompt && o._positional.length) o.prompt = o._positional.join(' ');
  return o;
}

const HELP = `
gen-image.mjs — 文本生图（通义万相 / OpenAI 兼容，配置来自 config.json 或环境变量）
用法：
  node gen-image.mjs --prompt "提示词" [选项]
配置（详见 CONFIG.md，密钥不硬编码）：
  --provider <tongyi|openai>   协议类型（默认读取配置，缺省 tongyi）
  --endpoint <url>             服务地址（覆盖配置；openai 时填完整接口地址）
  --api-key <key>              API 密钥（覆盖配置；建议用环境变量 IMG_API_KEY）
  --model <name>               模型名（如 wanx-v1 / stable-diffusion-xl）
  --config <file>              指定配置文件路径
生成参数：
  --negative-prompt <t> 反向提示词 | --size <WxH> | --n <1-4> | --style <s>
  尺寸分隔符：openai/ChatGPT 用 x（如 1024x1024，默认值）；tongyi 自动转 *（如 1280*720）
输出：
  --out <path> 单张落盘 | --dir <dir> 批量落盘目录
  -h/--help 帮助 | --json 以 JSON 输出
示例（OpenAI 兼容的国内免费服务）：
  export IMG_ENDPOINT="https://api.siliconflow.cn/v1/images/generations"
  export IMG_API_KEY="sk-xxx" IMG_MODEL="black-forest-labs/FLUX.1-schnell"
  node gen-image.mjs --provider openai --prompt "水乡渡口晨雾" --size 1280x720 --out du_kou.png
`;

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return; }
  try {
    const result = await generateImage(o);
    if (o.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`✓ [${result.provider}] 完成` + (result.taskId ? ` 任务 ${result.taskId}` : ''));
      result.urls.forEach((u, i) => console.log(`  图片${i + 1}: ${u}`));
      if (result.saved) result.saved.forEach((s) => console.log(`  已保存: ${s}`));
    }
  } catch (err) {
    console.error('✗ 生图失败：' + err.message);
    process.exit(1);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();
