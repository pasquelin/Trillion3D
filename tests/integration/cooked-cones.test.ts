// The WebGPU prepare posts the cone the compiler cooked (`normal_cone.rs`) rather than building one
// with `triangleCone` from the host vertices. On every compiled scene, this rebuilds that cone from
// `source.gltf` as the prepared scene views it and each index page — a vertex a solve placed read
// from its geometry page —, and requires the cooked cone to bound every face and to be at most
// twice the compiler's margin wider.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readCacheManifest } from '../../bench/runner/assets/cacheManifest.ts'
import { coneHolds } from '../kit/reference/cone.ts'
import { preparedGeometries } from '../../packages/sdk-browser/src/host/prepared/geometry.ts'
import { decodeGeometryPage } from '../../packages/sdk-browser/src/page/codec/geometryPage.ts'
import { sceneDocument } from '../../packages/sdk-browser/src/scene/tables.ts'
import { joinedCorners, withPlaced } from '../kit/reference/placedVertices.ts'
import type { PreparedSceneTables } from '../../packages/sdk-core/src/scene/core/tableContracts.ts'
import { sceneCacheFiles } from '../kit/scenes/caches.ts'

const root = new URL('../../', import.meta.url)

/** The bytes of `file`, alone in their `ArrayBuffer`. */
const bytesOf = (file: string) => new Uint8Array(readFileSync(file)).buffer

/** Every page of the scene cache whose pointer is `pointer`, and how many of them disagree. */
async function checkScene(pointer: string) {
  const { dir, manifest } = await readCacheManifest(dirname(fileURLToPath(new URL(pointer, root))))
  const tables = JSON.parse(
    readFileSync(join(dir, 'scene-tables.json'), 'utf8'),
  ) as PreparedSceneTables
  // The document the session draws (`SCENE_FILE`).
  const { document, bufferUrl } = sceneDocument(tables, pathToFileURL(`${dir}/`).href)
  const geometryOf = preparedGeometries(document, async () => bytesOf(fileURLToPath(bufferUrl!)))
  // A streaming bundle holds dozens of index pages: each is read once, and a page viewed in it.
  const bundles = new Map<string, ArrayBuffer>()
  const bundle = (url: string) =>
    bundles.get(url) ?? bundles.set(url, bytesOf(join(dir, url))).get(url)!
  const disagreements: string[] = []
  let pages = 0
  for (const primitive of manifest.primitives) {
    if (!primitive.pages.length) continue
    const geometry = await geometryOf(primitive.mesh, primitive.primitive).loadVertices()
    const position = geometry.attributes.position
    // The copy the prepare made before it read cones from the cache: every accessor, element by element.
    const xyz = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i++) {
      xyz[i * 3] = position.getX(i)
      xyz[i * 3 + 1] = position.getY(i)
      xyz[i * 3 + 2] = position.getZ(i)
    }
    const columns = { positions: xyz, normals: new Float32Array(0), uvs: null, colors: null }
    for (const page of primitive.pages) {
      pages++
      const held = page.stream === undefined ? undefined : primitive.streams?.pages[page.stream]
      const joined = joinedCorners([
        held
          ? new Uint32Array(bundle(held.url), page.streamOffset, page.count)
          : new Uint32Array(bundle(page.url), 0, page.count),
      ])
      // A vertex a seam-locked solve placed is read from the geometry page naming it.
      const url = join(dir, page.geometry!.url)
      const decoded = async () => [decodeGeometryPage(new Uint8Array(bytesOf(url)))]
      const { positions } = await withPlaced(columns, joined, [page], decoded)
      // A version-9 sidecar gives every page its cone.
      if (!coneHolds(page.cone!, positions, joined.indices))
        disagreements.push(`${pointer} page ${page.id}: cooked ${JSON.stringify(page.cone)}`)
    }
  }
  return { pages, disagreements }
}

test('every cooked cone bounds its triangles and is no wider than the runtime one', async () => {
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
