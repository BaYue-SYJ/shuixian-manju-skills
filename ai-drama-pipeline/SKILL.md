---
name: ai-drama-pipeline
version: 1.0.0
description: |
  把 5 个 AI 短剧创作 skill（novel-characters / novel-outline / novel-art / novel-script / novel-storyboard）
  串成一条端到端流水线。给定一篇小说 + 编排参数，按 角色→大纲→美术→剧本→分镜 的顺序逐阶驱动对应子 skill，
  并强制每阶 validate 通过后才进入下一阶、把上一阶产物作为下一阶输入。
  支持只跑指定阶段（stages=...）与从某阶续跑（resume-from=...）。
  编排层只做调度与数据交接，不含任何创作能力，也不绕过任何子 skill 的质量门。
  末了把 5 份 HTML 报告聚合成一个带导航侧栏的单页面（index.html），用户无需逐个手动打开。
  Use when asked to 短剧流水线、AI短剧全流程、novel pipeline、一键生成短剧、把小说做成短剧。
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Glob
  - Skill
triggers:
  - ai-drama-pipeline
  - 短剧流水线
  - AI短剧全流程
  - novel pipeline
  - 一键生成短剧
  - 把小说做成短剧
metadata:
  license: Apache-2.0
  requires:
    skills:
      - novel-characters
      - novel-outline
      - novel-art
      - novel-script
      - novel-storyboard
    bins:
      - node          # >= 18；子 skill 的 .mjs 脚本依赖
    optional:
      - codex         # 仅出设定图/首帧图时需要；无则跳过出图，只交提示词
  runtimes:
    - claude-code
    - codex
---

## ai-drama-pipeline

你是 5 个 AI 短剧创作 skill 的**总调度**。你本身不写任何内容、不重写任何子 skill 逻辑，只负责四件事：

1. 收齐编排参数
2. 按固定顺序**驱动**对应子 skill（用 Skill 工具加载它，把它当指令执行）
3. 做**层间数据交接**（把上一阶的 JSON 路径喂给下一阶）
4. **卡住质量门**（每阶必须 validate 通过才进下一阶），并汇总产物

### 依赖（引用模式，必须已安装）
- `novel-characters`、`novel-outline`、`novel-art`、`novel-script`、`novel-storyboard`
- 运行时：`node >= 18`（子 skill 的 `.mjs` 脚本依赖）；`codex` 仅出图时需要

### 数据流（层间契约）
```
小说 ─[novel-characters]→ cast.json
     ─[novel-outline  (--cast cast.json)]→ outline.json
     ─[novel-art      (seed outline.json, --cast cast.json)]→ art.json
     ─[novel-script   (--outline outline.json --art art.json)]→ script.json
     ─[novel-storyboard (--script script.json --outline --art --cast)]→ storyboard.json + manifest.json
```
每阶产物默认落在同一个输出目录 `<out>/`，文件名约定 `<书名>-cast.json` / `<书名>-outline.json` / …。
编排层只负责把这些路径**正确传给下一阶**，不靠记忆转述内容。

---

### Step 0 — 收参数（缺了不开工）
一次问清；集数×时长与题材必问，其余给默认值：

| 参数 | 处理 |
| --- | --- |
| 小说（路径或正文） | 必问 |
| **总集数 × 单集时长** | **必问**，无合理默认 |
| **题材** | **必问**，决定爽点类型 |
| 画风 `realistic` \| `ghibli` | 默认 `realistic`，须与角色/场景档一致 |
| 报告语言 `zh` \| `en` | 默认 `zh` |
| 是否出图 | 默认否（需 codex）；无 codex 整步跳过 |
| `stages` | 默认全跑；可指定子集，如 `characters,outline,script` |
| `resume-from` | 从某阶续跑（上游 JSON 须已存在） |

### Step 1 — 逐阶驱动
对每一阶，用 **Skill 工具加载对应子 skill**（例如 `Skill skill="novel-outline"`），并把该子 skill 的 SKILL.md 当作执行指令。关键衔接：

- **角色阶**：正常产出 `cast.json`（novel-characters）。
- **大纲阶**：若角色阶已跑，把 `cast.json` 作为 `--cast` 输入（novel-outline 支持直接吃 cast）。
- **美术阶**：用 `outline.json` 做 `seed` 预填场景清单，并对账 `cast.json`（`--cast`）。
- **剧本阶**：传 `--outline outline.json` 与 `--art art.json`（novel-script）。
- **分镜阶**：传 `--script script.json`、`--outline`、`--art`、`--cast`；末了 `export` 出 `manifest.json`（novel-storyboard）。

只跑 `stages` 指定的子集；`resume-from` 时跳过其前的阶，直接从其开始，上游 JSON 必须已存在。

### Step 2 — 质量门（每阶必过，不可跳）
每阶驱动完成后，**必须跑该子 skill 的 `validate`（novel-outline 还可用 `checkup`）且全部质量门通过**，再进下一阶：

- 角色：引文逐字、提示词不含人名、语言分工
- 大纲：13 道门（角色分档、主场景上限、爽点间隔≤3集、每集钩子…）
- 美术：11 道门（锚点 3–5、无人、白底无手、提示词英文…）
- 剧本：10 道门（时长±15%、单句≤35字、钩子前3拍兑现、爽点认领…）
- 分镜：16 道门（节拍全覆盖、单镜≤15秒、H3 切点逐字对账…）

