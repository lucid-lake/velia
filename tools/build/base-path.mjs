// v1 under a sub-path: Velia v2 becomes the site's root and v1, frozen, moves to /classic/.
// Vite's `base` moves the bundle's own chunks, workers and imported assets, but v1 fetches its static files by absolute URL
// strings (/models/…, /audio/…, /fonts/…, /brand/…, /terrain/…, /data/…, and public/'s /basis/ and /reel/), which no bundler
// rewrites. This plugin prefixes exactly those strings in the build's output (JS chunks and workers, CSS, index.html) with the
// base, so v1's game code stays byte for byte as it is in src/. Anything else (the metrics endpoint /api/e, page links, regex
// literals) is left alone. Used only when VELIA_BASE is set (vite.config.js); the default build (base '/') is unchanged.
export const CLASSIC_DIRS = Object.freeze(['models', 'audio', 'fonts', 'brand', 'terrain', 'data', 'basis', 'reel']);

// a URL starts after a quote, a backtick, `url(` or the space/comma of a srcset list, and names one of the folders
const URL_RE = new RegExp(`(["'\`(]|, ?|\\s)\\/(${CLASSIC_DIRS.join('|')})\\/`, 'g');
// and one built at run time from its folder's name: v1's terrain loader fetches `/${dir}/${name}` (src/sim/terrain-data.js,
// dir 'terrain'); a template literal that opens with "/${" is a same-origin absolute path
const DYN_RE = /`\/\$\{/g;

export function prefixAssetUrls(text, base = '/') {
  const b = String(base || '/').replace(/\/+$/, '');
  if (!b) return text;
  return text.replace(URL_RE, (m, pre, dir) => `${pre}${b}/${dir}/`).replace(DYN_RE, () => `\`${b}/\${`);
}

export function basePathAssets(base = '/') {
  const on = base && base !== '/';
  return {
    name: 'velia-classic-base',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: { order: 'post', handler: (html) => (on ? prefixAssetUrls(html, base) : html) },
    renderChunk(code) { return on ? { code: prefixAssetUrls(code, base), map: null } : null; },
    generateBundle(_, bundle) {
      if (!on) return;
      for (const f of Object.values(bundle)) {
        if (f.type !== 'asset' || !/\.(css|html|json)$/.test(f.fileName)) continue;
        const src = typeof f.source === 'string' ? f.source : new TextDecoder().decode(f.source);
        const out = prefixAssetUrls(src, base);
        if (out !== src) f.source = out;
      }
    },
  };
}
