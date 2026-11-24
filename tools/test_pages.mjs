// The visual suite: browser page checks (WebGPU captures, a real Chrome), kept out of the fast `node --test tests/`.
//   npm run test:pages                       # every tests/pages/*.page.mjs, non-strict
//   npm run test:pages -- --strict           # performance budgets fail too (run on a quiet GPU)
//   npm run test:pages -- clouds sails       # only the files whose name contains one of these words
//   node tools/test_pages.mjs --serve        # just start the private server and print its URL (Ctrl-C stops it)
//   npm run test:pages:v2                    # --app v2: the Velia v2 page (v2/vite.config.js, root v2/), v2/tests/pages/*.page.mjs,
//                                            #   its own cache renders/.vite-pages-v2; the files get LAKESHORE_APP=v2 (hook window.__velia)
// It starts its own Vite on a free port with its own cache (renders/.vite-pages/, never the shared node_modules/.vite),
// runs each page file with LAKESHORE_BASE=<that server> and generous timeouts, and stops the server, pass or fail.
// Never touches the shared dev server on :5173.
import { spawn } from 'node:child_process';
import { createServer as netServer } from 'node:net';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const SERVE = argv.includes('--serve');
const appAt = argv.indexOf('--app'), V2 = appAt >= 0 && argv[appAt + 1] === 'v2', APP = V2 ? 'v2' : 'v1';
const words = argv.filter((a, i) => !a.startsWith('--') && !(appAt >= 0 && i === appAt + 1));
const FILE_TIMEOUT_MS = 30 * 60 * 1000;   // a loaded GPU can take minutes per capture set

const freePort = () => new Promise((ok, no) => {
  const s = netServer();
  s.once('error', no);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});

const { createServer } = await import('vite');
const port = await freePort();
const server = await createServer({
  root: V2 ? resolve(ROOT, 'v2') : ROOT,
  configFile: resolve(ROOT, V2 ? 'v2/vite.config.js' : 'vite.config.js'),
  cacheDir: resolve(ROOT, V2 ? 'renders/.vite-pages-v2' : 'renders/.vite-pages'),   // git-ignored; per checkout, so no other server's deps go stale
  clearScreen: false,
  logLevel: 'error',   // the pages' forwarded console warnings (three's deprecations) drown the checks
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
});
await server.listen();
const BASE = `http://127.0.0.1:${port}`;
let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; await server.close(); };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stop(); process.exit(130); });
console.log(`test:pages${V2 ? ' (v2)' : ''}: private Vite at ${BASE} (cache renders/.vite-pages${V2 ? '-v2' : ''})${STRICT ? ', strict' : ''}`);

if (SERVE) { console.log('serving; Ctrl-C stops it'); await new Promise(() => {}); }

const dir = resolve(ROOT, V2 ? 'v2/tests/pages' : 'tests/pages');
const files = readdirSync(dir).filter((f) => f.endsWith('.page.mjs')).filter((f) => !words.length || words.some((w) => f.includes(w))).sort();
const results = [];
try {
  // Warm the dep optimiser once, so the first capture does not hit a re-optimise reload.
  await fetch(`${BASE}/`).catch(() => {});
  for (const f of files) {
    const t0 = Date.now();
    const code = await new Promise((ok) => {
      // each file is a plain script (exit 1 on any FAIL) or a node:test file; both run as `node <file>`
      const child = spawn(process.execPath, [resolve(dir, f)], {
        cwd: ROOT, stdio: 'inherit',
        env: { ...process.env, LAKESHORE_BASE: BASE, LAKESHORE_STRICT: STRICT ? '1' : '', LAKESHORE_APP: APP },
      });
      const timer = setTimeout(() => { console.log(`FAIL  ${f}: no exit after ${FILE_TIMEOUT_MS / 60000} min, stopped`); child.kill('SIGTERM'); }, FILE_TIMEOUT_MS);
      child.on('exit', (c, s) => { clearTimeout(timer); ok(c ?? (s ? 1 : 0)); });
    });
    results.push({ f, code, s: (Date.now() - t0) / 1000 });
  }
} finally {
  await stop();
}
console.log(`\ntest:pages${V2 ? ' (v2)' : ''} summary`);
for (const r of results) console.log(`  ${r.code ? 'FAIL' : 'pass'}  ${r.f}  ${r.s.toFixed(0)} s`);
const failed = results.filter((r) => r.code).length;
console.log(failed ? `${failed} of ${results.length} page files failed` : `all ${results.length} page files pass${STRICT ? ' (strict)' : ' (budgets reported, not gated; --strict gates them)'}`);
process.exit(failed ? 1 : 0);
