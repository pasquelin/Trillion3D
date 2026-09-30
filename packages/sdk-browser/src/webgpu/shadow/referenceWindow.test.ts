// #1281: the reference-scoped sun window is one session parameter, the GPU shadow passes included.
// The demand, allocation, pool and fresh-page shaders compile the window the plan runs with, so the
// reference session's 68-page clipmap is addressed — entry mask, table stride, level words, request
// bitset — exactly as the shading reads it; the ordinary window compiles the constant, byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceSunWindow } from '../../frame/referenceMode.ts';
import { SHADOW_REQUEST_MISS } from '../../../../sdk-core/src/scene/light-shadow/footprint.ts';
import {
  SUN_WINDOW,
  shadowTableEntries,
  shadowTableStride,
  sunLevelEntries,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { pageModel } from '../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
import { NUMBERS } from '../../../../sdk-core/src/scene/light-shadow/pageOps.ts';
import { blendShader } from '../blend/shader.ts';
import { waterCompositeShader, waterRoutedShader } from '../water/compositeWgsl.ts';
import { allocationWgsl } from './allocWgsl.ts';
import { shadowDemandWgsl } from './demandWgsl.ts';
import { shadowFreshWgsl } from './freshWgsl.ts';
import { shadowWordsWgsl } from './wordsWgsl.ts';
import { BLEND_SHADER, WATER_COMPOSITE_SHADER } from '../../gpu/core/shaderTexts.fixture.ts';
import { RANK_SPAN } from '../../../../sdk-core/src/scene/light-shadow/rankSpan.ts';
import { shadowEntryMask } from './entryMask.ts';

/** The window a reference session at the boss's case runs with: 1117 CSS at DPR 2, 55°. */
const REFERENCE_SUN_WINDOW = referenceSunWindow(1117 * 2, 55);

/** Every GPU pass that addresses the page table, compiled for a window. */
const passesFor = (pages: number) => ({
  demand: shadowDemandWgsl(pages),
  allocation: allocationWgsl(pages),
  fresh: shadowFreshWgsl(pages),
  words: shadowWordsWgsl(pages),
});

test('the GPU shadow passes compile the session window, the ordinary constant by default', () => {
  assert.ok(REFERENCE_SUN_WINDOW > SUN_WINDOW);
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

test('a need key reads back its entry and sorts coarsest first, whatever the window', () => {
  for (const pages of [SUN_WINDOW, REFERENCE_SUN_WINDOW]) {
    const { shadowNeedKey } = pageModel(NUMBERS, pages),
      mask = shadowEntryMask(pages),
      last = shadowTableEntries(pages) - 1;
    for (const rank of [0, 1, 2, RANK_SPAN - 1])
      for (const entry of [0, 2 ** 22 - 1, 2 ** 22, last]) {
        if (entry > last) continue;
        const key = shadowNeedKey(rank, entry);
        assert.ok(key >= 0 && key < 2 ** 31, `${pages}: key ${key} is a non-negative i32`);
        assert.equal(key & mask, entry, `${pages}: rank ${rank} entry ${entry} decodes`);
        // A coarser rank always sorts first, even past the ordinary table's last entry.
        if (rank > 0) assert.ok(key < shadowNeedKey(rank - 1, 0), `${pages}: rank ${rank} first`);
      }
  }
});

test('the transparent and water passes read the shadows of the session window too', () => {
  const window = new RegExp(`SUN_WINDOW_PAGES:i32=${REFERENCE_SUN_WINDOW}\\b`);
  const ordinary = new RegExp(`SUN_WINDOW_PAGES:i32=${SUN_WINDOW}\\b`);
  for (const [pass, text] of Object.entries({
    blend: blendShader(REFERENCE_SUN_WINDOW),
    water: waterCompositeShader(REFERENCE_SUN_WINDOW),
    routed: waterRoutedShader(REFERENCE_SUN_WINDOW),
  })) {
    assert.match(text, window, pass);
    assert.doesNotMatch(text, ordinary, pass);
  }
  // No window: the ordinary text, the one every ordinary session compiles.
  assert.equal(blendShader(SUN_WINDOW), BLEND_SHADER);
  assert.equal(waterCompositeShader(SUN_WINDOW), WATER_COMPOSITE_SHADER);
  assert.match(BLEND_SHADER, ordinary);
});
