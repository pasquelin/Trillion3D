import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { SDK_VERSION, DEFAULT_SCOPE } from './base.ts';
import { assertCachePointer } from './cache.ts';
import { answerSheet, readSheet } from '../../../sdk-node/src/cutout/sheet.mts';

test('engine identity can be consumed as a version and default preparation stays streamable', () => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(SDK_VERSION);
  assert.ok(match, 'a host must be able to parse the engine version');
  assert.ok(match.slice(1, 4).every((part) => Number.isSafeInteger(Number(part))));
  assert.equal(
    assertCachePointer(
      { status: 'ready', url: 'model/clusters.json', scope: DEFAULT_SCOPE },
      'slice',
    ),
    'model/clusters.json',
  );
});

test('the exported sheet name allows host answers to be saved and read atomically', async () => {
  const parent = join(process.cwd(), '.worktrees/logs');
  await mkdir(parent, { recursive: true });
  const cache = await mkdtemp(join(parent, 'sheet-consumer-'));
  try {
    const sheet = { version: 1, textures: { abc: { cutout: null } } };
    assert.equal(await answerSheet(cache, sheet, new Map([['abc', true]])), true);
    assert.deepEqual(await readSheet(cache), { version: 1, textures: { abc: { cutout: true } } });
    const files = await readdir(cache);
    assert.equal(files.length, 1);
    assert.ok(files[0].endsWith('.json'));
    assert.equal(await answerSheet(cache, sheet, new Map([['abc', true]])), false);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});
