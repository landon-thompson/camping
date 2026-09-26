// Builds a single self-contained HTML file of the app (no login, sync or
// service worker) for sharing a preview before Azure is set up.
//   npm run build:preview  →  dist-preview/camp-planner.html
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = 'dist-preview';
execSync(`npx vite build --base ./ --outDir ${out} --emptyOutDir`, {
  stdio: 'inherit',
  env: { ...process.env, VITE_PREVIEW: '1' },
});

const assets = join(out, 'assets');
const files = readdirSync(assets);
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const jsFiles = files.filter((f) => f.endsWith('.js'));
if (jsFiles.length !== 1) throw new Error(`Expected one JS bundle, found: ${jsFiles.join(', ')}`);
// Keep the bundle from closing its own <script> tag early.
const js = readFileSync(join(assets, jsFiles[0]), 'utf8').replace(/<\/script/gi, '<\\/script');

const html = `<title>Camp Planner</title>
<meta name="theme-color" content="#1f4d36">
<script>
  try {
    var t = localStorage.getItem('theme');
    var host = document.documentElement.getAttribute('data-theme');
    var sys = host ? host === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    if (t === 'dark' || (t !== 'light' && sys)) document.documentElement.classList.add('dark');
  } catch (e) {}
</script>
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
writeFileSync(join(out, 'camp-planner.html'), html);
console.log(`Wrote ${out}/camp-planner.html (${Math.round(html.length / 1024)} KB)`);
