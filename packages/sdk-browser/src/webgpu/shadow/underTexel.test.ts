// #831: 128 restore copies a frame for two small moving cars. A moving caster is drawn into no sun
// page whose texels it is under — its sphere narrower than one —, by every cull: the host regions'
// (`keepCaster`) and the GPU pages' (`freshKeeps`), run here from their shipped WGSL; its moves then
// stale none of those pages (`pageRects.ts`). A still caster is always drawn: the static layer
// keeps it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import {
  MOBILITY_CORNER_SHIFT,
  MOBILITY_MOVING,
  SHADOW_CULL_SHADER,
  SHADOW_LIGHT_CULL_SHADER,
} from '../../gpu/shadow/cullShader.ts';
import { SHADOW_FRESH_CULL_WGSL } from './freshCullWgsl.ts';
import { runShadowPairs } from './freshRun.fixture.ts';
import { FRESH_ARG, FRESH_PARAMS, freshArgWords } from './freshLayout.ts';
import { SHADOW_CULL_TEXEL } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { writeSunSquare } from '../../../../sdk-core/src/scene/light-shadow/sunFaces.ts';
import { PAGES as MODEL } from '../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
import { sunScene } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';

const PAGES = 4;

/** The pairs one sun page of four-metre texels keeps of `rows` spheres, each moving or not. */
function kept(rows: { sphere: number[]; moving: boolean }[]) {
  const volume = new Float32Array(SHADOW_CULL_FLOATS);
  // A box of eight metres round the origin, its depth along y, a quarter texel per metre.
  volume.set([0, 0, 0, 4, 0, 1, 0, -1, 1, 0, 0, 4, 0, 0, 1, 4]);
  volume[SHADOW_CULL_TEXEL] = 0.25;
  const spheres = new Float32Array(rows.flatMap((row) => row.sphere)),
    mobility = Uint32Array.from(
      rows,
      (row) => (1 << MOBILITY_CORNER_SHIFT) | (row.moving ? MOBILITY_MOVING : 0),
    ),
    params = new Uint32Array(FRESH_PARAMS),
    args = new Uint32Array(freshArgWords(PAGES)),
    capacity = 2 * rows.length,
    pairs = new Uint32Array(2 * capacity);
  params.set([PAGES, 2, 1, rows.length, rows.length, rows.length, capacity]);
  args[FRESH_ARG.regions] = 1;
  runShadowPairs(
    ...[spheres, params, volume, pairs, args, mobility].map((a) => new Uint8Array(a.buffer)),
  );
  // The still rows' pairs from the list's start, the moving ones' from its end down.
  const still = Array.from({ length: args[FRESH_ARG.still] }, (_, i) => pairs[2 * i + 1]),
    moving = Array.from(
      { length: args[FRESH_ARG.moving] },
      (_, i) => pairs[2 * (capacity - 1 - i) + 1],
    );
  return [...still, ...moving].sort();
}

test('a moving caster under a texel of a sun page is drawn into none; a still one always is', () => {
  const rows = [
    { sphere: [1, 0, 1, 1.5], moving: true }, // three metres wide: under a four-metre texel
    { sphere: [1, 0, 1, 1.5], moving: false }, // the same, still: the static layer keeps it
    { sphere: [-1, 0, -1, 2.5], moving: true }, // five metres: over a texel
  ];
  assert.deepEqual(kept(rows), [1, 2]);
});

test('every cull skips the moving casters under a texel, and a host sun page says its texel', () => {
  const skip = /\(word&1u\)!=0u&&underTexel\(volume,spheres\[row\]\)/;
  for (const shader of [SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER]) assert.match(shader, skip);
  assert.match(SHADOW_FRESH_CULL_WGSL, /&1u\)!=0u&&underTexel\(volumes\[k\]/);
  // The host's sun page carries its level's texels per metre, as the GPU's own pages do.
  const { plan, slice } = sunScene(),
    level = plan.sun.finest[slice] + 6,
    cull = new Float32Array(SHADOW_CULL_FLOATS);
  writeSunSquare(new Float32Array(16), 0, cull, 0, plan.sun, slice, level, 0, 0);
  assert.equal(cull[SHADOW_CULL_TEXEL], Math.fround(1 / MODEL.shadowSunTexelMetres(level)));
  assert.ok(cull[7] < 0, 'a box');
});
