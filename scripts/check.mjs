// Syntax-checks every .js/.mjs file under src/ and scripts/ with `node --check`.
// This is the only verification the local model can run without a browser.
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'scripts'];
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (['.js', '.mjs'].includes(extname(p))) files.push(p);
  }
}

for (const r of roots) {
  try { walk(r); } catch { /* folder may not exist yet */ }
}

let failed = 0;
for (const f of files) {
  const res = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (res.status !== 0) {
    failed++;
    console.error(`FAIL ${f}\n${res.stderr}`);
  } else {
    console.log(`ok   ${f}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} files passed`);
process.exit(failed ? 1 : 0);
