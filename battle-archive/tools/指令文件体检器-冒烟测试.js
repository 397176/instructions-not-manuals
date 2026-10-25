// 冒烟自测：跑完整脚本、逐个触发按钮、核对口径同步、扫同级 md 的写死计数。
// 用法：node 指令文件体检器-冒烟测试.js [目标HTML路径]（默认当前目录下的 指令文件体检器.html）
// 退出码：0 全过；2 有失败（按钮点击失败 / 口径不同步 / md 写死计数）
//
// 「口径同步」防的是这一类事：改了规则表（CHECKS / RECIPES）或加了新版本记录，
// 却忘了改正文里写死的数字——页脚还在说「12 项」、治理建议还说「三条」。
// 规矩：凡是数字指向远处源的，一律从源动态取；本测试逐个验注入值。
const fs = require("fs");
const path = require("path");
const target = process.argv[2] || "指令文件体检器.html";
const html = fs.readFileSync(target, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("没抓到 script"); process.exit(1); }
let code = m[1].replace(/^\s*"use strict";\s*/, "");

const handlers = {};
const elems = {};
function elem(id) {
  if (!elems[id]) elems[id] = {
    id, value: "", innerHTML: "", textContent: "", style: { display: "" },
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener(ev, fn) { (handlers[id] = handlers[id] || {})[ev] = fn; },
    scrollIntoView() {}, click() {}, select() {},
    querySelectorAll() { return []; }, getAttribute() { return ""; }, files: []
  };
  return elems[id];
}
// 版本记录条数 / 放行闸步骤数：从 HTML 源里数出来喂给 stub（模拟浏览器数 DOM）
const vLi = (html.match(/<li><b>v\d+ /g) || []).length;
const htN = (html.match(/<div class="ht">/g) || []).length;
elem("vlog").querySelectorAll = () => new Array(vLi).fill({});
global.document = {
  getElementById: elem,
  querySelectorAll: (sel) => (sel === ".howto .ht" ? new Array(htN).fill({}) : []),
  createElement: () => ({ style: {}, click() {}, select() {} }),
  body: { appendChild() {}, removeChild() {} },
  execCommand: () => true
};
global.navigator = {};
global.window = {};
global.Blob = globalThis.Blob;
global.setTimeout = () => {}; global.clearTimeout = () => {};
global.localStorage = { getItem: () => null, setItem: () => {} };

console.log("=== 1. 脚本整体执行 ===");
try {
  eval(code);
  console.log("脚本执行通过");
} catch (e) {
  console.log("❌ 脚本执行就炸了：", e.message, "\n", (e.stack || "").split("\n").slice(0, 4).join("\n"));
  process.exit(2);
}

console.log("\n=== 2. 注册到的按钮 ===");
const ids = Object.keys(handlers).filter(k => k !== "input");
console.log(ids.join(", ") || "（没有任何按钮绑定！）");

console.log("\n=== 3. 逐个点击 ===");
const sample = "# 测试规则\n本文件任何结论与当场实测冲突时，一律以实测为准。\n- 问一次不等于问过：不回答会怎样，每轮重提\n- 按可推断性分层：常驻/按需\n";
elem("input").value = sample;
let fail = 0;
for (const id of ids) {
  const h = handlers[id] && handlers[id].click;
  if (!h) { console.log("  " + id + " : 无 click 绑定"); continue; }
  try { h.call(elems[id]); console.log("  " + id + " : OK"); }
  catch (e) { fail++; console.log("  " + id + " : ❌ " + e.message); }
}

