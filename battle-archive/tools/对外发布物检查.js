// 对外发布物 / 收回成稿的验收闸（可复用）
// 用法：
//   node 对外发布物检查.js <文件> [选项]
//   选项：--name 名称  --need "必须含,用逗号分隔"  --topics "标签1,标签2"
//         --prefix 标题前缀  --range 最小字数,最大字数  --url 要验证可达的链接
// 判定：红线扫描 + 内部数字泄露 + 必含要素 + 话题 + 标题前缀 + 字数 + 链接真连
const fs = require("fs");

const argv = process.argv.slice(2);
const file = argv[0];
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const need = (opt("--need", "") || "").split(",").map(s => s.trim()).filter(Boolean);
const topics = (opt("--topics", "") || "").split(",").map(s => s.trim()).filter(Boolean);
const prefix = opt("--prefix", "");
const name = opt("--name", file || "");
const range = (opt("--range", "0,99999") || "0,99999").split(",").map(Number);
const url = opt("--url", "");

// 默认红线词表：只放与环境无关的通用三类（路径形态/凭据字样/商业化表述）。
// ⚠️ 词表本身会被发布——任何具体内部命名（项目代号/内部机制名/私有端口/真实数字）
// 一律加进下面的 USER_WORDS，不进默认表；默认表发出去也不暴露任何内部信息。
const DEFAULT_FORBIDDEN = [
  { re: /[A-Za-z]:[/\\]|C:[/\\]Users|[/\\]home[/\\]/i, why: "本地路径/家目录" },
  { re: /密码|口令|api[_ ]?key|secret|私钥|token\s*[:=]/i, why: "凭据类字样" },
  { re: /融资|估值|变现|营收|付费转化/i, why: "商业化表述" }
];
// 用户自定义词表（示例写法，改成你自己环境里的词）：
//   { re: /my-internal-name/i, why: "内部机制名（自定义）" }
//   { re: /12345|67890/, why: "内部端口/真实数字" }
const USER_WORDS = [];
const FORBIDDEN = DEFAULT_FORBIDDEN.concat(USER_WORDS);
const cjk = s => (s.match(/[\u4e00-\u9fa5]/g) || []).length;

(async function () {
  if (!file) { console.log("用法：node 对外发布物检查.js <文件> [--name ..] [--need ..] [--topics ..] [--prefix ..] [--range ..] [--url ..]"); process.exit(1); }
  let txt = "";
  try { txt = fs.readFileSync(file, "utf8"); }
  catch (e) { console.log("✗ 文件不可读：" + e.message); process.exit(2); }

  const rows = [];
  rows.push(["文件可读", true, file]);
  if (prefix) rows.push(["标题前缀", txt.trimStart().startsWith(prefix), prefix]);
  if (need.length) { const m = need.filter(x => !txt.includes(x)); rows.push(["必含要素", m.length === 0, m.length ? "缺: " + m.join(" , ") : need.length + " 项全中"]); }
  if (topics.length) { const m = topics.filter(x => !txt.includes(x)); rows.push(["话题标签", m.length === 0, m.length ? "缺: " + m.join(" , ") : topics.join(" ")]); }
  const hits = FORBIDDEN.filter(f => f.re.test(txt));
  rows.push(["红线扫描（路径/插件名/凭据/商业化）", hits.length === 0, hits.length ? hits.map(h => h.why).join(" , ") : "零命中"]);
  const c = cjk(txt);
  rows.push(["中文字数", c >= range[0] && c <= range[1], c + "（期望 " + range.join("-") + "）"]);
  if (url) {
    let st = "ERR";
    try { st = (await fetch(url)).status; } catch (e) { st = "ERR"; }
    rows.push(["链接可达", st === 200, st + (st === 200 ? "" : " ← 需修")]);
  }
  rows.push(["有配图/效果展示说明", /配图|效果展示|截图/.test(txt), ""]);

  console.log("【" + name + "】" + file);
  for (const [k, ok, note] of rows) console.log("  " + (ok ? "✓" : "✗") + " " + k + (note ? " — " + note : ""));
  const bad = rows.filter(r => !r[1]).length;
  console.log("  → " + (bad === 0 ? "可发（绿灯）" : "需处理 " + bad + " 项"));
  process.exit(bad ? 2 : 0);
})();
