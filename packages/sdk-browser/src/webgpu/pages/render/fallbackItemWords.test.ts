// #198: the fallback draw uploads the rows the table changed and clears their dirty marks. The draw
// records the visibility pass keeps per row are refreshed from those same marks: a row whose
// occupant changed under the fallback must still reach the compaction once the pass comes back on
// the same compaction target.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { MANIFEST_IDENTITY } from '../../../backend/pagesBackend.fixture.ts';
import { QUAD_MANIFEST, triangleGeometry } from '../../../backend/pagesBackendScenes.fixture.ts';
import { collectClusterPages } from '../../../page/selection/selection.ts';
import { packDagSelection } from '../../../gpu/dag/selection.ts';
import { DRAW_ITEM_U32 } from '../../../gpu/draw/draw.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { visBin } from '../prepare/pipelineFor.ts';
import { createWebgpuPagesRuntime } from '../runtime.ts';
import { prepareWebgpuBackend } from '../prepare/prepare.ts';
import { disposeWebgpuPages } from '../io/metrics.ts';
import { fallbackToCpuCut } from '../io/drops.ts';
import { renderWebgpuPages } from './render.ts';
import { flushWebgpuPages } from './flush.ts';
import { rootPage, twoPrimitives } from '../testScenes.fixture.ts';

/** Two meshes of distinct pipeline bins, twenty units apart: a camera sees both, or the second alone. */
function twoPlaces() {
  const geoA = triangleGeometry([-1, -1, 0, 1, -1, 0, 1, 1, 0]),
    geoB = triangleGeometry([20, -1, 0, 22, -1, 0, 22, 1, 0]);
  const front = G.basicSurface({ color: 0xff0000, side: G.FRONT_SIDE }),
    both = G.basicSurface({ color: 0x00ff00, side: G.DOUBLE_SIDE });
  const meshA = G.mesh(geoA, front),
    meshB = G.mesh(geoB, both),
    source = new G.Group();
  source.add(meshA, meshB);
  const pages = twoPrimitives(
    meshA,
    meshB,
    rootPage('0', [-1, -1, 0], [1, 1, 0]),
    rootPage('1', [20, -1, 0], [22, 1, 0]),
  );
  const dispose = () => [geoA, geoB, front, both].forEach((item) => item.dispose());
  return { source, ...pages, dispose };
}

function lookAt(x: number, z: number) {
  const cam = G.perspectiveCamera(55, 1, 0.1, 100);
  cam.position.set(x, 0, z);
  cam.lookAt(x, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

test('#198: a row changed under the fallback draw reaches the visibility pass', async () => {
  installGpuGlobals();
  const scene = twoPlaces();
  const collected = collectClusterPages(
    scene.source,
    scene.metadata,
    scene.indices,
    scene.associations,
  );
  const gpu = mockGpu({ compute: true });
  const rt = createWebgpuPagesRuntime({
    ...scene,
    metadata: { ...QUAD_MANIFEST, ...scene.metadata, ...MANIFEST_IDENTITY },
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  const both = lookAt(10, 30),
    second = lookAt(21, 5);
  try {
    await prepareWebgpuBackend(rt, gpu.device);
    // The CPU cut names the rows the camera sees: a narrower view moves a page to another row.
    fallbackToCpuCut(rt, 'rows follow the camera');
    const { rows } = rt.layout;
    // Bounded: the two pages are resident at prepare, so a few images settle the cut.
    for (let frame = 0; frame < 4 && rows.packedCount < 2; frame++) {
      renderWebgpuPages(rt, both);
      await flushWebgpuPages(rt);
    }
    assert.equal(rows.packedCount, 2, 'the wide view draws both rows');
    const draw = rt.vis.gpuDraw!,
      view = rt.vis.visView;
    assert.ok(draw && view, 'the visibility pass encodes with its compaction');
    // What the compaction holds: the words each upload sends, row by row.
    const held = new Uint32Array(rt.layout.drawItemWords.length);
    const upload = draw.uploadItems.bind(draw);
    draw.uploadItems = (items, from, to) => {
      held.set(
        items.subarray(from * DRAW_ITEM_U32, (to + 1) * DRAW_ITEM_U32),
        from * DRAW_ITEM_U32,
      );
      upload(items, from, to);
    };
    const firstPage = rows.packedPageIndex[0];
    // The fallback draw: the second mesh alone, so row 0 changes occupant.
    rt.vis.visView = undefined;
    for (let frame = 0; frame < 4 && rows.packedCount !== 1; frame++) {
      renderWebgpuPages(rt, second);
      await flushWebgpuPages(rt);
    }
    assert.equal(rows.packedCount, 1, 'the narrow view draws one row');
    assert.notEqual(rows.packedPageIndex[0], firstPage, 'row 0 changed occupant');
    assert.equal(rt.vis.gpuDraw, draw, 'the compaction target is the same');
    // The visibility pass comes back on the same compaction target; the view steps, or the
    // previous image would be held.
    rt.vis.visView = view;
    renderWebgpuPages(rt, lookAt(21, 5.01));
    await flushWebgpuPages(rt);
    assert.equal(rows.packedCount, 1);
    const rec = rows.packedRecs[0]!;
    assert.equal(held[2], rows.packedPageIndex[0], 'the compaction holds the row page index');
    assert.equal(held[1], visBin(rec), 'the compaction holds the row pipeline bin');
  } finally {
    disposeWebgpuPages(rt);
    scene.dispose();
  }
});
