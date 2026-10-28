import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { createArrivalQueue } from '../../geometry/integration/arrivalQueue.ts'
import { createFrameBudget } from '../../geometry/integration/frameBudget.ts'
import { collectClusterPages } from '../../geometry/selection/collect.ts'
import { packDagSelection } from '../../geometry/dag/pack/pack.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuGlobals, transparentDraws } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { backendOf, quadScene, camera } from '../backend/testScenes.fixture.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'
import type { PageMesh } from '../../geometry/pages/pageMesh.ts'

test('paged transparent commands disappear outside the view and return with both faces on CPU and GPU cuts', async () => {
  installGpuGlobals()
  for (const gpuCut of [false, true]) {
    const fixture = quadScene()
    fixture.material.transparent = true
    G.sided(fixture.material, G.DOUBLE_SIDE)
    fixture.material.twoSidedPasses = true
    fixture.metadata.primitives[0].pass = 'clustered-blend'
    const twin = fixture.source.children[0].clone() as PageMesh
    fixture.source.add(twin)
    fixture.associations.set(twin, { meshes: 0, primitives: 0 })
    const roots = collectClusterPages(
      fixture.source,
      graphDraws(fixture.source, fixture.associations),
      fixture.metadata,
      fixture.indices,
    ).roots
    const mock = fakeDevice({ ...BACKEND, packed: gpuCut ? packDagSelection(roots) : undefined })
    const backend = backendOf({
      ...fixture,
      draws: graphDraws(fixture.source, fixture.associations),
      gpuDevice: mock.device,
      maxResidentPages: 4,
    })
    try {
      await backend.prepare()
      for (const x of [0, 100, 0]) {
        const view = camera()
        view.position.x = x
        view.lookAt(x, 0, 0)
        view.updateMatrixWorld()
        for (let i = 0; i < 3; i++) {
          backend.render(view)
          await backend.flush()
        }
        mock.draws.length = 0
        mock.writes.length = 0
        backend.render(view)
        const blend = transparentDraws(mock.draws)
        // The encode plan follows the scene: the two items, both faces each, share ONE run —
        // the vertex stage culls for them. In view, it draws the eight instances the cut writes
        // (two clusters, two faces, two items); out of view, the run merges two items, so it is
        // encoded and the expansion zeroes its instances.
        assert.equal(blend.length, 1, 'one draw for both items and both faces')
        assert.equal(backend.metrics().transparentDrawCalls, blend.length)
        assert.equal(blend[0].instanceCount, x ? 0 : 8, 'encode only the current view')
        assert.equal(
          mock.writes.filter((w) => w.buffer.label === 'Trillion3D transparent cluster spans')
            .length,
          0,
          'an unchanged cache does not rewrite spans, even after re-entering the view',
        )
      }
    } finally {
      await backend.dispose()
      fixture.geometry.dispose()
      fixture.material.dispose()
    }
  }
})

test('queued page arrivals are integrated by the next render without a second GPU submission', async () => {
  installGpuGlobals()
  const fixture = quadScene(),
    mock = fakeDevice(BACKEND)
  const backend = backendOf({
    ...fixture,
    gpuDevice: mock.device,
    maxResidentPages: 4,
  })
  try {
    await backend.prepare()
    const view = camera()
    backend.render(view)
    mock.submits.length = 0
    const arrivals = createArrivalQueue(64, createFrameBudget(2))
    arrivals.queue(backend, '0', fixture.indices.get('0')!)
    assert.equal(arrivals.drain(), 1)
    assert.equal(mock.submits.length, 0, 'accepting bytes must not render an image')
    backend.render(view)
    assert.equal(mock.submits.length, 1)
    // The image's counts come back with its readback, adopted by the drain (#1483).
    await backend.flush()
    assert.equal(backend.metrics().selectedTriangles, 2)
    assert.equal(backend.metrics().submittedTriangles, 2)
  } finally {
    await backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})
