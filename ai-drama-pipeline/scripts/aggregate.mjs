#!/usr/bin/env node
// aggregate.mjs — ai-drama-pipeline 页面聚合器
//
// 零依赖（仅 node 标准库，node >= 18）。
// 把 5 个子 skill 各自产出的独立 HTML 报告，整合到一个带导航侧栏的单页面里，
// 通过 iframe 切换查看，原 5 个 HTML 文件保持原样、绝不改动。
//
// 用法：
//   node aggregate.mjs --out <输出目录> [--name <项目名>] [--title <整页标题>]
//   node aggregate.mjs --out dukou --map characters=report.html outline=outline-report.html
//
// 说明：
//   - 不传 --map 时，按每阶的候选文件名自动探测（兼容 书名-cast-report.html / report.html 等多种命名）。
//   - 传 --map stage=path 可强制指定某一阶对应的 HTML（其余仍自动探测）。
//   - 若某阶报告缺失，侧栏照常列出，点击后 iframe 显示"未生成"提示，不影响其余 4 个。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 参数解析 ----------
const args = process.argv.slice(2);
const opt = { out: null, name: null, title: null, map: {} };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') opt.out = args[++i];
  else if (a === '--name') opt.name = args[++i];
  else if (a === '--title') opt.title = args[++i];
  else if (a === '--map') {
    const kv = args[++i].split('=');
    if (kv.length === 2) opt.map[kv[0]] = kv[1];
  } else if (a.startsWith('--map=')) {
    const kv = a.slice('--map='.length).split('=');
    if (kv.length === 2) opt.map[kv[0]] = kv[1];
  } else if (a === '-h' || a === '--help') {
    console.log('Usage: node aggregate.mjs --out <dir> [--name <name>] [--title <title>] [--map stage=path ...]');
    process.exit(0);
  }
}

if (!opt.out) {
  console.error('[aggregate] 缺少 --out 输出目录');
  process.exit(1);
}

const outDir = path.resolve(opt.out);
if (!fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
  console.error(`[aggregate] 输出目录不存在或不是目录: ${outDir}`);
  process.exit(1);
}

// ---------- 5 阶定义 ----------
// key        : 内部键
// label      : 侧栏主标题（固定中文）
// step       : 阶段序号
// candidates : 自动探测的候选文件名（按顺序，第一个存在者胜出）
const STAGES = [
  { key: 'characters', label: '角色设定', step: 1, candidates: ['report.html', 'cast-report.html', 'characters-report.html'] },
  { key: 'outline',    label: '分集大纲', step: 2, candidates: ['outline-report.html'] },
  { key: 'art',        label: '美术设定', step: 3, candidates: ['art-report.html'] },
  { key: 'script',     label: '剧本',     step: 4, candidates: ['script-report.html'] },
  { key: 'storyboard', label: '分镜',     step: 5, candidates: ['storyboard-report.html'] },
];

// 若用户给了 书名 前缀，则追加 书名-xxx-report.html 这类候选
const bookPrefix = opt.name ? opt.name : null;

function findReport(stage) {
  // 1) 显式 --map
  if (opt.map[stage.key]) {
    const p = path.join(outDir, opt.map[stage.key]);
    return fs.existsSync(p) ? opt.map[stage.key] : null;
  }
  // 2) 自动探测候选（含 书名- 前缀变体）
  const cands = [...stage.candidates];
  if (bookPrefix) {
    for (const c of stage.candidates) {
      // report.html 是 角色阶特例，不加前缀
      if (c === 'report.html') continue;
      cands.push(`${bookPrefix}-${c}`);
    }
  }
  for (const c of cands) {
    if (fs.existsSync(path.join(outDir, c))) return c;
  }
  return null;
}

