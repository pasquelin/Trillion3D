// A displaced surface casts the shadow of its displaced shape (`tessellationShadowsDirectional`, `tessellationShadowsLocal`): a sheet whose
// graph pushes it up and down in ridges, tessellated, throws its shadow on a floor under a sun and under a spot, and
//  (1) the shadow of the relief exists, on the shape the ridges give it: the sheet's far edge, a straight line were it flat, is a wave of the
//      ridges' height along the sun's direction;
//  (2) it is the shadow of the very geometry displaced on the CPU into a dense mesh of static triangles (no tessellation), to the tolerance of the
//      neighbouring shadow proofs (`blend-shadow.gpu.ts`): the images agree block by block, and the tessellated sheet leaves no hole of light;
//  (3) under a spot hanging in the slab the sheet is displaced through, whose near plane cuts the ridges, the shadow has no hole along that plane;
//  (4) two worlds of the same scene draw the same image (A/A).
//
//   node bench/dawn/proofs.ts tests/gpu/vsm/tess-shadow.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../../kit/device/onDawn.ts'
import { compareImages } from '../../../packages/sdk-core/src/runtime/compareImages.ts'
import { pixelLuminance as lum } from './shadowScene.ts'
import { spotShadowedPixels } from './tessShadowScene.ts'

/** A pixel counts as shaded where it is this much darker than the same pixel of the floor alone. */
const SHADED = 20

/** The pixels of `image` darker than `open` by more than `SHADED`. */
function shadedOf(image: Uint8Array, open: Uint8Array) {
  const shaded = new Uint8Array(image.length / 4)
  for (let i = 0; i < shaded.length; i++) shaded[i] = lum(open, i) - lum(image, i) > SHADED ? 1 : 0
  return shaded
}

/** Pixels whose luminance in `a` less its luminance in `b` is one `apart` accepts. */
function countApart(a: Uint8Array, b: Uint8Array, apart: (difference: number) => boolean) {
  let count = 0
  for (let i = 0; i < a.length / 4; i++) if (apart(lum(a, i) - lum(b, i))) count++
  return count
}

/** Pixels where `a` is lighter than `b` by more than `step` luminance steps. */
const apartLighter = (a: Uint8Array, b: Uint8Array, step: number) =>
  countApart(a, b, (d) => d > step)

/** The mean luminance step from `open` down to `image`, over the pixels of `shaded`. */
function meanContrast(open: Uint8Array, image: Uint8Array, shaded: Uint8Array) {
  let sum = 0,
    n = 0
  for (let i = 0; i < shaded.length; i++)
    if (shaded[i]) ((sum += lum(open, i) - lum(image, i)), n++)
  return n ? sum / n : 0
}

const count = (mask: Uint8Array) => mask.reduce((sum, bit) => sum + bit, 0)

/** Pixels where `a` and `b` differ by more than `step` luminance steps. */
const apartBy = (a: Uint8Array, b: Uint8Array, step: number) =>
  countApart(a, b, (d) => Math.abs(d) > step)

