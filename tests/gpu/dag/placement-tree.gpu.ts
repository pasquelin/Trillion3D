// The placement tree on the GPU: over a generated field of 1600 placements, the WGSL
// kernel's cut — cells, then instance groups, then the placements a kept group prepares — is its
// Node oracle's, pose by pose, and the oracle's is the flat descent's (`placementTree.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { engineCamera } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts'
import { evaluateDagSelectionKernel } from '../../../packages/sdk-browser/src/gpu/dag/oracle/oracle.fixture.ts'
import {
  fieldCamera,
  placementField,
} from '../../../packages/sdk-browser/src/gpu/dag/placementTree.fixture.ts'
import { runSelectionKernel } from './selectionKernel.ts'

const VIEWPORT: [number, number] = [1280, 720]
/** Name, eye, target, far plane. */
const POSES: Array<[string, number[], number[], number]> = [
  ['along a row', [30, 2, -30], [30, 0, -200], 120],
  ['over a corner', [-10, 40, 10], [60, 0, -60], 400],
  ['looking away', [-50, 2, 50], [-200, 0, 200], 400],
]

test('the GPU cut through the placement tree is its oracle’s, pose by pose', async () => {
  const roots = placementField(40, 6)
  const cases = POSES.map(([name, eye, at, far]) => {
    const uniforms = cameraSelectionUniforms(engineCamera(fieldCamera(eye, at, far)), 1, VIEWPORT)
    const packed = packedWorldsToRenderOrigin(packDagSelection(roots), roots, uniforms.cameraWorld)
    assert.ok(packed.placementTree, 'the field takes a tree')
    return { name, packed, uniforms }
  })
  const { adapter, readings } = await runSelectionKernel(cases)
  console.log(
    JSON.stringify({
      adapter,
      poses: readings.map(({ name, drawn, candidates }) => ({
        name,
        drawn: drawn.length,
        candidates,
      })),
    }),
  )
  cases.forEach(({ name, packed, uniforms }, k) => {
    const oracle = evaluateDagSelectionKernel(packed, uniforms)
    assert.equal(readings[k].overflow, 0, `${name}: no list overflows`)
    assert.deepEqual(
      readings[k].drawn,
      [...(oracle.drawablePageIds ?? [])].sort((a, b) => a - b),
      `${name}: drawn`,
    )
    assert.deepEqual(
      readings[k].pages,
      [...oracle.pageIds].sort((a, b) => a - b),
      `${name}: requested`,
    )
  })
  assert.ok(
    readings.some(({ drawn }) => drawn.length > 0),
    'some pose draws',
  )
})
