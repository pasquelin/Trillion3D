import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkOnly = process.argv.includes('--check');
const root = new URL('../dist/', import.meta.url);
let rewritten = 0;

async function walk(dir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!entry.name.endsWith('.d.ts') && !entry.name.endsWith('.d.mts')) continue;
    const text = await readFile(path, 'utf8');
    const next = text.replace(
      /(from\s+['"])(\.[^'"]+)\.(mts|ts)(['"])/g,
      (_match, prefix: string, path: string, extension: string, suffix: string) =>
        `${prefix}${path}.${extension === 'mts' ? 'mjs' : 'js'}${suffix}`,
    );
    if (next === text) continue;
    if (checkOnly) throw new Error(`${path} still imports TypeScript source modules`);
    await writeFile(path, next);
    rewritten++;
  }
}

await walk(fileURLToPath(root));
if (!checkOnly) process.stderr.write(`rewrote ${rewritten} declaration files\n`);
