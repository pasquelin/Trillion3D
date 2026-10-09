// The world DAG's place in the packing is the packing's to say (`packed.world.root`, one uniform
// word): a growth packs new placements after it, and nothing reads it as the last placement. Its
// residency is mirrored, its threshold faded and the placements around it held to the frame's,
// wherever it sits. On a generated scene: twelve placements of one primitive, the world DAG of
// three cells of four objects packed between them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorldResidencyMirror } from './worldMirror.ts'
import { packDagSelection } from './pack.ts'
import { ruleDag } from '../../page/cut/cutRule.fixture.ts'
import { worldDag } from '../../scene/worldSuperRoots.fixture.ts'
import { writeDagUniforms } from './uniforms.ts'
import { viewWord, VIEW_BLOCK_WORDS } from './viewLayout.ts'
import { cameraSelectionUniforms } from '../core/selection.ts'
import { stripCamera } from '../../page/cut/cutRuleBackends.fixture.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { DAG_SELECTION_SHADER } from './shader/shader.ts'
import type { DagRoot } from './types.ts'

/** Six placements, the world DAG, six more: a growth's packing. */
function scene() {
  const world = worldDag(),
    manifest = ruleDag(8),
    placements = Array.from({ length: 6 }, () => manifest as unknown as DagRoot)
  const packed = packDagSelection([...placements, world as unknown as DagRoot, ...placements])
  return { world, packed }
}

test('a world DAG packed between placements is mirrored where it sits', () => {
  const { world, packed } = scene()
  assert.equal(packed.world!.root, 6)
  const mirror = createWorldResidencyMirror({ ...packed, world: packed.world! })
  const rows = new Uint32Array(packed.pageCount)
  const { pageBase, pageCount } = packed.cutLinks[6],
    after = packed.cutLinks[7].pageBase
  rows[after] = 1
  world.origins.forEach((origin, rank) => origin < 0 && (rows[pageBase + rank] = 1))
  const { flags } = mirror.update(rows)
  assert.equal(flags[after], 1, 'a page of a placement packed after the world is a scene page')
  for (let rank = 0; rank < pageCount; rank++)
    if (world.origins[rank] >= 0) assert.equal(flags[pageBase + rank], 0, 'no object is placed')
})

test("the world DAG's threshold is its own wherever it sits, the last placement the frame's", () => {
  const { packed } = scene()
  packed.world!.scale = 0.5
  const block = new Float32Array(VIEW_BLOCK_WORDS),
    ints = new Uint32Array(block.buffer)
  const uniforms = cameraSelectionUniforms(stripCamera(worldDag()), 2, [1280, 720])
  writeDagUniforms(block, packed, uniforms, 1)
  assert.equal(ints[viewWord('worldRoot')], 6, 'the packing names its world DAG')
  const views = [
    {
      worldLinks: ints[viewWord('worldLinks')],
      worldRoot: ints[viewWord('worldRoot')],
      worldScale: block[viewWord('worldScale')],
      worldCount: packed.worldCount,
      pixelError: 2,
    },
  ]
  const kernel = shaderRun<{ thresholdOf(w: number): number }>(
    DAG_SELECTION_SHADER,
    ['thresholdOf'],
    { views, vi: 0 },
  )
  assert.equal(kernel.thresholdOf(6), 1, 'the world DAG, faded')
  assert.equal(kernel.thresholdOf(12), 2, 'the last placement, the frame')
  assert.equal(kernel.thresholdOf(0), 2)
})
