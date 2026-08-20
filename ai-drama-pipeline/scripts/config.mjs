#!/usr/bin/env node
// config.mjs — 通用配置模块（endpoint / apiKey / model 等）
// ─────────────────────────────────────────────────────────────────────────────
// 用途：让用户在「不改动源码」的前提下，填入自己的服务地址(endpoint/URL)与密钥(apiKey)。
// 配置入口（优先级从高到低）：
//   1) 调用时传入的覆盖项（overrides，如 CLI 参数）
//   2) 环境变量（IMG_ENDPOINT / IMG_API_KEY / IMG_MODEL …）
//   3) 配置文件 config.json（默认与本模块同目录；可用 IMG_CONFIG_FILE 或 --config 指定）
//   4) 内置默认值（含通义万相官方地址）
//
// 安全：本模块不含任何真实密钥，密钥一律在运行时从「文件 / 环境变量」读取；
//       提供 redactKey() 用于在日志中脱敏展示。
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 内置默认值（endpoint 为通义万相官方地址；apiKey 故意留空，必须由用户配置）
export const DEFAULTS = {
  provider: 'tongyi',                 // tongyi(通义万相异步协议) | openai(OpenAI 兼容 /v1/images/generations)
  endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
  apiKey: '',
  model: 'wanx-v1',
  timeoutMs: 180000,
  style: '<auto>',
  // 尺寸默认留空：交由各 provider 在请求时按自身规范兜底
  //   · openai/ChatGPT 兼容 → 1024x1024
  //   · tongyi 通义万相      → 1280*720
  size: '',
};

// 环境变量 → 配置字段映射（环境变量名统一以 IMG_ 开头，便于区分）
function fromEnv() {
  const e = process.env;
  const out = {};
  if (e.IMG_PROVIDER) out.provider = e.IMG_PROVIDER;
  if (e.IMG_ENDPOINT) out.endpoint = e.IMG_ENDPOINT;
  // 密钥：优先 IMG_API_KEY；兼容旧变量 DASHSCOPE_API_KEY（通义万相）
  if (e.IMG_API_KEY) out.apiKey = e.IMG_API_KEY;
  else if (e.DASHSCOPE_API_KEY) out.apiKey = e.DASHSCOPE_API_KEY;
  if (e.IMG_MODEL) out.model = e.IMG_MODEL;
  if (e.IMG_TIMEOUT_MS) out.timeoutMs = parseInt(e.IMG_TIMEOUT_MS, 10);
  if (e.IMG_STYLE) out.style = e.IMG_STYLE;
  if (e.IMG_SIZE) out.size = e.IMG_SIZE;
  if (e.IMG_CONFIG_FILE) out.__configFile = e.IMG_CONFIG_FILE;
  return out;
}

function resolveConfigFile(explicit) {
  return path.resolve(explicit || process.env.IMG_CONFIG_FILE || path.join(__dirname, 'config.json'));
}

function fromFile(file) {
  const p = resolveConfigFile(file);
  if (!fs.existsSync(p)) return {}; // 没有配置文件不算错误，继续用 env/默认值
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`配置文件读取/解析失败 ${p}：${err.message}`);
  }
}

function stripUndefined(obj) {
  const r = {};
  for (const k of Object.keys(obj)) if (obj[k] !== undefined) r[k] = obj[k];
  return r;
}

/**
 * 加载并合并配置。
 * @param {Object} overrides 最高优先级覆盖项（如 CLI 解析出的参数）
 * @returns 合并后的配置对象
 */
export function loadConfig(overrides = {}) {
  const file = fromFile(overrides.configFile || overrides.__configFile);
  const env = fromEnv();
  return {
    ...DEFAULTS,
    ...stripUndefined(file),
    ...stripUndefined(env),
    ...stripUndefined(overrides),
  };
}

/**
 * 必填项校验。
 * @param {Object} cfg loadConfig 的结果
 * @param {Object} opt requireKey/requireEndpoint 是否把该项视为必填
 * @throws 缺失时抛出带清晰说明的错误
 */
export function validateConfig(cfg, { requireKey = true, requireEndpoint = true } = {}) {
  const missing = [];
  if (requireEndpoint && !cfg.endpoint) missing.push('endpoint（图片生成服务地址/URL）');
  if (requireKey && !cfg.apiKey) missing.push('apiKey（API 密钥）');
  if (!cfg.model) missing.push('model（模型名，如 wanx-v1）');
  if (cfg.endpoint && !/^https?:\/\//i.test(String(cfg.endpoint))) {
    missing.push('endpoint 必须是合法的 http(s) URL');
  }
  if (missing.length) {
    throw new Error(
      '配置缺失必填项：' + missing.join('；') +
      '\n  → 可在配置文件 config.json 或环境变量中提供：' +
      '\n    IMG_ENDPOINT / IMG_API_KEY / IMG_MODEL（或 DASHSCOPE_API_KEY）'
    );
  }
  return true;
}

/** 脱敏副本：用于安全日志，绝不打印真实密钥 */
export function redactKey(cfg) {
  const c = { ...cfg };
  if (c.apiKey) {
    const k = c.apiKey;
    c.apiKey = k.length <= 6 ? '****' : k.slice(0, 4) + '****' + k.slice(-2);
  }
  return c;
}

/** 将示例配置写入目标路径（不含真实密钥，仅占位），方便用户照填 */
export function writeExample(target = path.join(__dirname, 'config.example.json')) {
  const example = {
    provider: 'tongyi',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
    apiKey: '<在此填入你的 API Key，或用环境变量 IMG_API_KEY>',
    model: 'wanx-v1',
    timeoutMs: 180000,
    style: '<auto>',
    size: '1280x720',
  };
  fs.writeFileSync(target, JSON.stringify(example, null, 2));
  return target;
}

// CLI 小工具：node config.mjs [--write-example] [--show]
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.includes('--write-example')) {
    console.log('已生成示例配置：' + writeExample());
  } else {
    const cfg = loadConfig();
    validateConfig(cfg, { requireKey: false }); // 展示时不强制 key
    console.log('当前生效配置（密钥已脱敏）：');
    console.log(JSON.stringify(redactKey(cfg), null, 2));
  }
}
