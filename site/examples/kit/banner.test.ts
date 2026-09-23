import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import english from '../i18n/en.json' with { type: 'json' };
import { announce } from './banner.ts';

test('every example gives the banner a line of what to do', () => {
  const words = english as Record<string, { banner?: unknown }>;
  const silent = readdirSync(new URL('..', import.meta.url))
    .filter((name) => name.endsWith('.html'))
    .map((name) => name.slice(0, -'.html'.length))
    .filter((id) => typeof words[id]?.banner !== 'string' || !words[id].banner);
  assert.deepEqual(silent, []);
});

test('an example tells its host page what the banner says, once per change', () => {
  const sent: unknown[] = [];
  Object.assign(globalThis, { parent: { postMessage: (message: unknown) => sent.push(message) } });
  try {
    announce('Checkpoint', 'Keep going');
    announce('Checkpoint', 'Keep going');
    announce('');
  } finally {
    Reflect.deleteProperty(globalThis, 'parent');
  }
  assert.deepEqual(sent, [
    { type: 'trillion3d:banner', title: 'Checkpoint', line: 'Keep going' },
    { type: 'trillion3d:banner', title: '', line: '' },
  ]);
});
