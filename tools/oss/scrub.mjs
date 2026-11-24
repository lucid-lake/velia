// The public-repo scrub: finds what must never reach a public commit, in a whole tree, in the staged diff (pre-commit),
// in a commit message (commit-msg) or in the commits about to be pushed (pre-push). Kinds:
//   secret        keys, tokens, private keys, .env files (gitleaks too, when it is installed)
//   local-path    a user's home folder (macOS, Linux, Windows), ~/ paths and machine temp folders
//   email         any address but contact@lucidlakelabs.com and the reserved example domains
//   private-name  local-only names, read at run time from every CLAUDE.local.md above the tree and the working folder, from
//                 untracked .oss-deny-words files in the same places, and the user's login name; never printed (the report
//                 says "<local-only name>"); never allowed
//   internal      project-specific words, read at run time from the same untracked .oss-deny-words files (this file names
//                 none); allowed only by a rule in the allow file
//   money         amounts and spend words (US$, $12, credits spent, a spend ledger, invoices)
//   citation      a path to the private log, notes or research (research/…, notes/… outside v2/notes)
// The .oss-deny-words format (untracked, never committed; one entry a line, # comments):
//   <word or phrase>                     a local-only name (matched whole-word, any case)
//   internal: /<regex>/<flags> <label>   a project-specific word, reported as internal with the label
// With no deny file and no CLAUDE.local.md the scrub runs the generic checks only and says so in one line
// (OSS_SCRUB_NO_LOCAL=1 forces that, for a test).
// A hit is allowed only by a line of the allow file (.scrub-allow at the tree's root, or --allow <file>):
//   <kind> <TAB> <path glob> <TAB> <regex on the hit's line> <TAB> # <reason>
// Exit 0 when nothing blocks, 1 when a hit blocks, 2 on a usage error.
//   node tools/oss/scrub.mjs --tree <dir> [--report <file.md>] [--json <file>] [--allow <file>]
//   node tools/oss/scrub.mjs --staged                 (pre-commit: the staged added lines and file names)
//   node tools/oss/scrub.mjs --commit-msg <file>      (commit-msg)
//   node tools/oss/scrub.mjs --pre-push               (pre-push: reads git's stdin; the pushed commits' diffs and messages)
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, lstatSync } from 'node:fs';
import { join, resolve, dirname, relative, basename } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { userInfo } from 'node:os';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const has = (k) => args.includes(k);

