import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../../materials/texture/shaderRunMatrix.fixture.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { patchSightWgsl, SIGHT_GONE, SIGHT_HIDDEN } from '../../tessellation/sightWgsl.ts'
import { OCCLUSION_MAIN, OCCLUSION_NONE, OCCLUSION_POST } from '../../tessellation/contract.ts'

/** What `patchSight` answers for a box the view sees. */
const SIGHT_SEEN = 1

// The patches of a displaced surface are judged by the view as the cut judges a box
// (`patchSight`, `../../tessellation/sightWgsl.ts`): the frustum, the clip plane, the pixel centres its
// rectangle covers, then the pyramid — the previous image's in the main pass, which only hides, this
// image's in the post pass, which drops.
test('a patch is gone from the image, seen, or hidden by the pyramid of the pass that judges it', () => {
  const [f, aspect, near] = [1.7, 2, 0.1]
  // A reversed infinite perspective, the eye at the origin looking down −z.
  const viewProj = new Mat([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near, 0])
  const uni = {
    viewProj,
    viewport: [64, 32],
    perspective: 1,
    clipRoute: 0,
    clipPlane: [0, 0, 0, 0],
  }
  const hizLevels = {
    count: [3, 0, 0, 0],
    level: [
      [0, 64, 32, 0],
      [0, 32, 16, 0],
      [0, 16, 8, 0],
    ],
  }
  const tu = {
    occlusion: OCCLUSION_NONE,
    depthMap: [near, 0],
    prevDepthMap: [near, 0],
    prevSize: [64, 32],
    prevViewProj: viewProj,
  }
  // The pyramid's farthest depth, everywhere: reversed, a box shows when its nearest is at least it.
  let farthest = 0
  const { patchSight } = shaderRun<{ patchSight(box: object, world: Mat): number }>(
    wgslBlock('patchSight', [patchSightWgsl(true)], ''),
    ['patchSight'],
    {
      ...{ uni, tu, hizLevels, FINITE_SENTINEL: 3.4e38 },
      hizCullFarthest: () => farthest,
      hizMip: (level: number) => [0, hizLevels.level[level]![1]],
    },
  )
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const at = (z: number, half = 0.5, x = 0) => ({
    lo: [x - half, -half, z - half],
    hi: [x + half, half, z + half],
  })
  // Gone: behind the eye, off to the side, covering no pixel centre.
  assert.deepEqual(
    [at(5), at(-5, 0.5, 40), at(-50, 1e-4)].map((box) => patchSight(box, identity)),
    [SIGHT_GONE, SIGHT_GONE, SIGHT_GONE],
  )
  assert.equal(patchSight(at(-5), identity), SIGHT_SEEN, 'in view, no pyramid asked')
  // The view's clip plane: a box wholly behind it is gone while the cut culls by it, one across it is not.
  Object.assign(uni, { clipRoute: 1, clipPlane: [0, 0, 1, 5.5] })
  assert.equal(patchSight(at(-3), identity), SIGHT_SEEN, 'in front of z = −5.5')
  assert.equal(patchSight(at(-5.2), identity), SIGHT_SEEN, 'across it')
  assert.equal(patchSight(at(-8), identity), SIGHT_GONE, 'behind it')
  uni.clipRoute = 0
  assert.equal(patchSight(at(-8), identity), SIGHT_SEEN, 'the cull off')
  // Under the pyramid of the post pass, then of the main pass: hidden where it hides, shown where it
  // does not — and a box that reaches the near plane is never hidden.
  for (const mode of [OCCLUSION_POST, OCCLUSION_MAIN]) {
    tu.occlusion = mode
    farthest = 10
    assert.equal(patchSight(at(-5), identity), SIGHT_HIDDEN, `hidden, mode ${mode}`)
    assert.equal(
      patchSight(at(-0.55, 0.5), identity),
      SIGHT_SEEN,
      `across the near plane, mode ${mode}`,
    )
    farthest = 0
    assert.equal(patchSight(at(-5), identity), SIGHT_SEEN, `shown, mode ${mode}`)
  }
  // The main pass tests the previous image's matrix: a previous view that saw the box off screen
  // hides nothing of it.
  tu.occlusion = OCCLUSION_MAIN
  farthest = 10
  tu.prevViewProj = new Mat([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, 1, 0, 0, near, 0])
  assert.equal(patchSight(at(-5), identity), SIGHT_SEEN, 'behind the eye of the previous image')
})
