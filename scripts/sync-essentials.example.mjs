#!/usr/bin/env node
/**
 * sync-essentials.example.mjs — 一份源 → 多处注入 + 自检防漂移（通用示例）
 *
 * 原理：唯一的「常驻内核段」只存在一个源文件里，用两个标记圈起来：
 *     <!-- ESSENTIALS:BEGIN -->  …  <!-- ESSENTIALS:END -->
 * 本脚本把这段逐字抄进每个目标文件的同名标记之间。抄的是字节，不是意思 ——
 * 于是「源改了、副本忘了改」这件事就变成机器能发现的事，不用靠记性。
 *
 * 用法：
 *   node sync-essentials.example.mjs --source <源文件> --target <目标1> [目标2 ...]
 *        [--create] [--check]
 *
 *   默认     把源段写进每个目标；打印 写入 / 未变 / 缺段 / 缺文件
 *   --check  只比对、不写盘；任何漂移或缺失 → 退出码 1（可挂 CI）
 *   --create 目标里没有标记段时，在末尾追加一段（默认把「缺段」算作漂移）
 *
 * 退出码：0 = 全部一致 / 已同步；1 = 有漂移或有文件缺段；2 = 参数或源文件有问题
 *
 * 所有路径都来自命令行，脚本内不写死任何真实路径 —— 换机器、换目录都不用改代码。
 * 注意：--check 只证明「副本和源一字不差」，不证明「源本身写得好」。两件事，别混。
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const RE_BEGIN = /<!--\s*ESSENTIALS:BEGIN\s*-->/;
const RE_END = /<!--\s*ESSENTIALS:END\s*-->/;

/* ---------- 小工具 ---------- */

const toLF = (s) => s.replace(/\r\n/g, '\n');
const detectEol = (s) => (s.includes('\r\n') ? '\r\n' : '\n');
const applyEol = (s, eol) => (eol === '\n' ? s : s.replace(/\n/g, eol));
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/**
 * 读文本并记住原来有没有 BOM —— 写回时照原样带上。
 * 不这么做的话，第一次同步就会顺手摘掉别人文件的 BOM，凭空多出一个 diff。
 */
function readTextKeepBom(file) {
  const text = readFileSync(file, 'utf8');
  return { text: stripBom(text), hasBom: text.charCodeAt(0) === 0xfeff };
}

