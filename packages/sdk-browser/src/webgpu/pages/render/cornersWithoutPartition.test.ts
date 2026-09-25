// #198: a visibility image encoded while the partition is absent still clears the table's dirty
// marks. The partition that appears afterwards, on the same table age, must hold the corners of
// the rows that changed in between.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { MANIFEST_IDENTITY } from '../../../backend/pagesBackend.fixture.ts';
import { QUAD_MANIFEST, triangleGeometry } from '../../../backend/pagesBackendScenes.fixture.ts';
import { collectClusterPages } from '../../../page/selection/selection.ts';
import { packDagSelection } from '../../../gpu/dag/selection.ts';
import { CORNER_VALUES } from '../../../gpu/partition/contract.ts';
import { packPageCorners } from '../../visibility/corners.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { createWebgpuPagesRuntime } from '../runtime.ts';
import { prepareWebgpuBackend } from '../prepare/prepare.ts';
import { disposeWebgpuPages } from '../io/metrics.ts';
import { fallbackToCpuCut } from '../io/drops.ts';
import { renderWebgpuPages } from './render.ts';
import { flushWebgpuPages } from './flush.ts';
import { rootPage, twoPrimitives } from '../testScenes.fixture.ts';
import type { ClusterManifest } from '../../../../../sdk-core/src/index.ts';

/** Two meshes twenty units apart: a camera sees both, or the second alone. */
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

test('#198: rows changed while the partition is absent reach the partition that appears', async () => {
  installGpuGlobals();
  const scene = twoPlaces();
  const metadata: ClusterManifest = { ...QUAD_MANIFEST, ...scene.metadata, ...MANIFEST_IDENTITY };
  const collected = collectClusterPages(scene.source, metadata, scene.indices, scene.associations);
  const gpu = mockGpu({ packed: packDagSelection(collected.roots) });
  const rt = createWebgpuPagesRuntime({
    ...scene,
    metadata,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    await prepareWebgpuBackend(rt, gpu.device);
    // The CPU cut names the rows the camera sees: a narrower view moves a page to another row.
    fallbackToCpuCut(rt, 'rows follow the camera');
    const { rows } = rt.layout;
    // Bounded: the two pages are resident at prepare, so a few images settle the cut.
    for (let frame = 0; frame < 4 && rows.packedCount < 2; frame++) {
      renderWebgpuPages(rt, lookAt(10, 30));
      await flushWebgpuPages(rt);
    }
    assert.equal(rows.packedCount, 2, 'the wide view draws both rows');
    const partition = rt.vis.gpuPartition;
    assert.ok(partition && rt.vis.visView, 'the visibility pass encodes with its partition');
    const held = new Float32Array(rt.layout.cornerPacked.length),
      upload = partition.uploadCorners.bind(partition);
    partition.uploadCorners = (packed, from, to) => {
      held.set(
        packed.subarray(from * CORNER_VALUES, (to + 1) * CORNER_VALUES),
        from * CORNER_VALUES,
      );
      upload(packed, from, to);
    };
    const firstPage = rows.packedPageIndex[0],
      epoch = rows.tableEpoch;
    // The visibility pass without its partition: the second mesh alone, so row 0 changes occupant.
    rt.vis.gpuPartition = undefined;
    for (let frame = 0; frame < 4 && rt.layout.rows.packedCount !== 1; frame++) {
      renderWebgpuPages(rt, lookAt(21, 5));
      await flushWebgpuPages(rt);
    }
    assert.equal(rows.packedCount, 1, 'the narrow view draws one row');
    assert.notEqual(rows.packedPageIndex[0], firstPage, 'row 0 changed occupant');
    // The partition appears on the same table age; the view steps, or the image would be held.
    rt.vis.gpuPartition = partition;
    renderWebgpuPages(rt, lookAt(21, 5.01));
    await flushWebgpuPages(rt);
    assert.equal(rows.tableEpoch, epoch, 'the table age did not change');
    const expected = new Float32Array(CORNER_VALUES);
    packPageCorners(expected, 0, rows.packedRecs[0]!);
    assert.deepEqual(
      held.subarray(0, CORNER_VALUES),
      expected,
      'the partition holds row 0 corners',
    );
  } finally {
    disposeWebgpuPages(rt);
    scene.dispose();
  }
});
