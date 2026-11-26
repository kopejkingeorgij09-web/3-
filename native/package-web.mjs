import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const docs = join(repo, 'docs');
const output = process.argv[2];
if (!output) throw new Error('Usage: node native/package-web.mjs /path/stormcore.html');
const scratch = mkdtempSync(join(tmpdir(), 'stormcore-web-'));
try {
  const bundle = join(scratch, 'game.js');
  execFileSync('npm', [
    'exec', '--yes', '--package=esbuild@0.25.12', '--', 'esbuild',
    join(docs, 'game.js'), '--bundle', '--minify', '--format=iife',
    '--legal-comments=inline', '--outfile=' + bundle
  ], { stdio: 'inherit' });
  const files = [
    ['storm.webp','image/webp'],
    ['golos.woff2','font/woff2'],
    ['golos-latin.woff2','font/woff2']
  ];
  let css = readFileSync(join(docs, 'style.css'), 'utf8');
  for (const [name, type] of files) {
    const data = readFileSync(join(docs, name)).toString('base64');
    css = css.replaceAll('url(./' + name + ')', 'url(data:' + type + ';base64,' + data + ')');
  }
  const script = readFileSync(bundle, 'utf8').replace(/<\/script/gi, match => '<\\/' + match.slice(2));
  const notices = ['three-LICENSE.txt','golos-OFL.txt']
    .map(name => readFileSync(join(docs, name), 'utf8')).join('\n\n');
  const html = readFileSync(join(docs, 'index.html'), 'utf8')
    .replace('<link rel="stylesheet" href="./style.css">', () => '<style>' + css + '</style>')
    .replace('<script type="module" src="./game.js"></script>', () => '<script>' + script + '</script>')
    .replace('class="brand" href="./"', 'class="brand" href="#"')
    .replace(/<a class="standalone-download"[^>]*>.*?<\/a>/, '')
    .replace('</head>', () => '<!--\n' + notices + '\n-->\n</head>');
  writeFileSync(resolve(output), html);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
