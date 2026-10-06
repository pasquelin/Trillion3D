// With no `backends` option, a machine without WebGPU draws on the engine's own WebGL2 path, alone
// (#274), in Chrome: on a cache that carries a prepared autonomous scene, `autonomous-pages-webgl`
// draws it, every selected triangle submitted; on a cache whose blended primitive leaves no prepared
// autonomous scene (#297), the same path reads the source's materials and placements and draws too.
// Both sample the host's images. The WebGPU machine's choice is proved on Dawn
// (`default-backend.gpu.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { rmSync } from 'node:fs'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import { measureOutput } from '../../../bench/core/paths.ts'
import { compileFullCache } from '../../../scripts/native-compiler.ts'
import type { SceneLight } from '../../../packages/sdk-core/src/index.ts'
import { manifestUrlOf } from '../../kit/scenes/caches.ts'
import { inChrome, type ChromePage } from '../kit/onChrome.ts'
import type { execute } from './defaultWithoutWebgpuPage.ts'

const ROOT = resolve(import.meta.dirname, '../../..')
const PAGE = resolve(import.meta.dirname, 'defaultWithoutWebgpuPage.ts')
/** A concrete floor under an alpha-blended glass pane: its glass compiles to a blended primitive. */
const BLENDED = 'tests/fixtures/formats/coplanar/blend-overlay'

/** The default world of `manifestUrl` on a page without `navigator.gpu`, lit by `lights`. */
async function withoutWebgpu(manifestUrl: string, lights: SceneLight[], page: ChromePage = {}) {
  const read = await inChrome<Awaited<ReturnType<typeof execute>>>(
    PAGE,
    'execute',
    { manifestUrl, lights },
    { ...page, webgpu: false },
  )
  console.log(JSON.stringify(read))
  assert.equal(read.webgpu, false, 'the page offers no WebGPU')
  assert.equal(read.backend, 'autonomous-pages-webgl')
  assert.deepEqual(read.mounted, ['autonomous-pages-webgl'], 'no witness is mounted beside it')
  // The canvas is not empty: a twentieth of it at least differs from the cleared background.
  assert.ok(read.drawn > read.pixels / 20, `${read.drawn} of ${read.pixels} pixels drawn`)
  return read
}

test(
  'a machine without WebGPU draws a prepared scene on the WebGL2 path',
  { timeout: 180_000 },
  async () => {
    const read = await withoutWebgpu(manifestUrlOf('tests/fixtures/scenes/kinetic-garden'), [])
    assert.deepEqual(read.choice, {
      kind: 'configuration',
      scope: 'full',
      origin: 'default',
      reason: 'no WebGPU device; the cache carries a prepared autonomous scene',
      renderer: 'autonomous-pages-webgl',
      autonomous: true,
      webgpuDevice: false,
      // This path samples the host images, so the loader opens them whatever the option says.
      textureSource: 'host',
    })
    assert.equal(read.submittedTriangles, read.selectedTriangles, 'the cut it drew has no hole')
  },
)

// The cache declares no light table: an image taken without one would be black on any backend and
// prove nothing, so the bench sun lights it, the same for any model.
test(
  'a cache with a blended primitive draws on the WebGL2 path from its source',
  { timeout: 180_000 },
  async () => {
    const out = measureOutput('chrome-proofs', 'default-without-webgpu')
    rmSync(out, { recursive: true, force: true })
    compileFullCache({
      cwd: ROOT,
      source: resolve(ROOT, BLENDED),
      cache: join(out, 'cache'),
      resourceBase: `/${BLENDED}/`,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    try {
      const mounts = [{ prefix: '/blended-cache/', dir: join(out, 'cache/native') }]
      const read = await withoutWebgpu('/blended-cache/full/manifest.json', [SUN], { mounts })
      assert.deepEqual(read.choice, {
        kind: 'configuration',
        scope: 'full',
        origin: 'default',
        reason:
          'no WebGPU device and no prepared autonomous scene; the same path reads source.gltf',
        renderer: 'autonomous-pages-webgl',
        autonomous: false,
        webgpuDevice: false,
        textureSource: 'host',
      })
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  },
)
