// #815: a shadow render pass clears and restores its pages in two instanced draws, whatever its
// regions, and each quad covers exactly its page's texels, as the per-region viewport did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import {
  DRAW_ALL,
  DRAW_DYNAMIC,
  DRAW_FULL,
} from '../../../../sdk-core/src/scene/light-shadow/pool.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { MAX_SHADOW_REGIONS as R, createShadowRecordPack } from './recordPack.ts';
import { SHADOW_FACE_STRIDE } from './batchBudget.ts';
import { PAGE_QUAD_SHADER, createShadowPageQuads } from './pageQuads.ts';
import { createShadowRegionList } from '../../webgpu/shadow/regions.ts';
import { pagePlan, planPagePasses } from '../../webgpu/shadow/pagePasses.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

const volumes = new Float32Array(R * SHADOW_CULL_FLOATS),
  volumeWords = new Uint32Array(volumes.buffer);

test("a pass's clear and restore draws do not change when its regions go from 1 to the maximum", async () => {
  const { device } = fakeDevice();
  const faces = device.createBuffer({ size: R * (SHADOW_FACE_STRIDE + 4), usage: 0 });
  const quads = await createShadowPageQuads(device, faces);
  for (const [mode, most, perPass] of [
    [DRAW_ALL, R, [1]],
    [DRAW_DYNAMIC, R, [1]],
    // The static layer's pass clears, the pool's restores.
    [DRAW_FULL, R / 2, [1, 1]],
  ] as const)
    for (const pages of [1, 2, most / 2, most]) {
      const regions = createShadowRegionList(8);
      for (let page = 0; page < pages; page++) regions.push(page, mode, volumes, volumeWords);
      planPagePasses(regions, regions.count);
      const draws: number[] = [],
        instances: number[] = [];
      for (let k = 0; k < pagePlan.passes; k++) {
        const pass = {
          setBindGroup() {},
          setPipeline() {},
          draw: (_: number, count: number) => void instances.push(count),
        } as unknown as GPURenderPassEncoder;
        const { first, clears, restores } = pagePlan;
        draws.push(quads.encode(pass, first[k], clears[k], restores[k], {} as GPUBindGroup));
      }
      assert.deepEqual(draws, perPass, `mode ${mode}, ${pages} pages`);
      assert.equal(
        instances.length,
        draws.reduce((a, b) => a + b),
      );
      assert.equal(
        instances.reduce((a, b) => a + b),
        regions.count,
        'every region, once',
      );
    }
});

test("each quad covers exactly its page's texels, on any pool side", () => {
  const f = Math.fround;
  // The corner lines `page_quad_vs` runs, restated below.
  assert.ok(PAGE_QUAD_SHADER.includes('return vec4f(corner*rect.zw+rect.xy,0.0,1.0);'));
  assert.ok(PAGE_QUAD_SHADER.includes('emitter:vec4f,@size(160) rect:vec4f,}'));
  for (const side of [1, 3, 4, 37, 64, 71, 74]) {
    const pack = createShadowRecordPack(SHADOW_FACE_STRIDE, side),
      size = side * SHADOW_PAGE;
    for (const phys of [0, side * side - 1, Math.floor((side * side) / 2), side * side + 1]) {
      pack.writePage(0, new Float32Array(16), 0, phys, undefined, 0);
      const [ox, oy, sx, sy] = pack.facePacked.subarray(24, 28);
      const local = phys % (side * side),
        x0 = (local % side) * SHADOW_PAGE,
        y0 = Math.floor(local / side) * SHADOW_PAGE;
      // Framebuffer edges of the quad: the atlas viewport of `(ndc + 1) * size / 2`, y flipped.
      const edge = (ndc: number, flip: boolean) => f(f(flip ? 1 - ndc : ndc + 1) * (size / 2));
      const xs = [f(f(-sx) + ox), f(sx + ox)].map((n) => edge(n, false)),
        ys = [f(f(sy) + oy), f(f(-sy) + oy)].map((n) => edge(n, true));
      // Texel centres lie half a texel inside: an edge nearer than that keeps exactly the page.
      for (const [got, want] of [
        [xs[0], x0],
        [xs[1], x0 + SHADOW_PAGE],
        [ys[0], y0],
        [ys[1], y0 + SHADOW_PAGE],
      ])
        assert.ok(Math.abs(got - want) < 0.5, `side ${side}, page ${phys}: ${got} for ${want}`);
    }
  }
});

test('passes follow the static layer first, then the pool, each by layer, clears before restores', () => {
  const regions = createShadowRegionList(2);
  // Pages 5 (layer 1) and 1 (layer 0) drawn in full, page 0 (layer 0) its moving casters alone.
  for (const [page, mode] of [
    [5, DRAW_FULL],
    [1, DRAW_FULL],
    [0, DRAW_DYNAMIC],
  ])
    regions.push(page, mode, volumes, volumeWords);
  planPagePasses(regions, regions.count);
  const { order, passes, layerPasses, layer, first, clears, restores } = pagePlan;
  assert.equal(passes, 4);
  assert.equal(layerPasses, 2);
  // Regions 0, 2 fill the static layer's layers 1 and 0; 1, 3, 4 restore the pool's.
  assert.deepEqual([...order.subarray(0, 5)], [2, 0, 3, 4, 1]);
  assert.deepEqual([...layer.subarray(0, 4)], [0, 1, 0, 1]);
  assert.deepEqual([...first.subarray(0, 4)], [0, 1, 2, 4]);
  assert.deepEqual([...clears.subarray(0, 4)], [1, 1, 0, 0]);
  assert.deepEqual([...restores.subarray(0, 4)], [0, 0, 2, 1]);
});
