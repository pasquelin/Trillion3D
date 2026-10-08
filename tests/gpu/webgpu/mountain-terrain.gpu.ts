// The generated mountain watershed drawn whole by the WebGPU page raster: its 18 592 triangles all
// selected, the landscape filling the image, the river visible through its valley, the lighting and
// the material strata telling surfaces apart. The scene is the repository's own fixture, compiled
// by the bench runner before the proofs run.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MIB } from '../../../packages/math/src/constants.ts'
import { openGalleryScene } from '../kit/renderHarness.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { settle } from '../world/proofWorld.ts'

/** What the held image shows: pixels off the background, river pixels among them, and how many
 *  colour buckets (4 bits a channel) the visible ones fall in. */
function readLandscape(pixels: Uint8Array) {
  const colors = new Set<number>()
  const background = pixels.slice(0, 3)
  let visible = 0,
    river = 0
  for (let index = 0; index < pixels.length; index += 4) {
    const [red, green, blue] = pixels.subarray(index, index + 3)
    const distance =
      Math.abs(red - background[0]) +
      Math.abs(green - background[1]) +
      Math.abs(blue - background[2])
    if (distance <= 24) continue
    visible++
    colors.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4))
    if (blue > red * 1.3 && blue > green * 1.15) river++
  }
  return { visible, river, colorBuckets: colors.size }
}

test(
  'the mountain watershed is drawn whole, its river and strata visible',
  { timeout: 120_000 },
  async () => {
    const errors: string[] = []
    const reading = await runOnDawn(
      async () => {
        const world = await openGalleryScene({
          id: 'terrain-proof',
          width: 900,
          height: 620,
          pixelRatio: 2,
          folder: 'tests/fixtures/scenes/mountain-terrain',
          texturePoolBytes: 64 * MIB,
          position: [10.5, 8.2, 12.5],
          target: [0, 1.1, 0],
        })
        try {
          const metrics = await settle(world)
          return {
            metrics,
            size: [world.canvas.width, world.canvas.height],
            ...readLandscape(new Uint8Array(await world.capture())),
          }
        } finally {
          world.dispose()
        }
      },
      null,
      errors,
    )
    console.log(JSON.stringify({ ...reading, metrics: undefined }))
    assert.deepEqual(errors, [])
    assert.ok(reading.metrics, 'the image is held')
    assert.equal(reading.metrics.selectedTriangles, 18592)
    assert.deepEqual(reading.size, [1800, 1240])
    assert.ok(reading.visible > 150_000, 'the landscape occupies a meaningful image area')
    assert.ok(reading.river > 8, 'the river remains visible through the mountain valley')
    assert.ok(reading.colorBuckets > 24, 'lighting and material strata remain visually distinct')
  },
)
