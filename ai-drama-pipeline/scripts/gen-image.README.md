# gen-image.mjs — 通义万相(wanx-v1) / OpenAI 兼容 文本生图模块

零依赖（Node >= 18，内置 `fetch`）的图片生成功能模块，接入**国内免费服务**或任意自定义地址：
- `provider=tongyi`（默认）：阿里云百炼 / DashScope「通义万相」`wanx-v1` 文生图（新用户开通送免费额度）；
- `provider=openai`：任意 OpenAI 兼容的 `/v1/images/generations` 服务（如硅基流动、本地开源模型等）。

本模块不依赖 codex，也不依赖 WorkBuddy 内置 ImageGen；**endpoint / apiKey / model 等配置全部来自 `config.json` 或环境变量，绝不硬编码**（详见 [CONFIG.md](./CONFIG.md)）。可作为 AI 短剧流水线（或其它场景）的「无 codex 出图」通道。

## 接入的具体服务
- **服务**：通义万相（DashScope 文本生图，`wanx-v1`）
- **免费额度**：在 [DashScope 控制台](https://dashscope.console.aliyun.com) 开通「通义万相」即送免费调用额度，无需付费即可使用。
- **接口形态**：采用官方「异步任务」接口——先 POST 创建任务拿到 `task_id`，再轮询任务状态，成功后在响应中取回图片 URL。该形态比同步接口更稳，能覆盖长耗时生图。

## 环境要求
- Node.js >= 18（使用内置 `fetch`）
- 一个 DashScope API Key（`sk-...`），来自 DashScope 控制台「API-KEY 管理」。

## 配置 API Key
推荐用环境变量（避免命令行泄露）：
```bash
export DASHSCOPE_API_KEY=sk-xxxxxxxx
```
或在调用时显式传 `--api-key`。

## 用法 A：命令行（CLI）
```bash
node gen-image.mjs --prompt "水墨风格的江南水乡渡口，晨雾弥漫" \
  --size 1280x720 --style "chinese painting" --out du_kou.png

# 批量（多张）落盘到目录，按任务 id 命名
node gen-image.mjs --prompt "..." --n 4 --dir ./images --size 1024x1024

# 用环境变量里的 key + JSON 输出
node gen-image.mjs --prompt "..." --json
```

## 用法 B：作为模块导入
```js
import { generateImage } from './gen-image.mjs';

const { taskId, urls, saved } = await generateImage({
  prompt: 'Semi-realistic character model sheet, 16:9...',
  apiKey: process.env.DASHSCOPE_API_KEY,
  size: '1280x720',
  style: 'photography',
  downloadDir: './images',
});
// saved -> ['./images/wanx-xxxx-1.png', ...]
```

## 关键参数
| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `prompt` | 文本提示词（中/英均可；地图/人物类建议英文更稳） | 必填 |
| `negativePrompt` | 反向提示词 | 可选 |
| `size` | 尺寸。`openai` 用 `x`（如 `1024x1024`），`tongyi` 用 `*`（如 `1280*720`）；留空时各 provider 自动兜底默认 | `openai→1024x1024` / `tongyi→1280*720` |
| `n` | 生成张数（1–4） | 1 |
| `style` | `<auto>`/`<2d>`/`<3d>`/`anime`/`photography`/`oil_painting`/`watercolor`/`sketch`/`chinese painting`/`flat illustration` | `<auto>` |
| `timeoutMs` / `intervalMs` | 轮询超时 / 间隔 | 180000 / 2000 |

## 稳定性与错误处理
- **重试**：网络抖动与 5xx 自动指数退避重试（默认 3 次）；4xx 直接抛错（无需重试）。
- **轮询**：创建任务后轮询直至 `SUCCEEDED`/`FAILED` 或超时，避免长任务掉链子。
- **错误映射**：把 DashScope 的 `InvalidApiKey`/`NoPermission`/`Throttling`/`DataInspectionFailed` 等码翻译成可读中文并附 `requestId`，便于排查。
- **本地落盘**：图片 URL 为临时链接，模块默认下载到本地（CLI 的 `--out` / `--dir`），利于后续流水线引用。

## 国内合规要点
1. 调用方须保证 prompt 符合《生成式人工智能服务安全规范》及内容审核要求；
2. 通义万相自带内容安全审核，违规内容会返回 `DataInspectionFailed`，模块如实抛出、不绕过；
3. API Key 仅从环境变量或参数读取，**绝不硬编码**；
4. 图片版权与用途请遵守 DashScope 服务条款与国内相关法律法规。

## ChatGPT / OpenAI 兼容格式（provider=openai）

「ChatGPT 格式」= 任意实现了 OpenAI `POST /v1/images/generations` 的服务。本模块通过
`provider=openai` 支持它，**不限定厂商**——背后是 OpenAI 官方、硅基流动 SiliconFlow、
还是本地开源模型（SDXL / FLUX 经 vLLM·ComfyUI 暴露的兼容接口），只看你填的 `endpoint` + `apiKey`。

与通义万相（异步任务）的关键差异：

- **同步返回**：单次 POST 即返回 `data[].url` 或 `data[].b64_json`，无需轮询；
- **接口地址填完整路径**：`endpoint` 必须是 `…/v1/images/generations` 这种完整接口地址；
- **`size` 用 `x` 分隔**：如 `1024x1024`、`1792x1024`、`1024x1792`（OpenAI 官方只认这几档；
  国内兼容服务可能支持更多尺寸，按各家文档填）；
- **`model` 各家自定**：如 `gpt-image-1`、`black-forest-labs/FLUX.1-schnell`、`stable-diffusion-xl`。

CLI 示例（ChatGPT 兼容，国内免费服务如 SiliconFlow）：
```bash
export IMG_PROVIDER=openai
export IMG_ENDPOINT="https://api.siliconflow.cn/v1/images/generations"
export IMG_API_KEY="sk-你的密钥"
export IMG_MODEL="black-forest-labs/FLUX.1-schnell"

node gen-image.mjs --prompt "水乡渡口晨雾，水墨风格" \
  --provider openai --size 1024x1024 --out du_kou.png --json
```

> 模块内部已做 provider 感知的尺寸归一：**`openai` 始终发 `1024x1024`（保留 x），`tongyi` 始终发 `1280*720`（转 *）**，
> 无论你在配置里写 `x` 还是 `*` 都会被正确归一，不会因为分隔符错误被服务端拒绝。

## 与 ai-drama-pipeline 的衔接
在 `ai-drama-pipeline/SKILL.md` 的「出图替代通道（无 codex 时可选）」中，本模块是**首选**的国内免费替代方案：
- 用 `cast.json` 每个角色的 `image.sheet`、`art.json` 每个场景/道具的 `image.sheet`（均为英文）作为 `prompt`；
- 生成后按 `slug(name)` 落盘到 `images/<name>-sheet.png`（**角色用 `name`，场景/道具也用其 `name` 字段，不是 `id`**）；
- 再跑 `render` 自动嵌入报告。
