// A closed room under a white background (`veilPage.ts`): nothing the glossy floor reflects exceeds
// the room's largest radiance — the background is the environment's last word, never added to what
// the screen, the proxy or the probes answer —, and the reflection changes by no more than the
// room's shades from a pixel to its neighbour along a pan: no rectangle, no column of a veil. And
// a near mirror whose every ray leaves the screen shows the room's proxy, a dark far wall's colour,
// not the background's.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/veil.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { ROOM_MAXIMUM } from './roomFrame.ts'
import type { VeilCase } from './veilPage.ts'

/** The change between neighbouring pixels the room's shades allow: its faces differ by 0.04, a
 *  floor lobe's weight is under one. */
const STEP = 0.06

/** A dark far wall, and the colour a mirror of it must show (its metal's weight is under one). */
const DARK = 0.05

const PAN: VeilCase[] = [-20, -8, 0, 8, 20].map((yaw) => ({ yaw, drop: 2.5, rough: 0.6 }))
/** The view 30° down (ten ahead, 5.77 below): a reflected ray rises, the image ends at 5° below the
 *  horizon, so no ray of a mirror meets the screen. */
const STEEP: VeilCase[] = [-8, 0, 8].map((yaw) => ({
  yaw,
  drop: 5.77,
  rough: 0.02,
  far: [DARK, DARK, DARK],
}))

test('a closed room reflects no veil of its white background along a pan', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'veilPage.ts'),
    'reflectionVeil',
  )) as typeof import('./veilPage.ts')
  const result = await runOnDawn(page.run, [...PAN, ...STEEP])
  assert.equal(result.error, undefined, result.error)
  assert.deepEqual(result.errors, [])
  console.log(JSON.stringify(result.poses))
  const poses = result.poses!
  poses.forEach(({ maximum, step, pixels }, k) => {
    const name = `view ${k}`
    assert.ok(pixels > 2000, `${name}: ${pixels} floor pixels`)
    assert.ok(
      maximum <= ROOM_MAXIMUM * 1.01,
      `${name}: reflects ${maximum} in a room of ${ROOM_MAXIMUM}`,
    )
    if (k < PAN.length) assert.ok(step <= STEP, `${name}: neighbouring pixels differ by ${step}`)
  })
  // The near mirror shows the far wall's dark colour where its ray reaches it: the proxy's, whole.
  for (const { minimum } of poses.slice(PAN.length))
    assert.ok(
      minimum >= DARK * 0.9 && minimum <= DARK * 1.1,
      `a mirror shows ${minimum} of a wall of ${DARK}`,
    )
})
