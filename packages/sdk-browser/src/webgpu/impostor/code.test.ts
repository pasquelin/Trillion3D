// #1335: the impostor draw loads on first use, so the CDN core stays within its budget. A cache
// without baked impostors never asks it; one with them asks it, plans no card until it lands —
// every root keeps its clusters, no image lost — and is asked a new image once it has.
import test from 'node:test';
import assert from 'node:assert/strict';
import { families } from '../../host/families.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { impostorCode } from './code.ts';

const session = (baked: number) => {
  let changed = 0;
  const rt = {
    context: { metadata: { impostors: { baked } } },
    run: { gate: { resourcesChanged: () => void changed++ } },
  } as unknown as WebgpuPagesRuntime;
  return { rt, changed: () => changed };
};

test('the impostor draw is asked by a baked cache only, and its arrival asks a new image', async () => {
  const plain = session(0);
  assert.equal(impostorCode(plain.rt), undefined);
  assert.equal(families.impostors.arrived, false, 'a cache without cards fetches nothing');
  const baked = session(1);
  assert.equal(impostorCode(baked.rt), undefined, 'no card before the draw lands');
  assert.equal(impostorCode(baked.rt), undefined);
  await families.impostors.settled();
  await Promise.resolve();
  assert.equal(baked.changed(), 1, 'one new image per round, however many images asked');
  assert.equal(typeof impostorCode(baked.rt)?.planWebgpuImpostors, 'function');
  assert.equal(plain.changed(), 0);
});
