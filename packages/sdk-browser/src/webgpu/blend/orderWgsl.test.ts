// The GPU paint order against the CPU (#831, GPU wave 1): the order kernel, run in `shaderRun` on
// generated scenes (`orderKernel.fixture.ts`), sorts exactly as the CPU model
// (`orderBlendPlanCpu`), keys each item to the bit, and gives each slot the same run.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { surfaceOf } from '../../page/surface.ts';
import { BLEND_ORDER_SHADER } from './orderWgsl.ts';
import { orderBlendPasses, refreshEyeKeys } from './order.ts';
import { blendSceneOf } from './plan.fixture.ts';
import type { BlendGpuItem } from './state.ts';
import { checkKernel, gpuOf, transparentScene } from './orderKernel.fixture.ts';

test('the order kernel sorts every pass and places every slot as the CPU model does', () => {
  // Up to one block, then past it: 700 items ask a network of 1 024 entries, 1 500 one of 2 048,
  // their steps across blocks.
  for (const [count, seed, frames] of [
    [1, 1, 3],
    [6, 2, 3],
    [60, 3, 3],
    [61, 4, 3],
    [300, 5, 3],
    [700, 6, 2],
    [1500, 7, 1],
  ]) {
    const { blendState, next } = transparentScene(count, seed);
    for (let frame = 0; frame < frames; frame++) {
      const eye = [0, 1, 2].map(() => Math.round((next() - 0.5) * 16) / 2);
      checkKernel(blendState, eye, `${count} items, seed ${seed}, frame ${frame}`);
      if (count >= 700)
        assert.ok(blendState.orderSteps[0].length > 2, 'the network crosses blocks');
    }
  }
});

test('the kernel keys an item as the CPU does, to the bit, far from the origin and near ties', () => {
  const next = random(11);
  const items: BlendGpuItem[] = [];
  let previous = [0, 0, 0, 0];
  for (let i = 0; i < 200; i++) {
    const far = 10 ** Math.floor(next() * 7);
    let c = [0, 1, 2].map(() => (next() - 0.5) * far);
    let r = next() * 3;
    // A neighbour the same box moved by a few units in the 40th bit: the two keys share their high
    // word and differ in the low one only.
    if (i % 2) {
      c = previous.slice(0, 3);
      r = previous[3];
      c[0] += Math.abs(c[0]) * 2 ** -40 * (1 + Math.floor(next() * 4));
    }
    previous = [...c, r];
    items.push({
      surface: surfaceOf(G.basicSurface({ transparent: true })),
      matrix: new G.Matrix4().makeTranslation(c[0], c[1], c[2]),
      count: 0,
      paged: true,
      bounds:
        i % 7
          ? new Float64Array([c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1], c[2] + r])
          : undefined,
    } as unknown as BlendGpuItem);
  }
  const blendState = blendSceneOf(items);
  const cell = new Float64Array(1),
    bits = new Uint32Array(cell.buffer);
  for (let frame = 0; frame < 4; frame++) {
    const eye = [0, 1, 2].map(() => (next() - 0.5) * 10 ** Math.floor(next() * 6));
    orderBlendPasses(blendState, eye);
    refreshEyeKeys(blendState, eye);
    const { kernel } = gpuOf(blendState);
    items.forEach((item, rank) => {
      cell[0] = item.orderKey;
      const [high, low] = kernel.itemKey(rank).map((word) => word >>> 0);
      assert.deepEqual([high, low], [bits[1], bits[0]], `item ${rank}, frame ${frame}`);
    });
    // Keys that differ in their low word only, sorted by the kernel as by the CPU.
    checkKernel(blendState, eye, `near ties, frame ${frame}`);
  }
});

test('the block dispatch is the loop the emulation replays: load, steps between barriers, store', () => {
  const kernel = BLEND_ORDER_SHADER.slice(BLEND_ORDER_SHADER.indexOf('fn sortBlendBlocks'));
  const body = kernel.slice(0, kernel.indexOf('\n}\n'));
  assert.match(
    body,
    /held\[t\]=sortLoad\(base\+t\);\s*held\[t\+256u\]=sortLoad\(base\+t\+256u\);\s*workgroupBarrier\(\);/,
  );
  assert.match(
    body,
    /for\(var k=uni\.stageFrom;k<=uni\.stageTo;k=k<<1u\)\{\s*for\(var j=min\(k>>1u,256u\);j>0u;j=j>>1u\)\{\s*blockPair\(t,j,k,base\);\s*workgroupBarrier\(\);/,
  );
  assert.match(
    body,
    /sortStore\(base\+t,held\[t\]\);\s*sortStore\(base\+t\+256u,held\[t\+256u\]\);$/,
  );
});
