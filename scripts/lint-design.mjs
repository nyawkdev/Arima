import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HEX_RE = /#([0-9a-fA-F]{3,8})\b/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(svelte|css|html|ts)$/.test(name)) out.push(p);
  }
  return out;
}

let issues = 0;
for (const file of walk('src')) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(HEX_RE)) {
    const raw = m[1];
    if (![3, 4, 6, 8].includes(raw.length)) {
      console.error(`[design-lint] ${file}: malformed hex color #${raw}`);
      issues++;
    }
  }
}

if (issues > 0) process.exit(1);
console.log('design-lint: OK');
