// Re-vendors the Google Fonts used by ../style.css into vendor/fonts/
// (latin subset only — the app is English-only; other scripts fall back to
// system fonts). Run when style.css changes its fonts @import, then update
// FONT_IMPORT in build-www.mjs to match:  node vendor-fonts.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'vendor', 'fonts');

mkdirSync(OUT, { recursive: true });

const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();

// Split into "/* subset */ @font-face {...}" blocks, keep latin only (not latin-ext)
const blocks = css.match(/\/\* [a-z-]+ \*\/\s*@font-face\s*\{[^}]+\}/g) ?? [];
const latin = blocks.filter(b => b.startsWith('/* latin */'));
if (!latin.length) throw new Error('no latin @font-face blocks parsed — Google CSS format changed?');

const seen = new Map(); // remote url -> local filename
let out = '/* Vendored from Google Fonts (latin subset): Inter 300-700, Outfit 400-800 */\n';
for (const block of latin) {
  const family = block.match(/font-family:\s*'([^']+)'/)[1];
  const weight = block.match(/font-weight:\s*(\d+)/)[1];
  const url = block.match(/url\((https:[^)]+\.woff2)\)/)[1];
  if (!seen.has(url)) {
    const local = `${family.toLowerCase()}-latin-${weight}.woff2`;
    seen.set(url, local);
    const buf = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer());
    if (buf.length < 1000) throw new Error(`suspiciously small font file for ${url}`);
    writeFileSync(join(OUT, local), buf);
    console.log(`${local}  ${buf.length} bytes`);
  }
  out += block.replace(/url\(https:[^)]+\.woff2\)/, `url(${seen.get(url)})`)
              .replace(/^\/\* latin \*\/\s*/, '') + '\n';
}
writeFileSync(join(OUT, 'fonts.css'), out);
console.log(`fonts.css written with ${latin.length} @font-face rules, ${seen.size} files`);
