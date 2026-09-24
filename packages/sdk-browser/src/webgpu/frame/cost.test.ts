import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { webgpuPagesBackend } from '../pages/pages.ts';
import { exactPagesBackend } from '../../../../../bench/witnesses/exact/backend.ts';
import { createArrivalQueue } from '../../page/integration/arrivalQueue.ts';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { packDagSelection } from '../../gpu/dag/selection.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { quadScene, camera } from '../pages/testScenes.fixture.ts';

test('paged transparent commands disappear outside the view and return with both faces on CPU and GPU cuts', async () => {
  installGpuGlobals();
  for (const gpuCut of [false, true]) {
    const fixture = quadScene();
    fixture.material.transparent = true;
    fixture.material.side = G.DOUBLE_SIDE;
    fixture.metadata.primitives[0].pass = 'clustered-blend';
    const twin = fixture.source.children[0].clone() as G.GraphMesh;
    fixture.source.add(twin);
    fixture.associations.set(twin, { meshes: 0, primitives: 0 });
    const roots = collectClusterPages(
      fixture.source,
      fixture.metadata,
      fixture.indices,
      fixture.associations,
    ).roots;
    const mock = mockGpu(undefined, gpuCut ? packDagSelection(roots) : undefined);
    const backend = webgpuPagesBackend({
      ...fixture,
      gpuDevice: mock.device,
      maxResidentPages: 4,
      viewport: [32, 32],
    });
    try {
      await backend.prepare();
      for (const x of [0, 100, 0]) {
        const view = camera();
        view.position.x = x;
        view.lookAt(x, 0, 0);
        view.updateMatrixWorld();
        for (let i = 0; i < 3; i++) {
          backend.render(view);
          await backend.flush?.();
        }
        mock.draws.length = 0;
        mock.writes.length = 0;
        backend.render(view);
        const blend = mock.draws.filter((d) => d.entryPoint === 'vs');
        // The encode plan follows the scene: the two items, both faces each, share ONE run —
        // the vertex stage culls for them. In view, it draws the eight instances the cut writes
        // (two clusters, two faces, two items); out of view, the run merges two items, so it is
        // encoded and the expansion zeroes its instances, as the old readback never does.
        assert.equal(blend.length, 1, 'one draw for both items and both faces');
        assert.equal(backend.metrics().transparentDrawCalls, blend.length);
        assert.equal(blend[0].instanceCount, x ? 0 : 8, 'encode only the current view');
        assert.equal(
          mock.writes.filter((w) => w.label === 'Trillion3D transparent cluster spans').length,
          0,
          'an unchanged cache does not rewrite spans, even after re-entering the view',
        );
      }
    } finally {
      await backend.dispose();
      fixture.geometry.dispose();
      fixture.material.dispose();
    }
  }
});

test('queued page arrivals are integrated by the next render without a second GPU submission, on GL and GPU backends', async () => {
  installGpuGlobals();
  for (const gpu of [false, true]) {
    const fixture = quadScene(),
      mock = mockGpu();
    const context = {
      ...fixture,
      gpuDevice: mock.device,
      maxResidentPages: 4,
      viewport: [32, 32] as [number, number],
    };
    const backend = gpu ? webgpuPagesBackend(context) : exactPagesBackend(context);
    try {
      await backend.prepare();
      const view = camera();
      backend.render(view);
      mock.submits.length = 0;
      const arrivals = createArrivalQueue(512 * 1024, 64);
      arrivals.queue(backend, '0', fixture.indices.get('0')!);
      assert.equal(arrivals.drain(), 1);
      assert.equal(mock.submits.length, 0, 'accepting bytes must not render an image');
      backend.render(view);
      assert.equal(mock.submits.length, gpu ? 1 : 0);
      assert.equal(backend.metrics().selectedTriangles, 2);
      assert.equal(backend.metrics().submittedTriangles, 2);
    } finally {
      await backend.dispose();
      fixture.geometry.dispose();
      fixture.material.dispose();
    }
  }
});