**任一阶失败**：停在那一阶，向用户报告未过的门与已产出的 JSON，**不要绕过质量门强行续跑**。改完该阶重跑 validate 通过后再继续。

### Step 3 — 收尾与汇报 + 页面聚合（新增）
1. **汇总**：输出目录位置、各阶 JSON/报告路径、总时长估算（若有）、未出图项（无 codex 时）。
2. **聚合为单页**：跑编排层自带的聚合脚本，把 5 份独立 HTML 报告拼成带导航侧栏的 `index.html`，单页内切换查看：

   ```bash
   # 在 ai-drama-pipeline/scripts/ 下执行
   node aggregate.mjs --out <输出目录> --name <书名>
   # 若某份报告用了非默认文件名，可显式指定：
   node aggregate.mjs --out <输出目录> --name <书名> \
     --map characters=report.html outline=outline-report.html \
     --map art=art-report.html script=script-report.html storyboard=storyboard-report.html
   ```

   - 脚本**只读取** 5 个子 skill 的 HTML 产物、**只新建** `index.html`，**绝不改动**原 5 份报告。
   - 自动探测每阶报告文件名（兼容 `report.html` / `<书名>-*-report.html` 等多种命名）；缺失的阶也会在侧栏列出但标注"未生成"，点击显示占位提示，不影响其余。
   - 生成的 `index.html` 含左侧阶段导航（角色→大纲→美术→剧本→分镜），点击切换 iframe 视图；支持 URL `#hash` 直达某一阶。
3. **汇报给用户**：给出 `<out>/index.html` 路径，说明"双击即开，左侧切换 5 份报告"；并附未生成的阶（若有）。

---

## 边界（编排层不做的事）
- **不改、不重写** 5 个子 skill 各自的 HTML 报告，聚合脚本只新建 `index.html` 做导航包裹。
- 不写角色设定、不分集大纲、不出场景道具、不写台词、不切镜头——那些全是子 skill 的活。
- 不重写子 skill 逻辑，不修改其 `.mjs` 脚本，不绕过其质量门。
- 子 skill 之间**只通过 JSON 文件交接**，不靠模型记忆转述。
- `codex` 缺失时，所有出图阶整步跳过，只交提示词，不做要 API key 的 CLI fallback。

### 出图替代通道（无 codex / 不用内置 ImageGen 时可选）
本编排层自带 `scripts/gen-image.mjs`：接入**国内免费服务「通义万相」(DashScope `wanx-v1`)** 文生图，零依赖（Node>=18 内置 fetch），走官方异步任务接口，自带重试与轮询。优先用它替代 codex `$imagegen` 与平台内置 ImageGen。详见 `scripts/gen-image.README.md`。

另支持 **`provider=openai`** —— 即任意 OpenAI 兼容的 `/v1/images/generations` 服务（含 OpenAI 官方的 ChatGPT 格式、硅基流动 SiliconFlow、本地开源模型等）。`size` 分隔符按 provider 自动规范（`openai` 用 `1024x1024` 保留 `x`，`tongyi` 用 `1280*720` 转 `*`），详见 `scripts/CONFIG.md` 的「ChatGPT / OpenAI 兼容格式」一节。

前置：在 [DashScope 控制台](https://dashscope.console.aliyun.com) 开通通义万相（送免费额度），拿到 `DASHSCOPE_API_KEY` 并 `export`。**endpoint / apiKey / model 等全部走配置（config.json 或环境变量 IMG_*），详见 `scripts/CONFIG.md`，密钥不进源码。**

流程：
1. 从 `cast.json` 取每个角色的 `image.sheet`、从 `art.json` 取每个场景/道具的 `image.sheet`（均为英文，直接喂图）。
2. 逐条调用生成 16:9 图（CLI 示例，size 用 `1280x720`，style 按需求选 `photography`/`<3d>` 等），按 **`slug(name)`** 落盘：
   - 角色：`images/<name>-sheet.png`（如 `images/沈知微-sheet.png`）
   - 场景/道具：`images/<name>-sheet.png`（用其 **`name`** 字段，如 `images/渡船船舱-sheet.png`；**不是 `id` 的 S01/P01**）
   ```bash
   export DASHSCOPE_API_KEY=sk-xxxx
   node scripts/gen-image.mjs --prompt "$(提取出的英文 sheet 提示词)" --size 1280x720 --style photography --out images/沈知微-sheet.png
   ```
3. 落盘后重跑 `render`（`node novel-characters.mjs render <cast.json> --html > report.html`、`node novel-art.mjs render <art.json> --html > art-report.html`，须在输出目录内执行），报告自动拾取 `images/<slug(name)>-sheet.png` 嵌入。
4. 合规：prompt 须符合国内内容审核规范；通义万相自带审核，违规会返回 `DataInspectionFailed`，模块如实抛出、不绕过。
5. 说明：通用图像模型对"三区/L形版式"还原度不如 codex 契约，属近似参考图；如需精确版式可后续用 Pillow 把多张子图合成。
- 5 个子 skill 版本不一（1.1 / 1.2 / 1.7），参数归一与调用契约以**各子 skill 的 SKILL.md 为准**；本编排层只负责顺序与交接。

## 自检
- 5 个依赖 skill 是否都已安装（见 metadata.requires.skills）。
- `node --version` 是否 ≥ 18。
- 输出目录是否可写。
- 任一阶产物缺失时，不进入下一阶。
