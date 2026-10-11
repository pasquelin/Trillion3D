// A surface draws its normal map from a frame it has no tangent for as it does from the authored
// tangents. A geometry page stores no tangent: a paged transparent rebuilds its frame from screen
// derivatives (`webgpu/blend/shaderSurface.ts`), a paged opaque one from its triangle's texture
// coordinates (`visibility/shader/shadeWgsl.ts`). The compiler keeps a primitive outside the pages
// for one property alone, a transmission (`unsplit_material`): such a primitive is drawn from its
// source buffers and reads the authored tangents (`webgpu/blend/prepare.ts`), or, with none in the
// source, rebuilds its frame as a page does. The scenes are the public `normal-tangent-mirror-test`,
// whose tangents are mirrored on half its texture, blended and opaque, paged, unpaged and unpaged
// without tangents (`bench/runner/scenes/tangentScenes.ts`, which prints how to compile them).
//
// - Blended pair, `unpaged` against `frame`: one pass, one shader, the tangent source the only
//   difference. The rebuilt frame is a derivative one and the authored one is per vertex, so the
//   images differ at a few seams, by a few levels; a handedness of the mirrored half taken wrong
//   moves tens of levels over that whole half. The bound is a hundredth of the drawn pixels and a
//   sixteenth of the range.
// - `paged` against the others: recorded, not asserted. A paged blend is drawn in the blend pass,
//   an unpaged one composed in the transmission pass over the frozen background, and a paged opaque
//   one is resolved from the visibility buffer: the difference is not the tangents' alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pixelDifference } from '../../../bench/dawn/capture.ts'
import { readCacheManifest } from '../../../bench/runner/assets/cacheManifest.ts'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import { sceneDerived } from '../../../bench/runner/assets/scene.ts'
import { TANGENT_SCENES } from '../../../bench/runner/scenes/tangentScenes.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { benchManifest, defaultWorldImage, drawnPixels } from '../world/proofWorld.ts'

/** The bench sun, casting no shadow: the traced shadow read is seeded by the frame number, so an
 *  image held at another frame differs on every shadow edge — the pair would measure how many
 *  frames each image took to settle, not its tangents. */
const LIGHT = { ...SUN, castsShadow: false }

/** The default world of a tangent scene under `LIGHT`: its image, checked drawn. */
async function tangentImage(key: string, scene: string) {
  const errors: string[] = []
  const read = await runOnDawn(() => defaultWorldImage(benchManifest(scene), [LIGHT]), null, errors)
  assert.deepEqual(errors, [], key)
  assert.ok(read.held, `${key}: the image is held`)
  const drawn = drawnPixels(read.pixels)
  assert.ok(drawn > read.pixels.length / 4 / 20, `${key}: ${drawn} pixels drawn`)
  return read.pixels
}

test('each tangent scene is compiled to the pass its pair compares', async () => {
  for (const { scene, pass } of TANGENT_SCENES) {
    const { manifest } = await readCacheManifest(join(sceneDerived(scene), 'native/full'))
    assert.ok(manifest.primitives.length > 0, `${scene} compiled no primitive`)
    assert.deepEqual(
      manifest.primitives.map((primitive) => primitive.pass),
      manifest.primitives.map(() => pass),
      `${scene} compiled to ${pass}`,
    )
  }
})

test(
  'authored tangents and a rebuilt frame draw the same normal map',
  { timeout: 300_000 },
  async () => {
    // Interleaved, twice each: the A/A of a scene says what the harness itself moves.
    const images = new Map<string, Uint8Array>()
    for (const run of [1, 2])
      for (const { key, scene } of TANGENT_SCENES)
        images.set(`${key}-${run}`, await tangentImage(key, scene))
    const delta = (a: string, b: string) => pixelDifference(images.get(a)!, images.get(b)!)
    const deltas = Object.fromEntries([
      ...TANGENT_SCENES.map(({ key }) => [`${key} A/A`, delta(`${key}-1`, `${key}-2`)]),
      ...['blend', 'opaque'].flatMap((surface) => [
        [`${surface} unpaged vs frame`, delta(`${surface}-unpaged-1`, `${surface}-frame-1`)],
        [`${surface} paged vs unpaged`, delta(`${surface}-paged-1`, `${surface}-unpaged-1`)],
        [`${surface} paged vs frame`, delta(`${surface}-paged-1`, `${surface}-frame-1`)],
      ]),
    ])
    console.log(JSON.stringify(deltas))
    for (const { key } of TANGENT_SCENES) assert.equal(deltas[`${key} A/A`].pixels, 0, `${key} A/A`)
    const pixels = images.get('blend-unpaged-1')!.length / 4
    const tangents = deltas['blend unpaged vs frame']
    assert.ok(
      tangents.pixels <= pixels / 100 && tangents.largest <= 16,
      `blend unpaged vs frame: ${JSON.stringify(tangents)} of ${pixels} pixels`,
    )
  },
)
