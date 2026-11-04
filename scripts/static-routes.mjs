// GitHub Pages answers "404 Not Found" for any path without a file, even though
// 404.html then loads the app. Link previews (WhatsApp and others) treat that as
// a dead link. This copies index.html to every route that has a fixed path, so
// those addresses answer 200. Routes with a [part] in their path use the query
// form instead, for example /r?s=<race link>.
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const dist = process.argv[2] ?? 'dist';
const appDir = 'src/app';
const routes = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!name.includes('[')) walk(full);
      continue;
    }
    if (!/\.tsx?$/.test(name) || name.startsWith('_') || name.includes('[')) continue;
    const rel = path.relative(appDir, full).replace(/\.tsx?$/, '').replace(/(^|\/)index$/, '');
    if (rel) routes.push(rel);
  }
}
walk(appDir);

for (const r of routes) {
  mkdirSync(path.join(dist, r), { recursive: true });
  copyFileSync(path.join(dist, 'index.html'), path.join(dist, r, 'index.html'));
}
console.log(`Static pages for ${routes.length} routes: ${routes.sort().join(', ')}`);
