// The production scrub shared by v1 (vite.config.js) and v2 (v2/vite.config.js): tools/scrub_dist.sh checks both outputs.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
// 5. Production builds drop HTML comments and the // and /* */ comments of inline scripts and styles: anyone can read view-source, and our comments are for us.
export function stripHtmlComments() {
  return {
    name: 'lakeshore-strip-comments', apply: 'build',
    transformIndexHtml: (html) => html
      .replace(/<!--[\s\S]*?-->\n?/g, '')
      // inline classic scripts: a // comment starts at a line start or after whitespace or ; { } (never after ":", so URLs stay)
      .replace(/(<script>)([\s\S]*?)(<\/script>)/g, (_, o, body, c) => o + body.replace(/(^|[\s;{}])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '') + c)
      // inline styles: /* … */ notes
      .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_, o, body, c) => o + body.replace(/\/\*[\s\S]*?\*\//g, '') + c),
  };
}

// 6. Production bundles carry no internal words (tools/scrub_dist.sh checks the result): CSS comments kept inside strings that
//    name an owner, a notes/ file or the code name are dropped, the "_" note keys of imported JSON go, and the code name
//    "lakeshore" (globals, storage keys, event names) is spelled "velia" in every chunk, one spelling across all of them.
export const WORDS = /owner|notes\/|research\/|lakeshore/i;
export function scrubBundle() {
  const spell = (t) => t.replace(/LAKESHORE/g, 'VELIA').replace(/Lakeshore/g, 'Velia').replace(/lakeshore/g, 'velia');
  const clean = (code) => spell(code
    .replace(/\/\*[^*]*(?:\*(?!\/)[^*]*)*\*\//g, (m) => (WORDS.test(m) ? '' : m))
    .replace(/([{,])_:(`[^`]*`|"[^"]*"|'[^']*'),(?=[\w"'`$\[{])/g, '$1')
    .replace(/,_:(`[^`]*`|"[^"]*"|'[^']*')(?=[}\]])/g, ''));
  return {
    name: 'lakeshore-scrub-bundle', apply: 'build', enforce: 'post',
    generateBundle(_, bundle) {
      for (const f of Object.values(bundle)) {
        if (f.type === 'chunk') f.code = clean(f.code);
        else if (/\.(css|html)$/.test(f.fileName)) f.source = clean(Buffer.from(f.source).toString('utf8'));
      }
    },
  };
}

// 7. A GLB's JSON chunk is text inside a binary (the glTF asset.generator, copyright, names, extras): grep skips it, so
//    tools/scrub_dist.sh runs this over every .glb and .glb.gz of a build (2026-11-15: v1's paddler figures shipped the
//    generator "lakeshore paddler-….py").  node tools/build/scrub.mjs --glb <dir> prints "<file>: …hit…" lines.
export function glbJson(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67 || buf.readUInt32LE(16) !== 0x4e4f534a) return null;
  return buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8');
}
export function glbHits(dir) {
  const hits = [], re = new RegExp(`.{0,40}(?:${WORDS.source}).{0,40}`, 'gi');
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.glb(\.gz)?$/i.test(e.name)) {
        const js = glbJson(readFileSync(p));
        if (js == null) hits.push(`${p}: not a glTF binary`);
        else for (const m of js.match(re) ?? []) hits.push(`${p}: ${m}`);
      }
    }
  };
  walk(dir);
  return hits;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === '--glb') {
  for (const h of glbHits(process.argv[3] ?? 'dist')) console.log(h);
}