/** 原子写：先写临时文件再改名，避免中途失败留下半个文件。 */
function writeAtomic(file, content) {
  const tmp = `${file}.sync-${process.pid}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
}

/**
 * 取出标记段。返回 { start, end, block }（block 含两行标记本身）。
 * required=false 时「没有标记」返回 null；标记顺序错、出现多段都直接抛错。
 */
function extractBlock(text, label, required) {
  const b = text.match(RE_BEGIN);
  const e = text.match(RE_END);
  if (!b || !e) {
    if (required) throw new Error(`${label}: 找不到 ESSENTIALS 标记段`);
    return null;
  }
  if (b.index > e.index) throw new Error(`${label}: END 出现在 BEGIN 之前`);
  const end = e.index + e[0].length;
  const rest = text.slice(end);
  if (RE_BEGIN.test(rest) || RE_END.test(rest)) {
    throw new Error(`${label}: 出现多段 ESSENTIALS 标记 —— 只支持一段，请先说清该同步哪一段`);
  }
  return { start: b.index, end, block: text.slice(b.index, end) };
}

function usage() {
  console.log(`sync-essentials.example.mjs — 一份源 → 多处注入 + 自检防漂移

用法:
  node sync-essentials.example.mjs --source <源文件> --target <目标1> [目标2 ...] [--create] [--check]

示例:
  node sync-essentials.example.mjs --source workspace-a/essentials-block.md \\
       --target workspace-a/AGENTS.md workspace-b/AGENTS.md

  node sync-essentials.example.mjs --source workspace-a/essentials-block.md \\
       --target workspace-a/AGENTS.md workspace-b/AGENTS.md --check

退出码: 0 一致 | 1 有漂移或缺段 | 2 参数或源文件有问题`);
}

function parseArgs(argv) {
  const out = { source: null, targets: [], check: false, create: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--source' || a === '-s') {
      out.source = argv[i + 1];
      if (!out.source) throw new Error('--source 后面要跟一个文件路径');
      i += 1;
    } else if (a === '--target' || a === '-t') {
      let n = 0;
      while (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        out.targets.push(argv[i + 1]);
        i += 1;
        n += 1;
      }
      if (n === 0) throw new Error('--target 后面至少要跟一个文件路径（可以有多个，用空格分隔）');
    } else if (a === '--check') {
      out.check = true;
    } else if (a === '--create') {
      out.create = true;
    } else if (a === '-h' || a === '--help') {
      out.help = true;
    } else {
      throw new Error(`不认识的参数: ${a}`);
    }
  }
  return out;
}

/** 算单个目标该怎么处理，不落盘。 */
function planTarget(file, blockLF, { create }) {
  let raw = null;
  let hadBom = false;
  try {
    const read = readTextKeepBom(file);
    raw = read.text;
    hadBom = read.hasBom;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      return { file, status: 'error', detail: String(err.message || err) };
    }
  }

  const bom = hadBom ? '\uFEFF' : '';

  if (raw === null) {
    if (!create) return { file, status: 'missing-file' };
    return { file, status: 'append', next: blockLF + '\n', detail: '新建文件并写入该段' };
  }

  const eol = detectEol(raw);
  const textLF = toLF(raw);

  let found;
  try {
    found = extractBlock(textLF, file, false);
  } catch (err) {
    return { file, status: 'error', detail: String(err.message || err) };
  }

  if (!found) {
    if (!create) return { file, status: 'missing-block' };
    const sep = textLF.endsWith('\n\n') ? '' : textLF.endsWith('\n') ? '\n' : '\n\n';
    return {
      file,
      status: 'append',
      next: bom + applyEol(textLF + sep + blockLF + '\n', eol),
      detail: '在末尾追加该段',
    };
  }

  if (found.block === blockLF) return { file, status: 'same' };

  const next = textLF.slice(0, found.start) + blockLF + textLF.slice(found.end);
  return { file, status: 'write', next: bom + applyEol(next, eol) };
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`[参数错误] ${err.message}`);
    usage();
    return 2;
  }

  if (args.help) {
    usage();
    return 0;
  }
  if (!args.source || args.targets.length === 0) {
    console.error('[参数错误] 至少要给 --source 和一个 --target');
    usage();
    return 2;
  }

  // 1) 读源，取段
  let sourceText;
  try {
    sourceText = readTextKeepBom(args.source).text;
  } catch (err) {
    console.error(`[源文件错误] 读不到 ${args.source}: ${err.message}`);
    return 2;
  }

  let blockLF;
  try {
    blockLF = extractBlock(toLF(sourceText), args.source, true).block;
  } catch (err) {
    console.error(`[源文件错误] ${err.message}`);
    return 2;
  }

  const inner = blockLF.replace(RE_BEGIN, '').replace(RE_END, '');
  if (inner.trim() === '') {
    console.error(`[源文件错误] ${args.source} 的标记段是空的 —— 空段同步出去等于把所有副本清空，拒绝执行`);
    return 2;
  }

  // 2) 逐个目标算差异
  const results = args.targets.map((f) => planTarget(f, blockLF, args));

  // 3) 落盘或报告
  const bad = [];
  for (const r of results) {
    if (r.status === 'same') {
      console.log(`  未变  ${r.file}`);
    } else if (r.status === 'write' || r.status === 'append') {
      if (args.check) {
        console.log(`  漂移  ${r.file}${r.detail ? ` (${r.detail})` : ''}`);
        bad.push(r);
      } else {
        try {
          writeAtomic(r.file, r.next);
          console.log(`  写入  ${r.file}${r.detail ? ` (${r.detail})` : ''}`);
        } catch (err) {
          console.log(`  失败  ${r.file} — ${err.message}`);
          bad.push({ ...r, status: 'error' });
        }
      }
    } else if (r.status === 'missing-file') {
      console.log(`  缺文件 ${r.file}（加 --create 可新建）`);
      bad.push(r);
    } else if (r.status === 'missing-block') {
      console.log(`  缺段  ${r.file}（加 --create 可在末尾追加）`);
      bad.push(r);
    } else {
      console.log(`  错误  ${r.file} — ${r.detail}`);
      bad.push(r);
    }
  }

  // 4) 收尾
  const total = results.length;
  const okCount = results.filter((r) => r.status === 'same').length;

  if (args.check) {
    if (bad.length > 0) {
      console.error(`\n[check] ${bad.length}/${total} 个目标与源不一致 —— 漂移 ${bad.length} 处，退出码 1`);
      return 1;
    }
    console.log(`\n[check] ${total} 个目标与源一致，无漂移`);
    return 0;
  }

  if (bad.length > 0) {
    console.error(`\n[同步] ${total - bad.length}/${total} 成功，${bad.length} 个未处理 —— 见上面的行`);
    return 1;
  }
  console.log(`\n[同步] ${total} 个目标已对齐（其中 ${total - okCount} 个被改写）`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
