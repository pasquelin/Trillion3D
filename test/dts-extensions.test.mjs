import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function walk(dir, files = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, files);
    else if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.mts')) files.push(path);
  }
  return files;
}

test('Generated declarations import emitted JS modules, not TS sources', async () => {
  const files = await walk(fileURLToPath(new URL('../dist/', import.meta.url)));
  assert.ok(files.length, 'dist/ must exist; run npm run build');
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.equal(/from ['"]\.[^'"]+\.(?:ts|mts)['"]/.test(text), false, file);
  }
});
