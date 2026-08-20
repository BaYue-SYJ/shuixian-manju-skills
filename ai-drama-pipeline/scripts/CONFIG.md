# CONFIG.md — 配置模块说明（endpoint / apiKey / model）

`config.mjs` 是一个通用配置模块，让用户在**不改动源码**的前提下，填入自己的服务地址与密钥，
供图片生成（及后续其它请求）使用。强调：**密钥绝不硬编码进源码**，一律运行时从文件或环境变量读取。

## 配置入口（三选一 / 或组合）
按优先级从高到低合并：

| 优先级 | 入口 | 说明 |
| --- | --- | --- |
| 1 | 调用覆盖项（overrides） | 如 CLI 的 `--endpoint` / `--api-key` / `--model` / `--config` |
| 2 | 环境变量 | `IMG_ENDPOINT` / `IMG_API_KEY` / `IMG_MODEL` / `IMG_TIMEOUT_MS` / `IMG_STYLE` / `IMG_SIZE` / `IMG_CONFIG_FILE` |
| 3 | 配置文件 | 同目录下的 `config.json`（可用 `IMG_CONFIG_FILE` 或 `--config` 指定其它路径） |
| 4 | 内置默认值 | 含通义万相官方 endpoint；`apiKey` 默认为空（必须配置） |

> 兼容旧变量：通义万相密钥也接受 `DASHSCOPE_API_KEY`。

## 配置项说明
| 字段 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `provider` | 否 | `tongyi` | `tongyi`=通义万相异步协议；`openai`=OpenAI 兼容的 `/v1/images/generations`（含多数国内免费服务、本地开源模型） |
| `endpoint` | **是** | 通义万相官方地址 | 你的服务地址/URL。**provider=openai 时请填完整接口地址**（如 `https://api.siliconflow.cn/v1/images/generations`、`http://localhost:8080/v1/images/generations`） |
| `apiKey` | **是** | 空 | 你的 API 密钥。**切勿写入被提交到仓库的源码**；建议用环境变量或 `config.json`（并确保 `config.json` 不被提交） |
| `model` | 是 | `wanx-v1` | 模型名。通义：`wanx-v1`；OpenAI 兼容服务按各家填写（如 `black-forest-labs/FLUX.1-schnell`、`stable-diffusion-xl`） |
| `timeoutMs` | 否 | `180000` | 轮询/请求超时（毫秒） |
| `style` | 否 | `<auto>` | 仅通义万相：`photography`/`oil_painting`/`chinese painting`/… |
| `size` | 否 | 留空（按 provider 兜底） | 输出尺寸。留空时：`openai`/`compatible` 默认 `1024x1024`，`tongyi` 默认 `1280*720`。分隔符由 provider 自动规范——`openai` 用 `x`（如 `1024x1024`），`tongyi` 用 `*`（如 `1280*720`）；用户输入 `x` 或 `*` 写法均可，模块会归一化为对应 provider 的写法。 |

## ChatGPT / OpenAI 兼容格式（provider=openai）

「ChatGPT 格式」在本模块里对应的是 **`provider=openai`** —— 即任何实现了 OpenAI
`POST /v1/images/generations` 接口的服务（OpenAI 官方、以及硅基流动 SiliconFlow、
本地开源模型如 SDXL / FLUX 经 vLLM·ComfyUI 暴露的兼容接口等）。

它的请求形态与通义万相（异步任务）**不同**，要点如下：

| 维度 | openai / ChatGPT 格式 | 通义万相 tongyi |
| --- | --- | --- |
| 协议 | 同步，单次 POST 返回图片 | 异步，POST 建任务 → 轮询 GET |
| 接口地址 | **完整接口地址** `…/v1/images/generations` | 通义官方固定地址 |
| `model` | 各家自行指定（如 `gpt-image-1`、`black-forest-labs/FLUX.1-schnell`） | `wanx-v1` |
| `size` 分隔符 | **`x`**（如 `1024x1024`、`1792x1024`、`1024x1792`） | `*`（`1280*720`） |
| `size` 默认值（留空时） | `1024x1024` | `1280*720` |
| 结果 | `data[].url` 或 `data[].b64_json` | `output.results[].url` |

**配置填写示例（ChatGPT 兼容）：**
```json
{
  "provider": "openai",
  "endpoint": "https://api.siliconflow.cn/v1/images/generations",
  "apiKey": "sk-你的密钥",
  "model": "black-forest-labs/FLUX.1-schnell",
  "size": "1024x1024"
}
```
或用环境变量：
```bash
export IMG_PROVIDER=openai
export IMG_ENDPOINT="https://api.siliconflow.cn/v1/images/generations"
export IMG_API_KEY="sk-你的密钥"
export IMG_MODEL="black-forest-labs/FLUX.1-schnell"
```

> 注意：本模块只负责「按 OpenAI 格式发请求并解析结果」，至于背后是 OpenAI 官方
> 还是国内兼容服务、是否免费，取决于你填的 `endpoint` + `apiKey`，模块本身不绑定任何厂商。

## 必填项校验
`validateConfig(cfg)` 会检查：
- `endpoint` 存在且为合法的 `http(s)` URL；
- `apiKey` 存在（除非显式关闭 `requireKey`）；
- `model` 存在。
缺失时抛出清晰错误并提示通过「配置文件或环境变量」补齐，**不会带着空值发起请求**。

## 安全规范
1. **密钥不进源码**：`config.mjs` 内无任何真实密钥；真实值只在 `config.json` / 环境变量中存在。
2. **日志脱敏**：用 `redactKey(cfg)` 打印配置，`apiKey` 仅显示前 4 位 + 后 2 位（如 `sk-x****yz`）。
3. **勿提交密钥文件**：请将 `config.json` 加入 `.gitignore`（见下），仅提交 `config.example.json` 作为模板。
   ```
   # .gitignore
   config.json
   ```
4. **合规**：prompt 须符合国内内容审核规范；违规内容由服务端审核拦截，模块如实抛出、不绕过。

## 快速开始
```bash
# 方式一：环境变量（推荐，最简单）
export IMG_ENDPOINT="https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis"
export IMG_API_KEY="sk-你的密钥"
export IMG_MODEL="wanx-v1"

# 方式二：配置文件（复制模板后填写）
cp config.example.json config.json
# 编辑 config.json 填入 endpoint / apiKey / model
# 并确保 config.json 不被 git 提交

# 查看当前生效配置（密钥脱敏）
node config.mjs
# 生成示例模板
node config.mjs --write-example
```

## 在代码中读取
```js
import { loadConfig, validateConfig, redactKey } from './config.mjs';

const cfg = loadConfig({ configFile: 'config.json' }); // 或传 CLI overrides
validateConfig(cfg);                                   // 缺项会抛错
console.log('使用配置：', redactKey(cfg));              // 安全日志
// 后续请求使用 cfg.endpoint / cfg.apiKey / cfg.model …
```
