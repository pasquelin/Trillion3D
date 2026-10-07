// With no `engine` option the session runs its own engine and opens on the cache's own
// textures (#274) — and it draws. Proved on the repository's kinetic garden, and on a bench cache
// that carries a `clustered-blend` primitive (#297, the public `alpha-blend-mode-test`), which the
// same default opens and draws. A machine without WebGPU is refused by name
// (`no-webgpu.chrome.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import type { SceneLight } from '../../../packages/sdk-core/src/index.ts'
import { manifestUrlOf } from '../../kit/scenes/caches.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { benchManifest, defaultWorldImage, drawnPixels } from './proofWorld.ts'

const ROOT = resolve(import.meta.dirname, '../../..')

/** The default world of `manifestUrl` on Dawn, lit by `lights`: the texture source it opened
 *  with, and the pixels its image draws, with the errors nothing caught. */
async function defaultOnDawn(manifestUrl: string, lights: SceneLight[] = []) {
  const errors: string[] = []
  const read = await runOnDawn(() => defaultWorldImage(manifestUrl, lights), null, errors)
  const { pixels, ...opened } = read
  const drawn = drawnPixels(pixels)
  console.log(JSON.stringify({ ...opened, drawn, pixels: pixels.length / 4 }))
  assert.deepEqual(errors, [])
  assert.ok(opened.held, 'the image is held')
  // The canvas is not empty: a twentieth of it at least differs from the cleared background.
  assert.ok(drawn > pixels.length / 4 / 20, `${drawn} of ${pixels.length / 4} pixels drawn`)
  return opened
}

test(
  'a WebGPU machine opens the default world on the cache textures, and draws',
  { timeout: 120_000 },
  async () => {
    const garden = manifestUrlOf('tests/fixtures/scenes/kinetic-garden').slice(1)
    const opened = await defaultOnDawn(pathToFileURL(resolve(ROOT, garden)).href)
    assert.equal(opened.textureSource, 'cache')
  },
)

// The cache declares no light table: an image taken without one would be black and prove nothing,
// so the bench sun lights it, the same for any model.
test(
  'a cache with a clustered-blend primitive opens and draws by default',
  { timeout: 120_000 },
  () => defaultOnDawn(benchManifest('alpha-blend-mode-test'), [SUN]).then(() => undefined),
)
