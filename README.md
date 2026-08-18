# novel-shortdrama-skills

把一本小说变成可拍 **AI 短剧** 的前期制作 Skill 五件套，专为 [WorkBuddy](https://www.workbuddy.cn) 设计。五个 Skill 各管一段、JSON 互相打通、逐层对账：

```
novel-characters → cast.json      （谁：角色资产）
novel-outline    → outline.json   （什么：故事结构与分集）
novel-art        → art.json       （哪里 + 拿什么：美术资产）
novel-script     → script.json    （怎么说：场次 + 节拍 + 台词）
novel-storyboard → storyboard.json（怎么拍：分镜 + H3 视频提示词）
```

- **novel-characters** — 从小说拆角色：人物画像、形象提示词、音色提示词，并为每个角色出设定图（半身像 + 三视图 + 细节条）。
- **novel-outline** — 把小说改编成短剧大纲五件套（改编说明 / 人物表 / 爽点表 / 分集梗概 / 资产清单），13 道质量门脚本硬核校验。
- **novel-art** — 给 AI 短剧出美术设定集（场景 + 叙事道具），交付跨集一致性方案（锚点 / 光照变体 / 空景提示词 / 道具状态变体 / 白底无手）。
- **novel-script** — 把分集梗概落成结构化剧本：场次 + 节拍流（动作节拍与台词行交替），台词逐句带说话人与语气，时长逐集按语速确定性折算。
- **novel-storyboard** — 给剧本出分镜：段（≤15s）→ 分镜（2–5s 剪切）→ 分镜图（关键帧），每段自带一条 MiniMax H3 视频提示词，可一键导出投产包。

五个 Skill 全部 **零依赖、零 API key**，只用 Node.js 标准库；质量门靠代码而非模型自觉。出图为可选项，走 `codex` 内置图像生成。按 `characters → outline → art → script → storyboard` 顺序串联，即可形成「小说 → 可拍 AI 短剧」的完整前期制作流水线。

## 安装 / 使用

方式一（推荐，WorkBuddy 用户）：把对应 `novel-*/` 目录整体复制到 `~/.workbuddy/skills/` 下即可，WorkBuddy 会自动识别其中的 `SKILL.md`。

方式二（通用）：克隆本仓库，按需取用子目录里的脚本与参考文档，脚本均可用 `node xxx.mjs` 直接运行。

每个 Skill 目录内都有独立的 `README.md`（含英文 `README.en.md`），详细步骤、参数与自测命令见各子目录。

## 目录结构

```
.
├── novel-outline/     # 大纲：小说 → 短剧分集结构
├── novel-characters/  # 角色：人物画像 + 设定图
├── novel-art/         # 美术：场景 + 叙事道具一致性
├── novel-script/      # 剧本：场次 + 节拍流 + 台词
└── novel-storyboard/  # 分镜：段 / 剪切 / 关键帧 + H3 提示词
```

每个 Skill 内含：`SKILL.md`（流程定义）、`scripts/`（零依赖 Node 脚本：chunk / merge / validate / render / seed 等）、`references/`（各趟 pass 的细规则）、`examples/`（自带样例与质量基准）。

## License

Apache-2.0 —— 见 [LICENSE](./LICENSE)。
