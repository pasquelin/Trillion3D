// With no `backends` option the engine reads the machine and chooses (#274): where a WebGPU device
// exists, the WebGPU page raster, alone, sampling the cache's own textures — and it draws. Proved on
// the repository's kinetic garden, and on a bench cache that carries a `clustered-blend` primitive
// and so no prepared autonomous scene (#297, the public `alpha-blend-mode-test`), which the same
// default opens and draws. The machine without WebGPU draws on WebGL2, which the proofs do not run.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import type { SceneLight } from '../../../packages/sdk-core/src/index.ts'
import { manifestUrlOf } from '../../kit/scenes/caches.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { benchManifest, defaultBackendImage, drawnPixels } from '../world/proofWorld.ts'

const ROOT = resolve(import.meta.dirname, '../../..')

/** The default world of `manifestUrl` on Dawn, lit by `lights`: what the engine chose, and the
 *  pixels its image draws, with the errors nothing caught. */
async function defaultOnDawn(manifestUrl: string, lights: SceneLight[] = []) {
  const errors: string[] = []
  const read = await runOnDawn(() => defaultBackendImage(manifestUrl, lights), null, errors)
  const { pixels, ...chosen } = read
  const drawn = drawnPixels(pixels)
  console.log(JSON.stringify({ ...chosen, drawn, pixels: pixels.length / 4 }))
  assert.deepEqual(errors, [])
  assert.equal(chosen.backend, 'webgpu-page-raster')
  assert.deepEqual(chosen.mounted, ['webgpu-page-raster'], 'no witness is mounted beside it')
  assert.ok(chosen.held, 'the image is held')
  // The canvas is not empty: a twentieth of it at least differs from the cleared background.
  assert.ok(drawn > pixels.length / 4 / 20, `${drawn} of ${pixels.length / 4} pixels drawn`)
  return chosen
}

test(
  'a WebGPU machine opens the page raster by default, on the cache textures',
  { timeout: 120_000 },
  async () => {
    const garden = manifestUrlOf('tests/fixtures/scenes/kinetic-garden').slice(1)
    const chosen = await defaultOnDawn(pathToFileURL(resolve(ROOT, garden)).href)
    assert.equal(chosen.choice?.origin, 'default')
    assert.equal(chosen.choice?.webgpuDevice, true)
    assert.equal(chosen.choice?.textureSource, 'cache')
  },
)

// The cache declares no light table: an image taken without one would be black on any backend and
// prove nothing, so the bench sun lights it, the same for any model.
test(
  'a cache with a clustered-blend primitive opens and draws by default',
  { timeout: 120_000 },
  async () => {
    const chosen = await defaultOnDawn(benchManifest('alpha-blend-mode-test'), [SUN])
    assert.equal(chosen.choice?.origin, 'default')
  },
)
