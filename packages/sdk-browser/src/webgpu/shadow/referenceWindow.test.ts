// #1281: the reference-scoped sun window is one session parameter, the GPU shadow passes included.
// The demand, allocation, pool and fresh-page shaders compile the window the plan runs with, so the
// reference session's 68-page clipmap is addressed — entry mask, table stride, level words, request
// bitset — exactly as the shading reads it; the ordinary window compiles the constant, byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_SUN_WINDOW, referenceSunWindow } from '../../frame/referenceMode.ts';
import { SHADOW_REQUEST_MISS } from '../../../../sdk-core/src/scene/light-shadow/footprint.ts';
import {
  SUN_WINDOW,
  shadowTableEntries,
  shadowTableStride,
  sunLevelEntries,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shadowEntryMask } from './poolWgsl.ts';
import { allocationWgsl } from './allocWgsl.ts';
import { shadowDemandWgsl } from './demandWgsl.ts';
import { shadowFreshWgsl } from './freshWgsl.ts';
import { shadowWordsWgsl } from './wordsWgsl.ts';

/** Every GPU pass that addresses the page table, compiled for a window. */
const passesFor = (pages: number) => ({
  demand: shadowDemandWgsl(pages),
  allocation: allocationWgsl(pages),
  fresh: shadowFreshWgsl(pages),
  words: shadowWordsWgsl(pages),
});

test('the GPU shadow passes compile the session window, the ordinary constant by default', () => {
  assert.ok(REFERENCE_SUN_WINDOW > SUN_WINDOW);
  assert.equal(referenceSunWindow(), REFERENCE_SUN_WINDOW);
  const reference = passesFor(REFERENCE_SUN_WINDOW),
    ordinary = passesFor(SUN_WINDOW);
  // The page model: the demand, allocation and fresh passes address entries with the window.
  for (const pass of ['demand', 'allocation', 'fresh'] as const) {
    assert.match(
      reference[pass],
      new RegExp(`SUN_WINDOW_PAGES:i32=${REFERENCE_SUN_WINDOW}\\b`),
      pass,
    );
    assert.doesNotMatch(reference[pass], new RegExp(`SUN_WINDOW_PAGES:i32=${SUN_WINDOW}\\b`), pass);
  }
  // The pool's constants: allocation, fresh and words carry the entry mask and the table stride.
  for (const pass of ['allocation', 'fresh', 'words'] as const) {
    assert.match(
      reference[pass],
      new RegExp(`SHADOW_TABLE_STRIDE:u32=${shadowTableStride(REFERENCE_SUN_WINDOW)}u`),
      pass,
    );
    assert.match(
      reference[pass],
      new RegExp(`ENTRY_MASK:u32=${shadowEntryMask(REFERENCE_SUN_WINDOW)}u`),
      pass,
    );
    assert.doesNotMatch(
      reference[pass],
      new RegExp(`SHADOW_TABLE_STRIDE:u32=${shadowTableStride(SUN_WINDOW)}u`),
      pass,
    );
  }
  // The allocation's level words grow with the window too.
  assert.match(
    reference.allocation,
    new RegExp(`SUN_LEVEL_ENTRIES:i32=${sunLevelEntries(REFERENCE_SUN_WINDOW)}`),
  );
  assert.doesNotMatch(
    reference.allocation,
    new RegExp(`SUN_LEVEL_ENTRIES:i32=${sunLevelEntries(SUN_WINDOW)}\\b`),
  );
  // The ordinary window is the constant everywhere: no session, no change.
  assert.equal(ordinary.allocation, allocationWgsl());
  assert.equal(ordinary.demand, shadowDemandWgsl());
  assert.notEqual(reference.allocation, ordinary.allocation);
  assert.notEqual(reference.demand, ordinary.demand);
});

test('the entry mask clears the miss flag and keeps every entry, whatever the window', () => {
  for (const pages of [SUN_WINDOW, REFERENCE_SUN_WINDOW]) {
    const mask = shadowEntryMask(pages),
      last = shadowTableEntries(pages) - 1;
    assert.equal(mask & SHADOW_REQUEST_MISS, 0, `${pages}: the flag is outside the mask`);
    for (const entry of [0, 1, 2 ** 14, 2 ** 22, last]) {
      if (entry > last) continue;
      assert.equal(entry & mask, entry, `${pages}: entry ${entry} survives the mask`);
    }
  }
});
