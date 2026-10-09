// A closed room under a white background (`veilPage.ts`): nothing the glossy floor reflects exceeds
// the room's largest radiance — the background is the environment's last word, never added to what
// the screen, the proxy or the probes answer —, and the reflection changes by no more than the
// room's shades from a pixel to its neighbour along a pan: no rectangle, no column of a veil.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/veil.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { ROOM_MAXIMUM } from './roomFrame.ts'

/** The change between neighbouring pixels the room's shades allow: its faces differ by 0.04, a
 *  floor lobe's weight is under one. */
const STEP = 0.06

test('a closed room reflects no veil of its white background along a pan', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'veilPage.ts'),
    'reflectionVeil',
  )) as typeof import('./veilPage.ts')
  const result = await runOnDawn(page.run, [-20, -8, 0, 8, 20])
  assert.equal(result.error, undefined, result.error)
  assert.deepEqual(result.errors, [])
  console.log(JSON.stringify(result.poses))
  for (const { yaw, maximum, step, pixels } of result.poses!) {
    assert.ok(pixels > 2000, `yaw ${yaw}: ${pixels} floor pixels`)
    assert.ok(
      maximum <= ROOM_MAXIMUM * 1.01,
      `yaw ${yaw}: reflects ${maximum} in a room of ${ROOM_MAXIMUM}`,
    )
    assert.ok(step <= STEP, `yaw ${yaw}: neighbouring pixels differ by ${step}`)
  }
})