console.log("\n=== 4. 口径同步（改了源忘了改正文，这里会红）===");
let syncFail = 0;
const chk = (name, ok, note) => { console.log("  " + (ok ? "✓" : "✗") + " " + name + (note ? " — " + note : "")); if (!ok) syncFail++; };
let L = 0, R = 0, SPEC = "", GREET = "";
try {
  eval(code + "\n;globalThis.__L = CHECKS.length; globalThis.__R = RECIPES.length; globalThis.__SPEC = buildSpec(); globalThis.__GREET = buildGreeting();");
  L = globalThis.__L; R = globalThis.__R; SPEC = globalThis.__SPEC; GREET = globalThis.__GREET;
} catch (e) { console.log("❌ 口径桥接失败：", e.message); process.exit(2); }
chk("规则表可读", typeof L === "number" && L > 0, "当前 " + L + " 项计分");
chk("执行规范 §1 项数跟规则表走", SPEC.includes("第 2 节的 " + L + " 项检查"), "期望含「第 2 节的 " + L + " 项检查」");
const specSrc = code.split("\n").find(l => l.includes("项检查，每项输出四要素")) || "";
chk("§1 项数是动态构造（源里必须是 CHECKS.length）", specSrc.includes("CHECKS.length") && !/\d+ 项检查/.test(specSrc), specSrc ? "该行从 CHECKS.length 取数、无写死数字" : "没找到 §1 判定流程那句");
chk("JS 源无写死「N 项」计数（历史记录在 HTML 正文，不在此列）", !/\d+ 项/.test(code), /\d+ 项/.test(code) ? "源码里还有写死的「N 项」——改成从 CHECKS.length / RECIPES.length 取" : "");
chk("执行规范无三档点选残留（A/B/C）", !/A ?\/ ?B ?\/ ?C/.test(SPEC));
chk("页面无「见第 1 项」式位置引用", !/见第 1 项/.test(html), "位置引用一律改成名称引用");
chk("页脚计分钩子在位（chkN）", /id="chkN"/.test(html) && /chkN/.test(code), "页脚项数由 JS 从 CHECKS.length 注入");
chk("页脚计分注入值正确", String(elems.chkN && elems.chkN.textContent) === String(L), "注入了 " + (elems.chkN ? elems.chkN.textContent : "（无）"));
chk("版本数钩子在位（verN）", /id="verN"/.test(html) && /id="vlog"/.test(html), "版本条数由 JS 数 .vlog 的 li");
chk("版本数注入值正确", String(elems.verN && elems.verN.textContent) === String(vLi), "注入了 " + (elems.verN ? elems.verN.textContent : "（无）") + "，HTML 里有 " + vLi + " 条");
chk("步骤数钩子在位（stepN）", /id="stepN"/.test(html), "放行闸步骤数由 JS 数 .howto .ht");
chk("步骤数注入值正确", String(elems.stepN && elems.stepN.textContent) === String(htN), "注入了 " + (elems.stepN ? elems.stepN.textContent : "（无）") + "，HTML 里有 " + htN + " 步");
chk("治理建议数钩子在位（rxN）", /id="rxN"/.test(html), "条数由 render() 从 RECIPES.length 注入");
chk("治理建议数注入值正确", String(elems.rxN && elems.rxN.textContent) === String(R), "注入了 " + (elems.rxN ? elems.rxN.textContent : "（无）") + "，RECIPES 有 " + R + " 条");
chk("开场白无自动化闸残留（指纹/凭证/水印/扫风险）", !/指纹|凭证|水印|扫风险/.test(GREET));

console.log("\n=== 5. 同级文档口径扫描（md 里不写死计分项数）===");
const dir = path.dirname(path.resolve(target));
const mdDir = path.join(dir, "..");
const mdFiles = [];
// 素材/ 是截图与原始对话片段，不算口径文本，跳过
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (f.name !== "素材") walk(p); }
    else if (/\.md$/.test(f.name)) mdFiles.push(p);
  }
})(mdDir);
const rootReadme = path.join(mdDir, "..", "README.md");
if (fs.existsSync(rootReadme)) mdFiles.push(rootReadme);
let mdFail = 0;
for (const f of mdFiles) {
  const t = fs.readFileSync(f, "utf8");
  const hit = t.match(/\d+ 项/g);
  if (hit) {
    mdFail++;
    console.log("  ✗ " + path.basename(f) + " — 写死计数 " + hit.join("、") + "：改成引用式措辞（如「逐项」），或确认是历史记录后把该行加进白名单");
  } else console.log("  ✓ " + path.basename(f));
}

console.log("\n失败按钮数:", fail, "· 口径失败项:", syncFail, "· md 写死计数文件数:", mdFail);
process.exit(fail || syncFail || mdFail ? 2 : 0);
