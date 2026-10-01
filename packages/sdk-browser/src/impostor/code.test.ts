// #1335: the impostor draw is a family on demand, so the CDN core stays within its budget. A cache
// without baked impostors never fetches it; one with them awaits it where it prepares, so its first
// image draws the cards. Fails on develop: the file is new.
import test from 'node:test';
import assert from 'node:assert/strict';
import { families } from '../host/families.ts';
import type { BackendContext } from '../backend/types.ts';
import { loadImpostorCode } from './code.ts';
import * as webgl from '../webgl/impostor/lent.ts';
import * as webgpu from '../webgpu/impostor/lent.ts';

const session = (baked: number) =>
  ({ metadata: { impostors: { baked } } }) as unknown as BackendContext;

test('the impostor draw is fetched by a baked cache only, and awaited before its first image', async () => {
  assert.equal(await loadImpostorCode(session(0), webgpu), undefined);
  assert.equal(families.impostors.arrived, false, 'a cache without cards fetches nothing');
  const code = await loadImpostorCode(session(1), webgpu);
  assert.equal(families.impostors.arrived, true);
  assert.equal(typeof code?.planWebgpuImpostors, 'function');
  assert.equal(typeof code?.encodeImpostorCards, 'function');
  assert.equal(typeof code?.createWebglImpostors, 'function');
});

test('the impostor draw arrives lent the core pieces it draws with, never importing them', async () => {
  // Imported by the family, these core modules would split the CDN core into more chunks.
  const { core } = await import('./borrowed.ts');
  for (const lent of [webgl, webgpu]) {
    await loadImpostorCode(session(1), lent);
    for (const [name, piece] of Object.entries(lent))
      assert.equal(core[name as keyof typeof core], piece, name);
  }
});
