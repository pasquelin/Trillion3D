// A transmissive scene copy composes over the engine's own WebGL2 cluster image, in Chrome: the
// opaque and blended clusters behind it show through at the Fresnel the glass lets pass, a cluster
// in front hides it, its volume attenuates and a declared light reflects on it; the backdrop is
// taken once, follows a sub-viewport and is skipped for a glass out of view; and a physical
// feature WebGL2 cannot draw leaves the glass drawn without it, said once by name.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { inChrome } from '../kit/onChrome.ts'
import type { execute } from './transmissionCopiesPage.ts'

const PAGE = resolve(import.meta.dirname, 'transmissionCopiesPage.ts')

/** Whether `actual` lies within `tolerance` levels of `expected` on every channel. */
const near = (actual: number[], expected: number[], tolerance = 3) =>
  actual.every((channel, i) => Math.abs(channel - expected[i]) <= tolerance)

test(
  'a transmissive copy composes over the WebGL2 cluster image',
  { timeout: 120_000 },
  async () => {
    const result = await inChrome<Awaited<ReturnType<typeof execute>>>(PAGE, 'execute')
    console.log(JSON.stringify(result))
    assert.equal(result.withoutGlass, 1)
    assert.deepEqual(
      result.submissions,
      { clusters: 1, backdrop: 1, copies: 1 },
      'the batch to the display, the batch into the backdrop, the glass',
    )
    assert.deepEqual(result.opaquePixel, [255, 0, 0, 255])
    // Normal incidence on IOR 1.5: Fresnel 0.04, so 96 % of the red cluster comes through.
    assert.ok(near(result.throughGlass, [245, 0, 0, 255]), JSON.stringify(result.throughGlass))
    assert.ok(near(result.encoded, [250, 0, 0, 255]), JSON.stringify(result.encoded))
    assert.equal(result.restored.framebuffer, null, 'the frame target is bound again')
    assert.deepEqual(result.restored.viewport, [0, 0, 32, 32])
    assert.equal(result.restored.backdropBytes, 32 * 32 * 12)
    assert.ok(near(result.backgroundThrough, [0, 0, 245, 255]), `${result.backgroundThrough}`)
    assert.deepEqual(result.occluded, [255, 255, 0, 255], 'a cluster in front hides the glass')
    assert.ok(near(result.blendedThrough, [122, 0, 122, 255], 4), `${result.blendedThrough}`)
    // Linear attenuation colour 0.5 over one unit of thickness halves what comes through.
    assert.ok(near(result.attenuated, [122, 0, 0, 255], 4), `${result.attenuated}`)
    assert.ok(
      result.lit[1] > 0 && result.lit[1] < 255 && result.lit[1] === result.lit[2],
      `the declared light reflects a white specular lobe on the glass: ${result.lit}`,
    )
    assert.ok(near(result.subViewport.inside, [245, 0, 0, 255]), JSON.stringify(result.subViewport))
    assert.deepEqual(result.subViewport.outside, [0, 0, 255, 255])
    assert.deepEqual(result.offscreen, {
      clusters: 1,
      backdrop: 0,
      copies: 0,
      pixel: [255, 0, 0, 255],
    })
    // A clearcoat glass is drawn: a refusal would be the page's error.
    assert.ok(
      near(result.coatedPixel, [245, 0, 0, 255]),
      `drawn without clearcoat: ${result.coatedPixel}`,
    )
    assert.deepEqual(
      result.coatedNotice,
      [{ kind: 'material-degraded', context: { material: 'coated glass', feature: 'clearcoat' } }],
      'said once over two frames, by name',
    )
    assert.equal(result.drawError, 0)
  },
)
