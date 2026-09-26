// #364 (measure ko): a sprite's quad, turned to the camera by every raster, is drawn in ONE pass.
// Drawn as a two-sided transparent surface — its back, then its front — each sprite took two
// entries in the transparent plan, whose per-frame ranking grows with the square of their count:
// the main-thread cost `snow-of-sprites` measured. The surface is the one the world builds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { drawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import type { GraphMesh } from '../../host/graph/mesh.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import { surfaceOf } from '../../page/surface.ts';
import { drawPasses } from '../../cluster/batchMesh.ts';
import {
  buildBlendStatics,
  planCull,
  planVertexCull,
  refreshBlendPlan,
} from '../../webgpu/blend/plan.ts';
import { createWebgpuBlendState, type BlendGpuItem } from '../../webgpu/blend/state.ts';
import { buildWorldMirror } from './worldMirror.ts';
import type { Cut } from './worldCuts.ts';

/** The host mesh a world builds for a sprite wearing `picture`. */
function spriteMesh(picture = material.sprite()) {
  const drawn = drawnTriangles(object.sprite().geometry, 'sprite')!;
  const cut = { key: 's', drawn, runtime: {} as never, users: new Set(), held: false } as Cut;
  const { root } = buildWorldMirror({
    placed: [{ cut, material: picture, rows: {} as PlacementRows, name: 's' }],
    models: [],
    rankOf: () => 0,
  });
  return root.children[0] as GraphMesh;
}

test('a transparent sprite takes one entry of the transparent plan, with no cull', () => {
  const surface = surfaceOf(spriteMesh().material);
  for (const count of [1, 64, 1500]) {
    const blendState = createWebgpuBlendState();
    for (let i = 0; i < count; i++)
      blendState.blendGpu.push({
        surface,
        matrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i, 0, 0, 1] },
        count: 6,
        paged: true,
      } as unknown as BlendGpuItem);
    buildBlendStatics(blendState);
    refreshBlendPlan(blendState);
    const entries = [...blendState.orders[0]];
    assert.equal(entries.length, count, 'one entry per sprite, as many as the sprites');
    for (const entry of entries) assert.deepEqual([planCull(entry), planVertexCull(entry)], [0, 0]);
  }
});

test('a transparent sprite is drawn in one pass on WebGL2 too', () => {
  assert.deepEqual(drawPasses(spriteMesh().material), [undefined]);
  const cutout = spriteMesh(material.sprite({ transparent: false, alphaTest: 0.5 }));
  assert.deepEqual(drawPasses(cutout.material), [undefined]);
});
