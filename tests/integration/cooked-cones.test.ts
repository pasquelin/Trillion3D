// The WebGPU cut rejects a page by the cone the compiler cooked (`normal_cone.rs`), so the cone
// must bound the faces the GPU draws: those of the page's geometry page, its local indices over its
// quantized positions as the codec's one reader decodes them (`decodeGeometryPage`), not the
// source's. On every compiled scene, each page's cone is required to hold every face of its decoded
// page, by this runtime's arccosine and with no margin beyond the compiler's, and to be at most
// twice that margin wider than the reference cone of the same faces.
import test from 'node:test'
import assert from 'node:assert/strict'
import { openSync, readSync, closeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readCacheManifest } from '../../bench/runner/assets/cacheManifest.ts'
import { coneHolds } from '../kit/reference/cone.ts'
import '../../packages/sdk-browser/src/wasm/sdkWasm.fixture.ts'
import { decodeGeometryPage } from '../../packages/sdk-browser/src/page/codec/geometryPage.ts'
import { sceneCacheFiles } from '../kit/scenes/caches.ts'
import { REPOSITORY_ROOT } from '../../scripts/repository-files.ts'

/** The `bytes` of the geometry page at `url`, `<container>#<offset>` (`geometryPageAddress`),
 *  under `dir`. */
function pageBytes(dir: string, url: string, bytes: number) {
  const [file, offset] = url.split('#')
  const out = new Uint8Array(bytes)
  const fd = openSync(join(dir, file), 'r')
  try {
    readSync(fd, out, 0, bytes, Number(offset))
  } finally {
    closeSync(fd)
  }
  return out
}

/** Every page of the scene cache whose pointer is `pointer`, and those whose cone misses a face. */
async function checkScene(pointer: string) {
  const { dir, manifest } = await readCacheManifest(dirname(join(REPOSITORY_ROOT, pointer)))
  const disagreements: string[] = []
  let pages = 0
  for (const primitive of manifest.primitives)
    for (const page of primitive.pages) {
      pages++
      const geometry = page.geometry!
      const { attributes, indices } = decodeGeometryPage(
        pageBytes(dir, geometry.url, geometry.bytes),
      )
      // A version-9 manifest gives every page its cone.
      if (!coneHolds(page.cone!, attributes.position, indices))
        disagreements.push(`${pointer} page ${page.id}: cooked ${JSON.stringify(page.cone)}`)
    }
  return { pages, disagreements }
}

test('every cooked cone bounds the triangles its decoded page draws', async () => {
  const pointers = await sceneCacheFiles('manifest.json')
  assert.ok(pointers.length > 0, 'the repository compiles its scenes before the unit suite')
  let pages = 0
  const disagreements: string[] = []
  for (const pointer of pointers) {
    const scene = await checkScene(pointer)
    pages += scene.pages
    disagreements.push(...scene.disagreements)
  }
  assert.ok(pages > 0, 'the compiled scenes hold clusters')
  assert.deepEqual(disagreements.slice(0, 5), [], `${disagreements.length} of ${pages} pages`)
})
