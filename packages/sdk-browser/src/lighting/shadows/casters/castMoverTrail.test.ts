// A caster that moves and stops leaves no stale page behind (`castDiff.ts`, `castDiffWgsl.ts` run in JavaScript): at each move the box it leaves and the one it enters are named, in the layer
// each is cached in, and at its stop the last pose it quitted is named as well as the one it stands on, in the static layer that now draws it. The reference invalidates a moved instance by its
// previous and its new bounds (`VirtualShadowMapCacheManager.cpp`, `FInvalidatingPrimitiveCollector::AddInvalidation` and `ProcessInvalidations`, which read the instance's previous and current transforms).
import test from 'node:test'
import assert from 'node:assert/strict'
import { MOBILITY_MOVING } from '../mobilityBits.ts'
import { A, B, diffKernel } from './castDiffKernel.fixture.ts'

const C = [8, 0, 0, 10, 2, 2],
  D = [12, 0, 0, 14, 2, 2]
/** Whether box `outer` holds box `inner` whole. */
const holds = (outer: number[], inner: number[]) =>
  [0, 1, 2].every((a) => outer[a]! <= inner[a]! && outer[3 + a]! >= inner[3 + a]!)

test('a caster that moves pose after pose and stops: both boxes at every move, nothing at rest, the poses quitted and the one it stands on at the stop', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A)
  kernel.step(true)
  const poses = [B, C, D]
  let quitted = A
  for (const pose of poses) {
    kernel.place(0, pose, MOBILITY_MOVING)
    const { records } = kernel.step()
    // The first move leaves the static layer where it stood; the later ones leave the dynamic layer they were drawn in.
    assert.deepEqual(
      records,
      [
        { box: quitted, moving: quitted !== A },
        { box: pose, moving: true },
      ],
      'the pose it quits and the one it enters',
    )
    quitted = pose
  }
  for (let rest = 0; rest < 3; rest++) {
    kernel.place(0, D, MOBILITY_MOVING)
    assert.deepEqual(kernel.step().records, [], 'it has not moved: no page is staled')
  }
  // It settles: the static layer draws it again where it stands, and over every place it passed.
  kernel.place(0, D, 0)
  const { records } = kernel.step()
  assert.deepEqual(records[0], { box: D, moving: false }, 'where it stands')
  assert.equal(records.length, 2)
  const swept = records[1]!.box
  assert.equal(records[1]!.moving, false)
  for (const pose of [B, C, D])
    assert.ok(holds(swept, pose), `the pose ${pose} is under the swept boxes`)
  assert.deepEqual(kernel.step().records, [], 'once')
})
