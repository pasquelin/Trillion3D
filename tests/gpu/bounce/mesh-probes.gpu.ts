// The screen probes trace the meshes' own distance fields (`meshStage.ts`, `traceMeshWgsl.ts`): their rays the screen leaves are put in a list of the rays the meshes are traced for (the first
// compaction), traced through the fields of the meshes the view's grid holds, and the scene stage takes the rest. Proved on a scene of a ground and a block over it
// (`meshProbesScene.ts`), compiled with the native compiler, lit by the sun and held at a pose that sees the ground under the block, in five worlds:
//   0. the meshes' fields built, the probes tracing them;      1. the same, the probes not tracing them;
//   2. the same world as 1 again — the witness of how much two identical worlds differ (the probes' noise follows the frames drawn before the view is held);
//   3, 4. the scene built with no distance field for its meshes, with the setting on and off.
// Asserted: no error of the devices, every world held; the first compaction listed rays in world 0 and none in the others (so the stage traced, and only where it should); no pixel that
// world 1 lights is black in world 0 (a ray lost, an unwritten texel, a NaN, would be); the probes' light differs between 0 and 1 by more than 2 and 1 differ, on the pixels the block
// occults, and not toward more light (the global field is coarse near a surface, so a ray passes the block it cannot see; the meshes' fields see it); worlds 3 and 4 give the same image,
// to the witness's own difference. The thresholds are not tuned to a measurement: each is stated where it is used.
//
//   node bench/dawn/proofs.ts tests/gpu/bounce/mesh-probes.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../../kit/device/onDawn.ts'
import type { MeshProbesCase, MeshProbesReading } from './meshProbesPage.ts'

/** The worlds, in the order the header numbers them. */
const WORLDS: MeshProbesCase[] = [
  { fields: true, trace: true },
  { fields: true, trace: false },
  { fields: true, trace: false },
  { fields: false, trace: true },
  { fields: false, trace: false },
]

/** The luminance, in the levels of the capture, of the pixel at byte `i`. */
const luminance = (p: readonly number[], i: number) =>
  0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]

/** Two images differ at a pixel by more than `STEP` levels in some channel: two renderings round to the nearest level each, so a difference of one or two levels is one rounding or two. */
const STEP = 2

/** How two images differ: the pixels that differ by more than `STEP`, and the mean luminance change over them (`b` against `a`). */
function compare(a: readonly number[], b: readonly number[]) {
  let differing = 0,
    change = 0
  for (let i = 0; i < a.length; i += 4) {
    if (![0, 1, 2].some((c) => Math.abs(a[i + c] - b[i + c]) > STEP)) continue
    differing++
    change += luminance(b, i) - luminance(a, i)
  }
  return { differing, change: differing ? change / differing : 0 }
}

/** The pixels a world lights: `LIT` levels of luminance, a quarter of the scale, is a surface the sun or the sky plainly lights. A pixel there that world 0 draws under `HOLE`, an eighth of that, has lost
 *  the light of a surface the meshes cannot darken to that degree (they change the indirect light only): a hole, which a ray lost, an unwritten texel or a NaN makes. */
const LIT = 64,
  HOLE = 8

test('the screen probes trace the meshes’ distance fields: the first compaction lists rays, the image has no hole, the light under the block changes and without fields nothing does', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'meshProbesPage.ts'),
    'bounceMeshProbes',
  )) as typeof import('./meshProbesPage.ts')
  const errors: string[] = []
  const readings: MeshProbesReading[] = await runOnDawn(page.run, WORLDS, errors)
  assert.deepEqual(errors, [])
  const [traced, plain, again, fieldless, fieldlessOff] = readings
  readings.forEach((reading, k) => {
    assert.deepEqual(reading.errors, [], `world ${k}: the devices raised errors`)
    assert.ok(reading.held, `world ${k}: the view is held`)
    assert.equal(reading.missing, undefined, `world ${k}: ${reading.missing}`)
  })

  // The first compaction listed rays where the stage runs, a part of the rays the screen left, and none where it does not.
  console.log(JSON.stringify(readings.map(({ sceneRays, meshRays }) => ({ sceneRays, meshRays }))))
  assert.ok(traced.meshRays > 0, `world 0: ${traced.meshRays} rays listed for the meshes`)
  assert.ok(
    traced.meshRays <= traced.sceneRays,
    `world 0: ${traced.meshRays} of ${traced.sceneRays} rays`,
  )
  for (const [k, reading] of [plain, again, fieldless, fieldlessOff].entries())
    assert.equal(reading.meshRays, 0, `world ${k + 1}: the meshes are not traced`)

  // No hole.
  let holes = 0
  for (let i = 0; i < plain.pixels.length; i += 4)
    if (luminance(plain.pixels, i) >= LIT && luminance(traced.pixels, i) < HOLE) holes++
  assert.equal(holes, 0, `${holes} pixels that world 1 lights are dark in world 0`)

  // The light changes where the block is near, and not toward more light. The witness is how much two identical worlds differ; a change must exceed it by `TILE` pixels, a
  // probe's tile being 16 pixels across: the least a probe's change shows over.
  const TILE = 16
  const witness = compare(plain.pixels, again.pixels)
  const meshes = compare(plain.pixels, traced.pixels)
  console.log(JSON.stringify({ witness, meshes }))
  assert.ok(
    meshes.differing >= witness.differing + TILE,
    `${meshes.differing} pixels differ with the meshes traced, ${witness.differing} between two identical worlds`,
  )
  // A mean change of half a level or more toward more light is not an occluder the meshes see and the global field misses.
  assert.ok(meshes.change <= 0.5, `the light changes by ${meshes.change} levels on average`)

  // Without fields the setting changes nothing, to the witness's own difference.
  const fieldlessChange = compare(fieldlessOff.pixels, fieldless.pixels)
  assert.ok(
    fieldlessChange.differing <= witness.differing,
    `${fieldlessChange.differing} pixels differ with the setting where the meshes have no field, ${witness.differing} between two identical worlds`,
  )
})
