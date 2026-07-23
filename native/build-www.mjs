// Stages the web app into www/ for the native (Capacitor) build.
//
// Differences from the deployed PWA:
//   - chart.js + lucide load from bundled vendor/ copies instead of CDNs,
//     and the Google Fonts @import is swapped for bundled woff2s, so the
//     native app renders fully offline (and store review can't hit a blank
//     screen on flaky network)
//   - the service worker is stripped: Capacitor serves from the app bundle,
//     so SW caching adds nothing and stale-cache bugs on iOS are avoided
//
// Every rewrite asserts its target string exists — if index.html drifts
// (e.g. a CDN version bump), this fails loudly instead of shipping a
// half-patched bundle. Update the pinned vendor file AND this script together.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const www = join(here, 'www');

const STATIC_FILES = [
  'app.js', 'engine.js', 'manifest.json',
  'icon-180.png', 'icon-192.png', 'icon-512.png'
];

const FONT_IMPORT = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap');";

const REWRITES = [
  {
    find: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.js',
    replace: 'vendor/chart.umd.js'
  },
  {
    find: 'https://unpkg.com/lucide@0.462.0/dist/umd/lucide.min.js',
    replace: 'vendor/lucide.min.js'
  },
  {
    find: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    replace: 'vendor/leaflet/leaflet.css'
  },
  {
    find: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    replace: 'vendor/leaflet/leaflet.js'
  }
];

const SW_BLOCK = /\s*<!-- PWA Service Worker Registration -->\s*<script>[\s\S]*?<\/script>/;

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

let html = readFileSync(join(root, 'index.html'), 'utf8');
for (const { find, replace } of REWRITES) {
  if (!html.includes(find)) {
    throw new Error(`index.html no longer contains "${find}" — update native/vendor and build-www.mjs to match`);
  }
  html = html.replace(find, replace);
}
if (!SW_BLOCK.test(html)) {
  throw new Error('service worker registration block not found in index.html — update build-www.mjs');
}
html = html.replace(SW_BLOCK, '');
// Catch-all: a CDN <script>/<link> added to index.html without a matching
// REWRITES entry must fail the build, not silently ship a network dependency
// (nothing caught it when Leaflet was added — hence this guard). Plain <a>
// links are fine — they're user navigation, not load-time assets.
const leftover = [
  ...html.matchAll(/<script[^>]*\ssrc="(https?:\/\/[^"]+)"/g),
  ...html.matchAll(/<link[^>]*\shref="(https?:\/\/[^"]+)"/g)
].map(m => m[1]);
if (leftover.length) {
  throw new Error(`index.html loads external assets with no vendor rewrite: ${leftover.join(', ')} — vendor them and add REWRITES entries`);
}
writeFileSync(join(www, 'index.html'), html);

let css = readFileSync(join(root, 'style.css'), 'utf8');
if (!css.includes(FONT_IMPORT)) {
  throw new Error('Google Fonts @import not found in style.css — update native/vendor/fonts and build-www.mjs to match');
}
css = css.replace(FONT_IMPORT, "@import url('vendor/fonts/fonts.css');");
writeFileSync(join(www, 'style.css'), css);

for (const file of STATIC_FILES) {
  cpSync(join(root, file), join(www, file));
}
cpSync(join(here, 'vendor'), join(www, 'vendor'), { recursive: true });

console.log('www/ staged for native build');
