#!/usr/bin/env node
// =====================================================================================
// Six normal-mapped scenes derived from the public `normal-tangent-mirror-test`: its authored
// tangents, mirrored on half the texture, drawn paged, unpaged and unpaged without the tangents,
// blended and opaque.
//
//   node bench/runner/scenes/tangentScenes.ts   (prints the `assets.ts --only` line that compiles them)
//
// Every folder holds the same mesh and images. A blended trio wears the material at
// `TANGENT_BLEND_ALPHA`, an opaque trio the source material as it is. The compiler keeps a primitive
// outside the DAG (`shared-blend`, `unsplit_material`) for one property alone, a transmission
// factor: the `unpaged` and `frame` scenes carry one no pixel can see (`TANGENT_TRANSMISSION`), and
// the WebGPU engine draws them from their source buffers, in the transmission pass. The `unpaged`
// scene keeps the authored tangents the engine reads there; the `frame` scene has none, so its frame
// is rebuilt from screen derivatives as a geometry page's is (`clustered-blend`, `exact-clusters`:
// the `paged` scene, which stores no tangent and draws in the blend or the resolve). The `unpaged`
// and the `frame` scene differ by the tangent source alone, one pass, one shader
// (`tests/gpu/webgpu/page-tangents.gpu.ts`).
// =====================================================================================
import { cpSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ASSETS } from '../assets/scene.ts'
import { sceneGltfFile } from '../assets/assetsCatalogue.ts'
import { readJson } from '../../../scripts/repository-files.ts'

/** The public scene all six are derived from. */
const TANGENT_SOURCE = 'normal-tangent-mirror-test'
/** The derived scenes, one per surface and path, with the pass each compiles to. */
export const TANGENT_SCENES = (
  [
    { surface: 'blend', path: 'paged', pass: 'clustered-blend' },
    { surface: 'blend', path: 'unpaged', pass: 'shared-blend' },
    { surface: 'blend', path: 'frame', pass: 'shared-blend' },
    { surface: 'opaque', path: 'paged', pass: 'exact-clusters' },
    { surface: 'opaque', path: 'unpaged', pass: 'shared-blend' },
    { surface: 'opaque', path: 'frame', pass: 'shared-blend' },
  ] as const
).map((entry) => ({
  ...entry,
  key: `${entry.surface}-${entry.path}`,
  scene: `normal-tangent-${entry.surface}-${entry.path}`,
}))
/** The opacity of the blended material: enough to see the normal map, and the background. */
export const TANGENT_BLEND_ALPHA = 0.7
/** The transmission extension an unpaged scene's material carries, and its factor: the one
 *  property that keeps a primitive outside the DAG (`unsplit_material`), small enough to move no
 *  pixel of an 8-bit image. */
const TRANSMISSION = 'KHR_materials_transmission'
export const TANGENT_TRANSMISSION = 1e-6

type Gltf = {
  materials: Record<string, unknown>[]
  meshes: { primitives: { attributes: Record<string, number> }[] }[]
  extensionsUsed?: string[]
}
type Path = (typeof TANGENT_SCENES)[number]['path']

/**
 * The derived glTF: with `blended`, every material blended at `TANGENT_BLEND_ALPHA`; on an
 * `unpaged` or a `frame` path, every material carrying `TANGENT_TRANSMISSION`, and on a `frame`
 * path no primitive carrying its tangents; every other property kept.
 */
export function tangentSceneGltf(source: Gltf, blended: boolean, path: Path): Gltf {
  const unpaged = path !== 'paged'
  const gltf = structuredClone(source)
  for (const material of gltf.materials) {
    if (blended) {
      const pbr = (material.pbrMetallicRoughness ??= {}) as { baseColorFactor?: number[] }
      const [r, g, b] = pbr.baseColorFactor ?? [1, 1, 1]
      pbr.baseColorFactor = [r, g, b, TANGENT_BLEND_ALPHA]
      material.alphaMode = 'BLEND'
    }
    if (unpaged)
      material.extensions = {
        ...(material.extensions as object),
        [TRANSMISSION]: { transmissionFactor: TANGENT_TRANSMISSION },
      }
  }
  if (unpaged && !gltf.extensionsUsed?.includes(TRANSMISSION))
    gltf.extensionsUsed = [...(gltf.extensionsUsed ?? []), TRANSMISSION]
  if (path === 'frame')
    for (const { primitives } of gltf.meshes)
      for (const { attributes } of primitives) delete attributes.TANGENT
  return gltf
}

/** Writes the six scenes under `ASSETS`, from the source scene already there, and prints the
 *  command that compiles them. */
function writeTangentScenes() {
  const from = join(ASSETS, TANGENT_SOURCE)
  const file = sceneGltfFile(from)
  if (!file) throw new Error(`no glTF under ${from}: run node bench/runner/assets/assets.ts first`)
  const source = readJson(join(from, file)) as Gltf
  for (const { surface, path, scene } of TANGENT_SCENES) {
    const to = join(ASSETS, scene)
    cpSync(from, to, { recursive: true, filter: (name) => !name.endsWith('.gltf') })
    const gltf = tangentSceneGltf(source, surface === 'blend', path)
    writeFileSync(join(to, `${scene}.gltf`), `${JSON.stringify(gltf, null, 1)}\n`)
  }
  const names = TANGENT_SCENES.map(({ scene }) => scene)
  process.stdout.write(`node bench/runner/assets/assets.ts --only ${names.join(',')}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename))
  writeTangentScenes()
