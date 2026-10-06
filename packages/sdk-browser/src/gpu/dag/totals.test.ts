// Triangle totals are held by the GPU alone, in `dagMask` (`shader/totalsWgsl.ts`): the CPU sums
// none. This test holds the contract:
// ① the invariant `selected − drawn − uncovered = 0` on a frame where residency REALLY digs a
//    hole, without which it would hold on zeros;
// ② each total is the sum of the pages the readback declares drawable, at every threshold,
//    when nothing is missing.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { packDagSelection } from './selection.ts'
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts'
import { cameraSelectionUniforms } from '../core/selection.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { ruleResidency } from './readiness.fixture.ts'
import { evaluateDagSelectionKernel } from './oracle/oracle.fixture.ts'
import { packedWorldsToRenderOrigin } from './pack.fixture.ts'

const VIEWPORT: [number, number] = [1280, 720]

/** The frontier-count scene, whose every page carries a varying triangle count, and of which one
 *  in seven is blended: without that, `transparentTriangles` would agree on zero. */
function scene(threshold: number, z = 16) {
  const pages = scenePages(4096, 8).map((page, i) => ({ ...page, transparent: i % 7 === 0 }))
  const roots = sceneRoots(pages, [new G.Matrix4()], true)
  const packed = packDagSelection(roots)
  const uni = uniforms(threshold, z)
  // The kernel works in the render frame: without rebasing, a relative view and an absolute world
  // would mix and the cut would be empty — silently, which would check everything on nothing.
  packedWorldsToRenderOrigin(packed, roots, uni.cameraWorld)
  return { pages, packed, uni }
}

function uniforms(threshold: number, z = 16) {
  const camera = G.perspectiveCamera(55, VIEWPORT[0] / VIEWPORT[1], 0.1, 200)
  camera.position.set(0, 0, z)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  return cameraSelectionUniforms(engineCamera(camera), threshold, VIEWPORT)
}

test('the totals are taken on what the cut rule draws', () => {
  const { pages, packed, uni } = scene(1)
  // One page in three resident: the rule draws fewer pages than the cut wants.
  const resident = Uint32Array.from({ length: packed.pageCount }, (_, id) => (id % 3 ? 0 : 1))
  const reading = evaluateDagSelectionKernel(packed, uni, ruleResidency(packed, resident))
  const { selectedTriangles, drawnTriangles, drawablePageIds } = reading
  assert.ok(drawnTriangles > 0, 'the frame must still draw')
  assert.ok(drawablePageIds!.length < reading.pageIds.length, 'residency must withhold a page')
  assert.equal(selectedTriangles, drawnTriangles)
  // `drawn` is exactly the sum of the pages the readback declares drawable — no more, no less.
  const sum = (ids: readonly number[]) =>
    ids.reduce((total, id) => total + (pages[id].triangles as number), 0)
  assert.equal(drawnTriangles, sum(drawablePageIds!))
})

test('the blended share is taken on the same set as the total', () => {
  const { pages, packed, uni } = scene(1)
  const reading = evaluateDagSelectionKernel(packed, uni)
  const dessinables = reading.drawablePageIds!
  const expected = dessinables
    .filter((id) => pages[id].transparent)
    .reduce((total, id) => total + (pages[id].triangles as number), 0)
  assert.ok(expected > 0, 'the scene must carry blended clusters')
  assert.equal(reading.transparentTriangles, expected)
  assert.ok(reading.transparentTriangles < reading.selectedTriangles, 'and not all of them')
})

test('with nothing missing, every total is the sum of the drawable pages', () => {
  const { pages } = scene(1)
  const sum = (ids: readonly number[], blended = false) =>
    ids
      .filter((id) => !blended || pages[id].transparent)
      .reduce((total, id) => total + (pages[id].triangles as number), 0)
  for (const threshold of [0.25, 0.5, 1, 2]) {
    const { packed, uni } = scene(threshold)
    const reading = evaluateDagSelectionKernel(packed, uni)
    const dessinables = reading.drawablePageIds!
    assert.equal(reading.selectedTriangles, sum(dessinables), `threshold ${threshold}: cut`)
    assert.equal(reading.drawnTriangles, sum(dessinables), `threshold ${threshold}: draw`)
    assert.equal(
      reading.transparentTriangles,
      sum(dessinables, true),
      `threshold ${threshold}: blend`,
    )
  }
})
