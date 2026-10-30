// The scene the meshes' fields proof opens (`mesh-probes.gpu.ts`), generated and compiled by the native compiler: a ground and, over it, a
// block that overhangs it, a metre above the ground and a metre thick. The block is large (its bounding sphere is metres wide, well
// over the 30 cm under which a mesh is left out of the meshes' trace) and thick enough for its distance field to hold its faces. The
// ground under it sees the sun not at all, and the sky through the gap between the two: what the screen probes' rays find there is the block.
// `fields` false compiles the same scene with no distance field for its meshes, the third world of the proof. Y is up, a unit is a metre.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { measureOutput } from '../../../bench/core/paths.ts'
import { compileFullCache } from '../../../scripts/native/native-compiler.ts'
import { bufferPacker } from '../../../scripts/dev/fixtures/gltf.ts'
import { REPOSITORY_ROOT } from '../../../scripts/git/repository-files.ts'

type Vec = [number, number, number]
interface Shape {
  positions: number[]
  normals: number[]
  indices: number[]
}

/** Half the side of the ground, which lies in the plane `y = 0`. */
const GROUND_HALF = 20
/** The overhanging block: its corners. */
export const BLOCK = { low: [-2.5, 1, -2.5] as Vec, high: [2.5, 2, 2.5] as Vec }

/** A quad of corners `c`, counter-clockwise seen from the side its normal `n` points to, added to `shape`. */
function quad(c: Vec[], n: Vec, shape: Shape) {
  const base = shape.positions.length / 3
  for (const corner of c) (shape.positions.push(...corner), shape.normals.push(...n))
  shape.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  return shape
}

/** The box from `low` to `high`, six quads with their normals out: on each axis `a`, the face looks along `a`, its corners go round in the
 *  order of the axes `a + 1` then `a + 2`, whose cross product is `a`, and are reversed for the low face. */
function box(low: Vec, high: Vec) {
  const shape: Shape = { positions: [], normals: [], indices: [] }
  for (let a = 0; a < 3; a++)
    for (const side of [1, -1]) {
      const [u, v] = [(a + 1) % 3, (a + 2) % 3]
      const at = side > 0 ? high[a] : low[a]
      const corners = [
        [low[u], low[v]],
        [high[u], low[v]],
        [high[u], high[v]],
        [low[u], high[v]],
      ].map(([cu, cv]) => {
        const point: Vec = [0, 0, 0]
        point[a] = at
        point[u] = cu
        point[v] = cv
        return point
      })
      const normal: Vec = [0, 0, 0]
      normal[a] = side
      quad(side > 0 ? corners : corners.reverse(), normal, shape)
    }
  return shape
}

/** The glTF of the ground and the block, and its binary, written in `directory`. */
function writeSource(directory: string) {
  const g = GROUND_HALF
  const ground = quad(
    [
      [-g, 0, -g],
      [-g, 0, g],
      [g, 0, g],
      [g, 0, -g],
    ],
    [0, 1, 0],
    { positions: [], normals: [], indices: [] },
  )
  const shapes = [ground, box(BLOCK.low, BLOCK.high)]
  const { views, accessors, chunks, accessor, byteLength } = bufferPacker(0)
  const meshes = shapes.map((shape, material) => ({
    primitives: [
      {
        attributes: { POSITION: accessor(shape.positions, 3), NORMAL: accessor(shape.normals, 3) },
        indices: accessor(shape.indices, 1),
        material,
      },
    ],
  }))
  const colour = (rgb: number[]) => ({
    pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: 0.8 },
  })
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'ground', mesh: 0 },
      { name: 'block', mesh: 1 },
    ],
    meshes,
    materials: [colour([0.6, 0.6, 0.6]), colour([0.8, 0.3, 0.2])],
    buffers: [{ uri: 'scene.bin', byteLength: byteLength() }],
    bufferViews: views,
    accessors,
  }
  mkdirSync(directory, { recursive: true })
  writeFileSync(resolve(directory, 'scene.bin'), Buffer.concat(chunks))
  writeFileSync(resolve(directory, 'scene.gltf'), JSON.stringify(gltf))
}

/** The scene compiled once a file and a kind of build (`fields`: the meshes' distance fields built, or not) into the proof's own area, and the
 *  address of its full manifest. */
const compiled = new Map<boolean, string>()
export function meshProbesManifest(fields: boolean) {
  const kept = compiled.get(fields)
  if (kept) return kept
  const out = measureOutput('gpu-proofs', fields ? 'mesh-probes' : 'mesh-probes-plain')
  const source = resolve(out, 'source')
  writeSource(source)
  compileFullCache({
    cwd: REPOSITORY_ROOT,
    source,
    cache: resolve(out, 'cache'),
    resourceBase: `${pathToFileURL(source).href}/`,
    simplification: 'none',
    meshBuild: { distanceField: fields },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const manifest = pathToFileURL(resolve(out, 'cache/native/full/manifest.json')).href
  compiled.set(fields, manifest)
  return manifest
}
