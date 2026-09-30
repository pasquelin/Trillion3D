// #525: a sun page draws only the casters its own box meets; #1211: only those that reach the part
// of it its receivers read, grown by the filter's reach. The shader cannot run under node: the test
// restates its box test in TypeScript (`cullBox.fixture.ts`), and pins the shader's text it
// restates, so the two cannot drift apart silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { writeSunSquare } from '../../../../sdk-core/src/scene/light-shadow/sunFaces.ts';
import {
  PAGE_INDEX_MASK,
  PAGE_MAPPED,
  SHADOW_PAGE,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { sunPageMetres } from '../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
import {
  planFrame,
  report,
  sunPages,
  sunScene,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import {
  PAGE_FOOTPRINT_FULL,
  pageFootprint,
} from '../../../../sdk-core/src/scene/light-shadow/footprint.ts';
import { FOOTPRINT_REACH } from '../../webgpu/shadow/pageCompose.ts';
import { SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER } from './cullShader.ts';
import { SHADER_BOX, keeps } from './cullBox.fixture.ts';
import { SHADOW_FRESH_CULL_WGSL } from '../../webgpu/shadow/freshCullWgsl.ts';

test("every cull runs the box test this file restates, the GPU pages' too", () => {
  for (const shader of [SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER, SHADOW_FRESH_CULL_WGSL])
    for (const line of SHADER_BOX) assert.ok(shader.includes(line), line);
});

test("a caster outside a page's square is not drawn into it; one reaching it is", () => {
  const { plan, slice } = sunScene();
  const level = plan.sun.finest[slice] + 4,
    size = sunPageMetres(level);
  const volume = new Float32Array(SHADOW_CULL_FLOATS);
  writeSunSquare(new Float32Array(16), 0, volume, 0, plan.sun, slice, level, 3, 2);
  const right = plan.sun.frame.subarray(slice * 9, slice * 9 + 3);
  const beside = (pages: number) => [0, 1, 2].map((a) => volume[a] + right[a] * pages * size);
  assert.ok(keeps(volume, beside(0), 0.1 * size), 'a caster inside the page');
  assert.ok(!keeps(volume, beside(1), 0.3 * size), 'a caster over the next page');
  assert.ok(keeps(volume, beside(0.7), 0.3 * size), 'a caster reaching over its edge');
});

test('a caster whose widened bounds miss every receiver of a page is not drawn into it; one that reaches it is', () => {
  const { plan, slice } = sunScene();
  const level = plan.sun.finest[slice] + 4,
    texel = sunPageMetres(level) / SHADOW_PAGE;
  const square = new Float32Array(SHADOW_CULL_FLOATS),
    volume = new Float32Array(SHADOW_CULL_FLOATS);
  const compose = (into: Float32Array, footprint: number) =>
    writeSunSquare(
      new Float32Array(16),
      0,
      into,
      0,
      plan.sun,
      slice,
      level,
      3,
      2,
      1,
      footprint,
      FOOTPRINT_REACH,
    );
  // Drawn whole, the page culls to its square, as it did before its receivers were read.
  compose(volume, PAGE_FOOTPRINT_FULL);
  writeSunSquare(new Float32Array(16), 0, square, 0, plan.sun, slice, level, 3, 2);
  assert.deepEqual(volume, square);
  // Its receivers read its first quarter on each axis, texels [0, 32]².
  compose(volume, pageFootprint(0, 0, 32, 32));
  const frame = plan.sun.frame.subarray(slice * 9, slice * 9 + 9);
  // The world point of page texel `(x, y)`, on the light plane of the page's box centre.
  const at = (x: number, y: number) => {
    const u = (x - SHADOW_PAGE / 2) * texel,
      v = (SHADOW_PAGE / 2 - y) * texel;
    return [0, 1, 2].map((a) => square[a] + frame[a] * u + frame[3 + a] * v);
  };
  assert.ok(keeps(volume, at(16, 16), texel), 'a caster over its receivers');
  assert.ok(!keeps(volume, at(96, 96), 4 * texel), 'a caster over the page, far from them');
  const edge = 32 + FOOTPRINT_REACH;
  assert.ok(!keeps(volume, at(16, edge + 4), 2 * texel), 'one past the filter’s reach');
  assert.ok(keeps(volume, at(16, edge + 1), 2 * texel), 'one within it');
});

test('an off-camera wall over a visible floor keeps its shadow pages and casters', () => {
  const { store, plan, slice } = sunScene();
  const level = plan.sun.finest[slice] + 4,
    texel = sunPageMetres(level) / SHADOW_PAGE;
  // The floor is the visible receiver: a sun page it reads is requested and mapped (#525).
  const entries = sunPages(plan, slice, level, [[3, 2]]);
  report(plan, store, 1, entries);
  planFrame(plan, store, 1);
  const entry = entries[0];
  assert.ok(plan.table.words[entry] & PAGE_MAPPED, "the floor's page is kept");
  // The wall stands off-camera, its casters only shadow the floor: the page is drawn for the
  // floor's footprint — the first quarter of each axis — and the wall's box still reaches it.
  const page = plan.table.words[entry] & PAGE_INDEX_MASK,
    square = new Float32Array(SHADOW_CULL_FLOATS),
    volume = new Float32Array(SHADOW_CULL_FLOATS),
    footprint = pageFootprint(0, 0, 32, 32);
  writeSunSquare(
    new Float32Array(16),
    0,
    volume,
    0,
    plan.sun,
    slice,
    plan.pool.view[page],
    plan.pool.x[page],
    plan.pool.y[page],
    1,
    footprint,
    FOOTPRINT_REACH,
  );
  writeSunSquare(
    new Float32Array(16),
    0,
    square,
    0,
    plan.sun,
    slice,
    plan.pool.view[page],
    plan.pool.x[page],
    plan.pool.y[page],
  );
  const frame = plan.sun.frame.subarray(slice * 9, slice * 9 + 9),
    axis = frame.subarray(6, 9);
  // The world point of page texel `(x, y)`, `depth` along the light axis toward the far plane.
  const at = (x: number, y: number, depth = 0) => {
    const u = (x - SHADOW_PAGE / 2) * texel,
      v = (SHADOW_PAGE / 2 - y) * texel;
    return [0, 1, 2].map((a) => square[a] + frame[a] * u + frame[3 + a] * v + axis[a] * depth);
  };
  // A wall standing above the floor it shadows, off-camera: its casters reach the floor's
  // footprint, so they are kept.
  assert.ok(keeps(volume, at(16, 16, texel), 0.5 * texel), 'the off-camera wall over the floor');
  // A caster over the page but nowhere near the floor's receivers is not drawn into it.
  assert.ok(!keeps(volume, at(96, 96), 4 * texel), 'a caster off the floor');
});