test('a tessellated sheet casts the shadow of its displaced shape, the baked sheet’s, under a sun and under a spot', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'tessShadowPage.ts'),
    'tessShadow',
  )) as typeof import('./tessShadowPage.ts')
  const pageErrors: string[] = []
  // `TESS_DUMP=1`: the images of both lights are written as PNGs to `.mesure/chef/tess-png/`, the flat sheet's pair included.
  const dump = !!process.env.TESS_DUMP
  const read = await runOnDawn(page.run, { flats: true }, pageErrors)
  assert.deepEqual([...read.errors, ...pageErrors], [])
  const { width: WIDTH, height: HEIGHT } = read.size
  // The sheet itself is not the proof's concern (its surface is lit by its normals, which the tessellation does not displace): every measure is of
  // the floor outside the sheet's footprint on the image, the sheet seen from straight above at its highest, 1.5 m under a camera 14 m up, with a margin.
  const reach = Math.ceil((2 * 14) / (14 - 1.5) / read.metresPerPixel) + 2
  const outsideSheet = <T extends Record<string, Uint8Array | undefined>>(images: T) => {
    const outside = {} as Record<string, Uint8Array>
    for (const [kind, image] of Object.entries(images)) {
      if (!image) continue
      const kept = Uint8Array.from(image)
      for (let y = 0; y < HEIGHT; y++)
        for (let x = 0; x < WIDTH; x++)
          if (Math.abs(x - WIDTH / 2) <= reach && Math.abs(y - HEIGHT / 2) <= reach)
            kept.fill(0, 4 * (y * WIDTH + x), 4 * (y * WIDTH + x) + 4)
      outside[kind] = kept
    }
    return outside as { [K in keyof T]: Uint8Array }
  }
  if (dump) {
    const { encodePng } = await import('../../../packages/sdk-node/src/image/png.mts')
    const dir = resolve(import.meta.dirname, '../../../.mesure/chef/tess-png')
    mkdirSync(dir, { recursive: true })
    for (const [source, images] of Object.entries(read.images))
      for (const [kind, image] of Object.entries(images))
        writeFileSync(resolve(dir, `${source}-${kind}.png`), encodePng(WIDTH, HEIGHT, image, true))
    // And the images as the proof measures them, the sheet's footprint blanked.
    for (const source of ['sun', 'spot'] as const)
      for (const [kind, image] of Object.entries(outsideSheet(read.images[source])))
        writeFileSync(
          resolve(dir, `${source}-masked-${kind}.png`),
          encodePng(WIDTH, HEIGHT, image, true),
        )
  }
  const pixels = WIDTH * HEIGHT
  // Every measure of both lights is printed before the first assertion, so one run shows them all.
  for (const source of ['sun', 'spot'] as const) {
    const { tess, baked, open, again, again2, tessFlat } = outsideSheet(read.images[source])
    const bakedShaded = shadedOf(baked, open)
    const half = meanContrast(open, baked, bakedShaded) / 2
    let [x0, y0, x1, y1] = [WIDTH, HEIGHT, -1, -1]
    for (let i = 0; i < pixels; i++)
      if (lum(tess, i) !== lum(again, i)) {
        const [x, y] = [i % WIDTH, Math.floor(i / WIDTH)]
        ;[x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)]
      }
    console.log(
      JSON.stringify({
        source,
        shade: count(shadedOf(tess, open)),
        bakedShade: count(bakedShaded),
        apart: apartBy(tess, baked, half),
        flatApart: tessFlat ? apartBy(tessFlat, baked, half) : null,
        apartLighter: apartLighter(tess, baked, half),
        aaPixels: compareImages(tess, again).differentPixels,
        aaPixels2: compareImages(again, again2).differentPixels,
        aaBox: [x0, y0, x1, y1],
        tessellationLoss: read.losses[`tess-${source}`],
        expectedSpot:
          source === 'spot' ? spotShadowedPixels(read.size, read.metresPerPixel, reach) : null,
      }),
    )
  }
  for (const source of ['sun', 'spot'] as const) {
    const { tess, baked, open, again } = outsideSheet(read.images[source])
    const shaded = shadedOf(tess, open),
      bakedShaded = shadedOf(baked, open)
    const [shade, bakedShade] = [count(shaded), count(bakedShaded)]
    console.log(JSON.stringify({ source, shade, bakedShade }))
    // (1) The relief throws a shadow: a share of the image.
    // The sun, from the -x side at 45 degrees, lays the shadow of a point `SHEET.height` (1.2 m) beyond it: the sheet's far edge, 2 m from its middle, lands
    // 3.2 m from the image's, and the footprint blanked reaches `reach` pixels: the strip of shadow left is (3.2 m / metresPerPixel - reach) pixels wide and the
    // sheet's 4 m deep. The ridges (0.3 m either way) move the edge about, not its mean: at least half of the strip is required, a margin for the
    // ridges, the penumbra and the margin of the footprint.
    const strip = ((3.2 / read.metresPerPixel - reach) * 4) / read.metresPerPixel
    // The spot's by the geometry too (`spotShadowedPixels`): the floor pixels outside the footprint, within the spot's outer cone, whose segment to the
    // spot crosses the displaced sheet, counted from the sheet's exact height (`sheetHeightAt`) at the camera's scale. Half of them are required, as the
    // sun's strip: the margin of the penumbra, of the cone's falloff (its edge is too dim to pass `SHADED` against the floor alone) and of the filter. The
    // baked sheet, the right answer, must pass the same bound, or the oracle or the scene is wrong.
    const floorShade =
      0.5 * (source === 'sun' ? strip : spotShadowedPixels(read.size, read.metresPerPixel, reach))
    assert.ok(
      shade > floorShade,
      `${source}: the shadow of the sheet is on the floor: ${shade} pixels, ${floorShade} asked of ${pixels}`,
    )
    if (source === 'spot')
      assert.ok(
        bakedShade > floorShade,
        `${source}: the baked sheet's shadow passes the same bound: ${bakedShade} pixels, ${floorShade} asked`,
      )
    if (source === 'sun') {
      const { tessFlat } = outsideSheet(read.images.sun)
      assert.ok(tessFlat, 'the flat sheet is drawn')
      // (2) The tolerance is the one place the two meshes differ: the micro-triangles reach the sheet's z end (0.3 m, the ridges' amplitude, further than the
      // 8x384 baked mesh, which stops at its last row), a strip of 0.3 m by the sheet's 4 m, in pixels. The edge wave elsewhere agrees to the pixel (measured
      // row by row), the penumbra (the filter's few texels) staying under the luminance step below. Everything is counted at half the contrast between the
      // open floor and the baked shadow: a difference of ambient inside the shadow (a few steps) is not a shape.
      const edge = (0.3 / read.metresPerPixel) * (4 / read.metresPerPixel)
      const contrast = meanContrast(open, baked, bakedShaded)
      const apart = apartBy(tess, baked, contrast / 2),
        flatApart = apartBy(tessFlat, baked, contrast / 2)
      console.log(JSON.stringify({ source, contrast, edge, apart, flatApart }))
      assert.ok(
        Math.abs(shade - bakedShade) <= edge,
        `${source}: the shadow has the baked one's extent to a strip: ${shade} against ${bakedShade}, ${edge} allowed`,
      )
      assert.ok(
        apart <= edge,
        `${source}: ${apart} pixels differ from the baked shadow, ${edge} allowed`,
      )
      // (3) A sheet with no displacement in its shadow fails the same measure: the flat sheet's shadow is straight, the ridges' wave (up to +-0.3 m) apart
      // from it row by row, far more than the strip: it must differ from the baked shadow at least half as much again as the tessellated one does.
      assert.ok(
        flatApart >= 1.5 * apart,
        `${source}: the flat sheet's shadow (${flatApart} pixels apart) is told from the displaced one (${apart})`,
      )
    } else {
      // (2) No hole in the spot's shadow: the micro-triangles the light's near plane cuts (the ridges that rise to it) or a window loses leave the floor lit
      // where the baked sheet shades. The micro-triangles reach further than the baked mesh, never less, so what is lighter than the baked shadow by more than
      // half the contrast is a hole, apart from the penumbra's pixels: two tenths of a percent of the image.
      const holes = apartLighter(tess, baked, meanContrast(open, baked, bakedShaded) / 2)
      console.log(JSON.stringify({ source, holes }))
      assert.ok(
        holes <= 0.002 * pixels,
        `${source}: ${holes} pixels lit where the baked sheet shades`,
      )
    }
    // (4) Nothing was lost: no patch past the queue, the visible list, the windows or the occlusion's buffer, a reading being in for every world.
    for (const kind of ['tess', 'tessFlat'] as const) {
      assert.deepEqual(
        read.losses[`${kind}-${source}`],
        { queue: 0, visible: 0, windows: 0, occluded: 0 },
        `${source} ${kind}: patches lost`,
      )
    }
    // (5) A/A.
    assert.equal(
      compareImages(tess, again).differentPixels,
      0,
      `${source}: two worlds draw the same image`,
    )
  }
  // (1) The sun's shadow edge on the floor, beyond the sheet, is the wave of the ridges: its position along the sun's direction varies from row to row
  // by about the displacement's range, the metre-per-pixel scale of the camera giving the range in pixels.
  const { tess, open } = outsideSheet(read.images.sun)
  const shaded = shadedOf(tess, open)
  let low = Infinity,
    high = -Infinity
  for (let y = 0; y < HEIGHT; y++) {
    let edge = -1
    for (let x = WIDTH - 1; x >= 0; x--)
      if (shaded[y * WIDTH + x]) {
        edge = x
        break
      }
    if (edge >= 0) [low, high] = [Math.min(low, edge), Math.max(high, edge)]
  }
  const range = (high - low) * read.metresPerPixel
  // The 45 degree sun shifts the shadow of a point by its height over the floor: the ridges' range, 0.6 m, appears whole in the edge.
  assert.ok(
    range >= 0.6 * 0.5,
    `the shadow's far edge waves by the ridges: ${range.toFixed(2)} m of a possible 0.6`,
  )
})
