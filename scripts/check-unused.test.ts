import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkUnused } from './check-unused.ts';

/** A repository in miniature: one package whose entry uses `used`, the repository's own
 *  production pass, and `extra` files on top. */
function repository(extra: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'check-unused-'));
  const files: Record<string, string> = {
    'package.json': '{ "name": "probe", "type": "module", "private": true }',
    'knip.config.ts': `export default {
  entry: ['packages/sdk/index.ts', 'packages/**/*.test.ts'],
  project: ['packages/**/*.ts'],
};\n`,
    'packages/sdk/index.ts': "export { used } from '../sdk-core/src/lib.ts';\n",
    ...extra,
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  copyFileSync(
    new URL('../knip.production.config.ts', import.meta.url),
    join(root, 'knip.production.config.ts'),
  );
  return root;
}

test('an export that only a test uses fails check:unused; one the SDK uses passes', () => {
  const clean = repository({
    'packages/sdk-core/src/lib.ts': 'export const used = 1;\n',
    'packages/sdk-core/src/lib.test.ts': "import { used } from './lib.ts';\nconsole.log(used);\n",
  });
  const polluted = repository({
    'packages/sdk-core/src/lib.ts': 'export const used = 1;\nexport const onlyTested = 2;\n',
    'packages/sdk-core/src/lib.test.ts':
      "import { onlyTested } from './lib.ts';\nconsole.log(onlyTested);\n",
  });
  try {
    const passed = checkUnused(clean);
    assert.equal(passed.status, 0, passed.output);
    const { status, output } = checkUnused(polluted);
    assert.notEqual(status, 0);
    assert.match(output, /onlyTested/);
  } finally {
    for (const root of [clean, polluted]) rmSync(root, { recursive: true, force: true });
  }
});
