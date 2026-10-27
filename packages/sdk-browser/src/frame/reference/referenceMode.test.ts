import test from 'node:test'
import assert from 'node:assert/strict'
import { referenceOptions } from './referenceMode.ts'
import { referenceTilePlan, referenceTilesCapture } from './referenceTiles.ts'
import { resolveSupersampled } from './referenceTilePlacement.ts'
import { REFERENCE_APPROXIMATIONS } from './referenceApproximations.ts'

const BOSS = { manifestUrl: 'm.json', width: 1728, height: 1117, pixelRatio: 2 }
/** A session's captureView: a blank image of the size asked. */
const view = async (width: number, height: number) => new Uint8Array(width * height * 4)

test('outside reference mode, the options are the page’s own, untouched', () => {
  const options = { ...BOSS, renderScale: 'auto' as const }
  assert.deepEqual(referenceOptions(options), { options, reference: null })
})

test('reference mode switches off every approximation it names, whatever the page asked', async () => {
  const asked = { ...BOSS, reference: true, renderScale: 0.5, temporalAntialiasing: true }
  const { options, reference } = referenceOptions(asked)
  assert.deepEqual(reference?.approximations, REFERENCE_APPROXIMATIONS)
  // Nothing sets a probe budget to switch off: the list names the four approximations that remain.
  assert.deepEqual(
    [...REFERENCE_APPROXIMATIONS],
    ['renderScale', 'temporalReuse', 'shadowResolution', 'supersampling'],
  )
  // renderScale: the display itself.
  assert.equal(options.renderScale, 1)
  // temporalReuse: no jitter, no history.
  assert.equal(options.temporalAntialiasing, false)
  // supersampling: tiles, not a canvas the portable side caps at 2 per axis.
  assert.ok(reference?.factor && reference.factor > 2)
  // The canvas keeps the display's pixels: the tiles are drawn aside.
  assert.equal(options.pixelRatio, 2)
  // shadowResolution: a shrunk pool refuses the capture by name.
  const capture = referenceTilesCapture(
    view,
    () => {},
    reference!.tiles,
    () => 1,
  )
  await assert.rejects(capture(), { code: 'REFERENCE_SHADOWS_REDUCED' })
})

test('shadowResolution: refused while shadows draw coarser than asked, read at each capture', async () => {
  // The reference capture is the tiles' (`referenceTilesCapture`), on a plan of 4 × 4 pixels.
  const plan = referenceTilePlan(4, 4, 1)
  /** The reference capture under a frame whose shadows publish `bias`. */
  const under = (bias: number | null | undefined) =>
    referenceTilesCapture(
      view,
      () => {},
      plan,
      () => bias,
    )
  // `shadowResolutionBias` (`vsmStats.ts`): null while no shadow map runs, 0 at the full pool
  // drawing every page at the level asked — both pass, as the image is the reference's.
  for (const bias of [null, undefined, 0])
    await assert.doesNotReject(under(bias)(), `${bias} passes`)
  // A halving of the pool, or a fill bias however small, refuses it by name with the bias read.
  for (const bias of [1, 3, 0.25, 2 ** -126])
    await assert.rejects(under(bias)(), {
      code: 'REFERENCE_SHADOWS_REDUCED',
      details: { shadowResolutionBias: bias },
    })
  // The bias of the frame captured, not of the session's opening: the pool regrown, it passes.
  let bias = 1
  const capture = referenceTilesCapture(
    view,
    () => {},
    plan,
    () => bias,
  )
  await assert.rejects(capture(), { code: 'REFERENCE_SHADOWS_REDUCED' })
  bias = 0
  assert.equal((await capture()).length, 4 * 4 * 4)
})

test('the resolved image is the linear-light mean of each block, the same bytes on every run', () => {
  // A 4 × 2 image: a black and white 2 × 2 block, then a flat grey one.
  const rgba = new Uint8Array(4 * 2 * 4)
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 4; x++) {
      const v = x < 2 ? ((x + y) % 2) * 255 : 128
      rgba.set([v, v, v, 255], (y * 4 + x) * 4)
    }
  const once = resolveSupersampled(rgba, 4, 2, 2)
  // Half the light of white, re-encoded: 188, not the 128 of a mean of the bytes.
  assert.deepEqual([...once], [188, 188, 188, 255, 128, 128, 128, 255])
  assert.deepEqual(resolveSupersampled(rgba, 4, 2, 2), once)
})

test('reference mode refuses an interactive session, whose resize would drop the supersampling', () => {
  assert.throws(() => referenceOptions({ ...BOSS, reference: true, interactive: true }), {
    code: 'REFERENCE_INTERACTIVE',
  })
})