function readTitle(fileRel) {
  try {
    const html = fs.readFileSync(path.join(outDir, fileRel), 'utf8');
    const m = html.match(/<title>([\s\S]*?)<\/title>/i);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

// 组装每阶信息
const stages = STAGES.map((s) => {
  const file = findReport(s);
  const present = !!file;
  return {
    key: s.key,
    label: s.label,
    step: s.step,
    file,
    present,
    title: present ? readTitle(file) : '',
  };
});

const presentCount = stages.filter((s) => s.present).length;

// ---------- 整页标题 / 项目名 ----------
const pageTitle = opt.title || (opt.name ? `${opt.name} · 短剧流水线总览` : 'AI 短剧流水线总览');
const projName = opt.name || (stages.find((s) => s.present && s.title)?.title || 'AI 短剧流水线');

// ---------- 生成 index.html ----------
const navItems = stages
  .map((s) => {
    const sub = s.present ? (s.title || s.label) : '（未生成）';
    const cls = s.present ? 'nav-item' : 'nav-item missing';
    const badge = s.present ? '' : '<span class="miss">缺</span>';
    return `<button class="${cls}" data-key="${s.key}" type="button">
      <span class="num">${s.step}</span>
      <span class="txt"><b>${s.label}</b><i>${escapeHtml(sub)}</i></span>
      ${badge}
    </button>`;
  })
  .join('\n');

// iframe 初始 src：首个存在的报告；缺失时给占位
const firstPresent = stages.find((s) => s.present);
const initSrc = firstPresent ? firstPresent.file : '';
const initKey = firstPresent ? firstPresent.key : stages[0].key;

const stageData = JSON.stringify(
  stages.map((s) => ({ key: s.key, file: s.file || '', present: s.present }))
);

const html = `<!doctype html>
<html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<style>
  :root{
    --paper:#eceded; --panel:#f5f6f5; --side:#e9ebe8; --ink:#191d21; --ink-2:#5b636a;
    --ink-3:#8c9298; --rule:#d2d5d0; --rule-2:#c2c6bf; --seal:#8a3324; --seal-2:#c56a4e;
    --ok:#3d6b4f; --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,-apple-system,sans-serif;
  }
  *{box-sizing:border-box}
  html,body{height:100%;margin:0}
  body{font-family:var(--sans);color:var(--ink);background:var(--paper);display:flex;height:100vh;overflow:hidden}
  /* 侧栏 */
  .sidebar{width:264px;flex:0 0 264px;background:var(--side);border-right:1px solid var(--rule-2);
    display:flex;flex-direction:column;padding:18px 14px;gap:14px;overflow-y:auto}
  .brand{font-size:12px;letter-spacing:.18em;color:var(--ink-3);text-transform:uppercase}
  .proj{font-size:18px;font-weight:700;line-height:1.3;color:var(--ink)}
  .proj small{display:block;font-size:12px;font-weight:400;color:var(--ink-3);margin-top:3px}
  .flow{font-size:11px;color:var(--ink-3);line-height:1.7;border-top:1px dashed var(--rule-2);
    border-bottom:1px dashed var(--rule-2);padding:8px 0}
  .nav{display:flex;flex-direction:column;gap:8px;margin-top:2px}
  .nav-item{display:flex;align-items:center;gap:11px;width:100%;text-align:left;cursor:pointer;
    background:var(--panel);border:1px solid var(--rule);border-radius:10px;padding:10px 12px;
    color:var(--ink);font-family:inherit;transition:.15s;position:relative}
  .nav-item:hover{border-color:var(--seal-2)}
  .nav-item.active{border-color:var(--seal);background:#fff;box-shadow:0 1px 0 var(--seal-soft,#8a332412) inset}
  .nav-item .num{flex:0 0 26px;height:26px;border-radius:50%;background:var(--rule);color:var(--ink-2);
    display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700}
  .nav-item.active .num{background:var(--seal);color:#fff}
  .nav-item .txt{display:flex;flex-direction:column;line-height:1.25;min-width:0}
  .nav-item .txt b{font-size:14px;font-weight:600}
  .nav-item .txt i{font-size:11px;color:var(--ink-3);font-style:normal;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .nav-item.missing{opacity:.6}
  .nav-item.missing .num{background:var(--rule-2);color:var(--ink-3)}
  .miss{position:absolute;top:8px;right:10px;font-size:10px;color:var(--ink-3);
    border:1px solid var(--rule-2);border-radius:4px;padding:0 4px}
  .foot{margin-top:auto;font-size:11px;color:var(--ink-3);line-height:1.6}
  /* 主区 */
  .main{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--paper)}
  .bar{height:42px;flex:0 0 42px;border-bottom:1px solid var(--rule-2);display:flex;align-items:center;
    gap:10px;padding:0 16px;background:var(--panel);font-size:13px;color:var(--ink-2)}
  .bar .crumb b{color:var(--ink)}
  .bar .tag{margin-left:auto;font-size:11px;color:var(--seal);border:1px solid var(--seal-soft,#8a332412);
    border-radius:999px;padding:1px 9px}
  #frame{flex:1;width:100%;border:0;background:#fff}
  .empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
    color:var(--ink-3);gap:10px;font-size:14px}
  .empty .big{font-size:40px}
  @media (max-width:640px){
    body{flex-direction:column}
    .sidebar{width:100%;flex:0 0 auto;max-height:42vh}
    .main{flex:1;min-height:0}
  }
</style>
</head><body>
  <aside class="sidebar">
    <div class="brand">AI 短剧流水线</div>
    <div class="proj">${escapeHtml(projName)}<small>五阶产出 · 单页导航</small></div>
    <div class="flow">角色 → 大纲 → 美术 → 剧本 → 分镜</div>
    <nav class="nav" id="nav">${navItems}</nav>
    <div class="foot">共 ${presentCount}/5 份报告已生成。<br>原 HTML 文件未被改动，此页仅做聚合与跳转。</div>
  </aside>
  <section class="main">
    <div class="bar">
      <span class="crumb">当前：<b id="crumb">—</b></span>
      <span class="tag" id="newtab">在新标签打开 ↗</span>
    </div>
    <iframe id="frame" title="报告视图" src="${initSrc ? escapeHtml(initSrc) : 'about:blank'}"></iframe>
  </section>

<script>
  const STAGES = ${stageData};
  const nav = document.getElementById('nav');
  const frame = document.getElementById('frame');
  const crumb = document.getElementById('crumb');
  const newtab = document.getElementById('newtab');

  function show(key, push){
    const s = STAGES.find(x=>x.key===key) || STAGES[0];
    nav.querySelectorAll('.nav-item').forEach(b=>{
      b.classList.toggle('active', b.dataset.key===s.key);
    });
    if (s.present && s.file){
      frame.src = s.file;
      crumb.textContent = s.label + (s.title ? ' · ' + s.title : '');
      newtab.style.display = '';
      newtab.onclick = ()=> window.open(s.file, '_blank');
    } else {
      frame.srcdoc = '<div style="font-family:sans-serif;color:#8c9298;display:flex;'+
        'height:100%;align-items:center;justify-content:center;flex-direction:column;gap:8px">'+
        '<div style="font-size:38px">∅</div><div>该阶报告尚未生成</div>'+
        '<div style="font-size:12px">运行对应子 skill 后此页面会自动可用</div></div>';
      crumb.textContent = s.label + ' · 未生成';
      newtab.style.display = 'none';
    }
    if (push !== false) location.hash = s.key;
  }

  nav.addEventListener('click', e=>{
    const btn = e.target.closest('.nav-item');
    if (btn) show(btn.dataset.key);
  });
  window.addEventListener('hashchange', ()=> show(location.hash.slice(1), false));

  // 初始：优先 hash，否则首个存在项
  const h = location.hash.slice(1);
  if (h && STAGES.some(x=>x.key===h)) show(h, false);
  else show('${initKey}', false);
</script>
</body></html>`;

const outFile = path.join(outDir, 'index.html');
fs.writeFileSync(outFile, html, 'utf8');

console.log(`[aggregate] 已生成聚合页: ${outFile}`);
console.log(`[aggregate] 报告命中: ${presentCount}/5`);
stages.forEach((s) => {
  console.log(`   ${s.step}. ${s.label.padEnd(4, '　')} ${s.present ? '✓ ' + s.file : '✗ 未找到'}`);
});

// ---------- 工具 ----------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
