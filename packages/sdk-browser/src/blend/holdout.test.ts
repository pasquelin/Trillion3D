// The alpha holdout's target (`holdout.ts`): what a run of layers leaves of the background visible,
// one pixel of the blend model, the layers' outputs as `holdoutOut` gives them; and the two passes
// that start the target from the lit image's alpha and lay its visibility back over it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { blend, close, type Rgba } from './blendModel.fixture.ts'
import { HOLDOUT_TARGET } from './holdout.ts'
import { HOLDOUT_APPLY_WGSL, HOLDOUT_START_WGSL } from './holdoutWgsl.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'

/** The target after `layers` (their outputs, far to near) over a start of visibility `seen` and a
 *  throughput of 1. */
const accumulate = (seen: number, layers: readonly Rgba[]) =>
  layers.reduce<Rgba>(
    (target, layer) => blend(HOLDOUT_TARGET.blend!, layer, target),
    [seen, seen, seen, 1],
  )

test('a layer that holds out adds its opacity to the visibility, and lets the rest of the path through', () => {
  // A held-out layer of opacity 1: (add 1, through 0).
  close(accumulate(0, [[1, 1, 1, 0]]), [1, 1, 1, 0], 'a full hole')
  // Of opacity 0.25: a quarter of a hole, three quarters of the path left.
  close(accumulate(0, [[0.25, 0.25, 0.25, 0.75]]), [0.25, 0.25, 0.25, 0.75], 'a quarter')
})

test('a translucent layer in front of a hole lets a share of it through, one behind it takes none of it', () => {
  const hole: Rgba = [1, 1, 1, 0]
  const pane: Rgba = [0, 0, 0, 0.5]
  assert.deepEqual(accumulate(0, [hole, pane]), [0.5, 0.5, 0.5, 0], 'a pane in front')
  assert.deepEqual(accumulate(0, [pane, hole]), [1, 1, 1, 0], 'a pane behind')
})

test('a layer that adds nothing and lets everything through leaves the start as it is', () => {
  close(accumulate(0.4, [[0, 0, 0, 1]]), [0.4, 0.4, 0.4, 1], 'an additive layer')
  close(accumulate(0.4, []), [0.4, 0.4, 0.4, 1], 'none')
})

test('the start copies the lit image’s alpha into the visibility, with a throughput of 1; the application returns it', () => {
  const start = shaderRun<{ holdoutStart: (pixel: number[]) => number[] }>(
    HOLDOUT_START_WGSL,
    ['holdoutStart'],
    { scene: { load: () => [0.2, 0.4, 0.8, 0.7] } },
  )
  assert.deepEqual(start.holdoutStart([3, 4, 0, 0]), [0.7, 0.7, 0.7, 1])
  const apply = shaderRun<{
    holdoutApply: (pixel: number[]) => number[]
    holdoutApplyCovered: (pixel: number[]) => number[]
  }>(HOLDOUT_APPLY_WGSL, ['holdoutApply', 'holdoutApplyCovered'], {
    held: { load: () => [0.6, 0.6, 0.6, 0.5] },
  })
  assert.deepEqual(apply.holdoutApply([3, 4, 0, 0]), [0, 0, 0, 0.6])
  assert.deepEqual(apply.holdoutApplyCovered([3, 4, 0, 0]), [0, 0, 0, 0.6])
})