// ---- the rules -------------------------------------------------------------------------------------------------------
const SECRET_RES = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/(?:aws_secret_access_key|aws_session_token)\s*[=:]\s*\S{16,}/i, 'AWS secret'],
  [/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/, 'private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/, 'GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic key'],
  [/\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/, 'OpenAI-style key'],
  [/\b[sr]k_live_[A-Za-z0-9]{16,}/, 'Stripe key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/\b(?:api[_-]?key|api[_-]?token|secret|password|passwd|auth[_-]?token|access[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i, 'assigned secret'],
  [/\bCLOUDFLARE_API_TOKEN\s*=\s*\S{20,}/, 'Cloudflare token'],
];
const SECRET_FILES = /(^|\/)(\.env(\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.key|credentials\.json|\.npmrc|\.netrc)$/;
// a user's home folder on macOS or Linux (/<root>/<name>), a Windows user folder, a ~/ path to a personal folder, machine temp folders
const LOCAL_PATH = /(?:\/(?:Users|home)\/[A-Za-z][A-Za-z0-9._-]+|[A-Za-z]:\\(?:Users|Documents and Settings)\\|~\/(?:code|Desktop|Documents|Downloads)\b|\/private\/(?:tmp|var)\/|\/var\/folders\/)/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/g;
const EMAIL_OK = /^(contact@lucidlakelabs\.com|[^@]+@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|invalid|test|localhost))$/i;
const NOT_EMAIL = /@\d+x\.|\.(?:webp|png|jpe?g|svg|m?js|json|glb|woff2?|css|wasm|ktx2|gz|bin|opus|m4a|html)$/i;   // sprite@2x.webp, pkg@1.2.3
const BIN_EMAIL = /^[a-z0-9._%+-]{2,}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|ai|dev|co|edu|gov|me|app|uk|de)$/;   // in a binary's printable runs: a plausible address only
let INTERNAL = [];   // filled from the untracked deny files (loadLocal)
const MONEY = [
  [/US\$\s?\d|\bUSD\s?\d|\d\s?USD\b/, 'amount'],
  [/(?<![\w$'"`\\{])\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|M|bn|million|billion))?(?![\d'"`$\w{])/, 'amount'],
  [/\b\d[\d,.]*\s*credits\b/i, 'credits spent'], [/\bledger\.csv\b|\b(?:spend|cost|money)\s+ledger\b|\bledger\s+of\s+spend/i, 'ledger'],
  [/\b(?:invoices?|spend OK|funding ask|investors?|unit economics|gross margin|price list|paid from|API credits)\b/i, 'spend word'],
];
const CITATION = /(?<![\w/.-])(?:\.\.\/)*(?:research\/[\w.-]+|notes\/[\w.-]+|progress\.md|feature_list\.json)/;

// ---- local-only names (never written into a tracked file, never printed) ---------------------------------------------------
function ancestors(dir) { const out = []; let d = resolve(dir); for (;;) { out.push(d); const p = dirname(d); if (p === d) break; d = p; } return out; }
function loadLocal(dirs) {
  const names = new Set(), internal = [];
  let found = 0;
  try { const u = userInfo().username; if (u && u.length >= 4) names.add(u); } catch { /* no login name */ }
  // OSS_SCRUB_NO_LOCAL=1: behave as on a contributor's machine (no local lists), to test the generic path
  for (const d of process.env.OSS_SCRUB_NO_LOCAL ? [] : new Set(dirs.flatMap(ancestors))) {
    const local = join(d, 'CLAUDE.local.md');
    // only a CLAUDE.local.md above the scanned tree (the project's own list), never one inside it (a checkout's own notes)
    if (!dirs.some((r) => resolve(r) === resolve(d) || resolve(d).startsWith(resolve(r) + '/')) && existsSync(local)) {
      found++;
      // each backticked path or glob gives its last segment, the glob dropped (a folder or window name); file names are skipped
      for (const m of readFileSync(local, 'utf8').matchAll(/`([^`]+)`/g)) {
        const w = m[1].replace(/[*]+$/, '').replace(/\/+$/, '').split('/').pop().replace(/[-_]+$/, '');
        if (w.length >= 5 && !/\.\w+$/.test(w)) names.add(w);
      }
    }
    const words = join(d, '.oss-deny-words');
    if (!existsSync(words)) continue;
    found++;
    for (const l of readFileSync(words, 'utf8').split('\n')) {
      const t = l.replace(/(^|\s)#.*$/, '').trim();
      if (!t) continue;
      const m = /^internal:\s*\/(.+)\/([a-z]*)\s*(.*)$/.exec(t);
      if (m) internal.push([new RegExp(m[1], m[2]), m[3] || 'internal word']);
      else names.add(t);
    }
  }
  if (!found) console.error('scrub: no .oss-deny-words or CLAUDE.local.md found; generic checks only (secrets, home paths, emails, money, private-note paths)');
  return { names: [...names], internal };
}
function privateNames(dirs) { const r = loadLocal(dirs); INTERNAL = r.internal; return r.names; }

// ---- the allow file ------------------------------------------------------------------------------------------------------
function readAllow(file) {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => {
    const [kind, glob, re, ...rest] = l.split('\t');
    const g = new RegExp(`^${(glob ?? '**').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
    return { kind: kind.trim(), globText: glob ?? '**', glob: g, re: new RegExp(re ?? '.', 'i'), reason: rest.join(' ').replace(/^#\s*/, '').trim() || '(no reason given)', used: 0 };
  });
}

// ---- scanning ------------------------------------------------------------------------------------------------------------
const hits = [];
// what a report may print of a line: home folders and local-only names masked
function mask(text, names) {
  let t = text.replace(/\/(Users|home)\/[^/\s'"`]+/g, '/$1/<name>').replace(/([A-Za-z]:\\Users\\)[^\\\s]+/g, '$1<name>');
  for (const n of names) t = t.replace(new RegExp(n.replace(/[.+^${}()|[\]\\*?]/g, '\\$&'), 'gi'), '<local-only name>');
  return t;
}
function scanLine(file, lineNo, line, names, { binary = false } = {}) {
  const add = (kind, what, excerpt) => hits.push({ kind, file: mask(file, names), line: lineNo, what: mask(what, names), excerpt: excerpt ?? mask(line.trim().slice(0, 160), names), raw: line });
  for (const [re, what] of SECRET_RES) if (re.test(line)) hits.push({ kind: 'secret', file, line: lineNo, what, excerpt: '<masked>', raw: line });
  if (LOCAL_PATH.test(line)) add('local-path', mask(line.match(LOCAL_PATH)[0], names));
  for (const m of line.matchAll(EMAIL)) if (!EMAIL_OK.test(m[0]) && !NOT_EMAIL.test(m[0]) && (!binary || BIN_EMAIL.test(m[0]))) add('email', m[0].replace(/^[^@]+/, '…'));
  for (const n of names) {
    const re = new RegExp(`(?<![A-Za-z])${n.replace(/[.+^${}()|[\]\\*?]/g, '\\$&')}(?![a-z])`, 'i');
    if (re.test(line)) add('private-name', '<local-only name>', '<masked>');
  }
  if (binary) return;
  for (const [re, what] of INTERNAL) if (re.test(line)) add('internal', what);
  for (const [re, what] of MONEY) if (re.test(line)) add('money', what);
  if (CITATION.test(line)) add('citation', line.match(CITATION)[0]);
}
function scanText(file, text, names, binary = false) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) if (lines[i].length) scanLine(file, i + 1, lines[i].length > 4000 ? lines[i].slice(0, 4000) : lines[i], names, { binary });
}
const TEXT_EXT = /\.(m?js|cjs|ts|html|css|wgsl|py|sh|json|md|txt|ya?ml|allow|svg|webmanifest|toml|xml|csv)$|(^|\/)(LICENSE|NOTICE|\.gitignore|\.scrub-allow|pre-commit|pre-push|commit-msg)$/;
function printable(buf) { const s = buf.toString('latin1'); return (s.match(/[\x20-\x7e]{8,}/g) ?? []).join('\n'); }
function scanFile(abs, rel, names) {
  if (SECRET_FILES.test(rel)) hits.push({ kind: 'secret', file: rel, line: 0, what: 'a secret-bearing file name', excerpt: '<file>' });
  const buf = readFileSync(abs);
  if (TEXT_EXT.test(rel)) return scanText(rel, buf.toString('utf8'), names);
  let body = buf;
  if (buf[0] === 0x1f && buf[1] === 0x8b) { try { body = gunzipSync(buf); } catch { /* not gzip after all */ } }
  // binaries: their printable runs (metadata, a GLB's JSON chunk, an encoder tag), for paths, emails, names and secrets only
  scanText(rel, printable(body), names, true);
}
function walk(dir, root, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name.startsWith('dist') || e.name === '.vite-v2' || e.name === '.oss-manifest') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, root, out); else if (e.isFile()) out.push(relative(root, p));
  }
  return out;
}

// gitleaks, when installed: its findings join the secret hits
function gitleaks(dir) {
  const r = spawnSync('gitleaks', ['detect', '--no-git', '--no-banner', '-s', dir, '-f', 'json', '-r', '/dev/stdout', '--exit-code', '0'], { encoding: 'utf8' });
  if (r.error) return false;
  try { for (const f of JSON.parse(r.stdout || '[]')) hits.push({ kind: 'secret', file: relative(dir, f.File), line: f.StartLine, what: `gitleaks ${f.RuleID}`, excerpt: '<masked>' }); } catch { /* no findings */ }
  return true;
}

// ---- modes -----------------------------------------------------------------------------------------------------------------
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
function scanDiff(diffText, names, label) {
  let file = label, lineNo = 0;
  for (const l of diffText.split('\n')) {
    if (l.startsWith('+++ ')) { file = l.slice(4).replace(/^b\//, ''); if (SECRET_FILES.test(file)) hits.push({ kind: 'secret', file, line: 0, what: 'a secret-bearing file name', excerpt: '<file>' }); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l); if (h) { lineNo = Number(h[1]); continue; }
    if (l.startsWith('+') && !l.startsWith('+++')) { scanLine(file, lineNo, l.slice(1), names); lineNo++; }
  }
}

let mode, root, gitleaksRan = false;
const here = process.cwd();
if (opt('--tree')) {
  mode = 'tree'; root = resolve(opt('--tree'));
  const names = privateNames([root, here]);
  for (const rel of walk(root, root)) scanFile(join(root, rel), rel, names);
  gitleaksRan = gitleaks(root);
} else if (has('--staged')) {
  mode = 'staged'; root = git('rev-parse', '--show-toplevel').trim();
  const names = privateNames([root, here]);
  scanDiff(git('diff', '--cached', '-U0', '--no-color', '--no-ext-diff'), names, '(staged)');
} else if (opt('--commit-msg')) {
  mode = 'commit-msg'; root = git('rev-parse', '--show-toplevel').trim();
  const names = privateNames([root, here]);
  const msg = readFileSync(opt('--commit-msg'), 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n');
  scanText('(commit message)', msg, names);
} else if (has('--pre-push')) {
  mode = 'pre-push'; root = git('rev-parse', '--show-toplevel').trim();
  const names = privateNames([root, here]);
  const input = readFileSync(0, 'utf8');
  for (const l of input.split('\n').filter(Boolean)) {
    const [, localSha, , remoteSha] = l.split(' ');
    if (/^0+$/.test(localSha)) continue;   // a delete
    const range = /^0+$/.test(remoteSha) ? [localSha, '--not', '--remotes'] : [`${remoteSha}..${localSha}`];
    for (const sha of git('rev-list', ...range).split('\n').filter(Boolean)) {
      scanText(`(message ${sha.slice(0, 9)})`, git('log', '-1', '--format=%B', sha), names);
      scanText(`(author ${sha.slice(0, 9)})`, git('log', '-1', '--format=%an <%ae>%n%cn <%ce>', sha), names);
      scanDiff(git('show', '--format=', '-U0', '--no-color', '--no-ext-diff', sha), names, sha.slice(0, 9));
    }
  }
} else {
  console.error('usage: scrub.mjs --tree <dir> [--report f.md] | --staged | --commit-msg <file> | --pre-push');
  process.exit(2);
}

// ---- verdicts ----------------------------------------------------------------------------------------------------------------
const allowFile = opt('--allow') ?? join(root, '.scrub-allow');
const allow = readAllow(allowFile);
for (const h of hits) {
  if (h.kind === 'private-name') { h.allowed = null; continue; }   // never allowed
  // a secret is allowed only by a rule naming one exact file (a test's fake key), never by a glob
  const rule = allow.find((a) => a.kind === h.kind && (h.kind !== 'secret' || !a.globText.includes('*')) && a.glob.test(h.file) && a.re.test(`${h.raw ?? h.excerpt} ${h.what}`));
  if (rule) { h.allowed = rule.reason; rule.used++; } else h.allowed = null;
}
const blocking = hits.filter((h) => h.allowed == null);
const KINDS = ['secret', 'local-path', 'email', 'private-name', 'internal', 'money', 'citation'];
const count = (k, pred) => hits.filter((h) => h.kind === k && pred(h)).length;

if (opt('--report')) {
  const L = [`# Scrub report (${mode})`, '', `Tree: \`${basename(root)}\` · rules: tools/oss/scrub.mjs · allow file: \`${basename(allowFile)}\` (${allow.length} rules) · gitleaks: ${gitleaksRan ? 'ran' : 'not installed (built-in secret patterns only)'}`, '',
    '| Kind | Hits | Blocked | Allowed |', '|---|---:|---:|---:|'];
  for (const k of KINDS) L.push(`| ${k} | ${count(k, () => true)} | ${count(k, (h) => h.allowed == null)} | ${count(k, (h) => h.allowed != null)} |`);
  L.push('', blocking.length ? `## Blocked (${blocking.length})` : '## Blocked: none', '');
  for (const h of blocking.slice(0, 400)) L.push(`- **${h.kind}** \`${h.file}:${h.line}\` ${h.what}: ${h.excerpt.replace(/\|/g, '\\|')}`);
  if (blocking.length > 400) L.push(`- … and ${blocking.length - 400} more`);
  L.push('', '## Allowed, by rule', '');
  for (const a of allow) if (a.used) L.push(`- **${a.kind}** × ${a.used}: ${a.reason}`);
  const unused = allow.filter((a) => !a.used);
  if (unused.length) L.push('', `Unused allow rules: ${unused.length} (${unused.map((a) => a.kind).join(', ')})`);
  writeFileSync(opt('--report'), `${L.join('\n')}\n`);
}
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(hits.map(({ raw, ...h }) => ({ ...h, excerpt: h.kind === 'private-name' || h.kind === 'secret' ? '<masked>' : h.excerpt })), null, 1));
const line = KINDS.map((k) => `${k} ${count(k, () => true)}/${count(k, (h) => h.allowed == null)}`).join(' · ');
if (blocking.length) {
  console.error(`scrub (${mode}): BLOCK, ${blocking.length} hit(s) [kind hits/blocked: ${line}]`);
  for (const h of blocking.slice(0, 30)) console.error(`  ${h.kind}  ${h.file}:${h.line}  ${h.what}: ${h.excerpt.slice(0, 120)}`);
  if (blocking.length > 30) console.error(`  … ${blocking.length - 30} more${opt('--report') ? ` (${opt('--report')})` : ''}`);
  process.exit(1);
}
console.log(`scrub (${mode}): clean [kind hits/blocked: ${line}]`);
