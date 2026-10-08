// The run-time cut picks the grid exponent the compiler wrote. On every compiled scene, each paged
// primitive's position exponent (`quantization.positionExponent`) is asked again of the cut's grid
// (`cutGrid.ts` `positionGridExponent`, the call `runtimeCut.ts` makes), from what the cache keeps
// of the compiler's inputs: the widest extent of the pages' bounds, the finest positive error of
// the DAG's coarse pages, whether the primitive is blended, and the largest world scale the
// published scene places its mesh at.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCacheManifest } from '../../bench/runner/assets/cacheManifest.ts'
import { composeMatrix4, IDENTITY_MATRIX4, multiplyMatrix4 } from '../../packages/math/src/index.ts'
import { positionGridExponent } from '../../packages/sdk-browser/src/world/page/cutGrid.ts'
import { sceneCacheFiles } from '../kit/scenes/caches.ts'
import { length3 } from '../../packages/math/src/vector/vector.ts'

const root = new URL('../../', import.meta.url)

type GltfNode = {
  mesh?: number
  children?: number[]
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}

/** The longest of a world matrix's three linear columns (`proxy.rs` `world_scale`). */
const worldScale = (m: Float64Array) =>
  Math.max(0, ...[0, 4, 8].map((c) => length3(m[c], m[c + 1], m[c + 2])))

/** The largest world scale each mesh of a glTF is placed at, every node no other names as a child a
 *  root (`compiler_world.rs` `world_matrices`, `proxy.rs` `mesh_scales`). */
function meshScales(nodes: GltfNode[]) {
  const scales = new Map<number, number>()
  const children = new Set(nodes.flatMap((node) => node.children ?? []))
  const place = (id: number, parent: Float64Array) => {
    const node = nodes[id]
    const local = node.matrix
      ? Float64Array.from(node.matrix)
      : composeMatrix4(
          new Float64Array(16),
          node.translation ?? [0, 0, 0],
          node.rotation ?? [0, 0, 0, 1],
          node.scale ?? [1, 1, 1],
        )
    const world = multiplyMatrix4(new Float64Array(16), parent, local)
    if (node.mesh !== undefined)
      scales.set(node.mesh, Math.max(scales.get(node.mesh) ?? 0, worldScale(world)))
    for (const child of node.children ?? []) place(child, world)
  }
  nodes.forEach((_, id) => children.has(id) || place(id, IDENTITY_MATRIX4))
  return scales
}

/** Every paged primitive of the scene cache whose pointer is `pointer`, and those whose run-time
 *  grid differs from the compiler's. */
async function checkScene(pointer: string) {
  const { dir, manifest } = await readCacheManifest(dirname(fileURLToPath(new URL(pointer, root))))
  const gltf = JSON.parse(readFileSync(join(dir, 'source.gltf'), 'utf8')) as { nodes?: GltfNode[] }
  const scales = meshScales(gltf.nodes ?? [])
  const differences: string[] = []
  let primitives = 0
  for (const primitive of manifest.primitives) {
    const quantization = primitive.quantization
    if (!primitive.pages.length || !quantization) continue
    primitives++
    const low = [Infinity, Infinity, Infinity],
      high = [-Infinity, -Infinity, -Infinity]
    let finestError = Infinity
    for (const page of primitive.pages) {
      for (let axis = 0; axis < 3; axis++) {
        low[axis] = Math.min(low[axis], page.min[axis])
        high[axis] = Math.max(high[axis], page.max[axis])
      }
      // `primitive_exponent`: the errors of the clusters above the leaves, a zero one a root's.
      const error = page.lodError ?? 0
      if ((page.level ?? 0) > 0 && error > 0) finestError = Math.min(finestError, error)
    }
    const extent = Math.max(0, ...[0, 1, 2].map((axis) => high[axis] - low[axis]))
    const blended = primitive.pass === 'clustered-blend'
    const inputs = {
      finestError: Number.isFinite(finestError) ? finestError : null,
      scale: scales.get(primitive.mesh) ?? 0,
    }
    const exponent = positionGridExponent(extent, blended, inputs)
    if (exponent !== quantization.positionExponent)
      differences.push(
        `${pointer} mesh ${primitive.mesh} primitive ${primitive.primitive}: compiled ` +
          `${quantization.positionExponent}, cut ${exponent} (${JSON.stringify({ extent, blended, ...inputs })})`,
      )
  }
  return { primitives, differences }
}

test('the run-time cut picks the grid exponent the compiler wrote', async () => {
  const pointers = await sceneCacheFiles('manifest.json')
  assert.ok(pointers.length > 0, 'the repository compiles its scenes before the unit suite')
  let primitives = 0
  const differences: string[] = []
  for (const pointer of pointers) {
    const scene = await checkScene(pointer)
    primitives += scene.primitives
    differences.push(...scene.differences)
  }
  assert.ok(primitives > 0, 'the compiled scenes hold paged primitives')
  assert.deepEqual(differences, [], `${differences.length} of ${primitives} primitives`)
})
