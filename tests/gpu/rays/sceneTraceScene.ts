// The scene the scene-trace proof traces, generated and compiled by the native compiler (which writes
// its `rayTracing.bin`): a ground, four boxes — turned, stretched, one mirrored — and two two-sided
// panels, one facing the eye and one turned away from it. Y is up, a unit is a metre.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { measureOutput } from '../../../bench/core/paths.ts'
import { bufferPacker } from '../../../scripts/dev/fixtures/gltf.ts'
import { compileModel } from '../world/generatedShapes.ts'
import { DEG2RAD } from '../../../packages/math/src/constants.ts'
import {
  DEFAULT_HLOD_CELL_SIZE,
  DEFAULT_HLOD_LOADING_RANGE,
} from '../../../packages/sdk-core/src/contracts/hlodAbi.ts'
import type { HlodOptions } from '../../../packages/sdk-core/src/contracts/hlodOptions.ts'

/** Half the side of the ground, which lies in the plane `y = 0`. */
export const GROUND_HALF = 20

type Vec = [number, number, number]
/** A mesh: its corners, their normals and its triangles' corner ranks. */
interface Shape {
  positions: number[]
  normals: number[]
  indices: number[]
}

/** The quad of corners `c`, counter-clockwise seen from the side its normal `n` points to. */
function quad(c: Vec[], n: Vec, shape: Shape = { positions: [], normals: [], indices: [] }) {
  const base = shape.positions.length / 3
  for (const corner of c) (shape.positions.push(...corner), shape.normals.push(...n))
  shape.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  return shape
}

/** The unit cube centred on the origin, six quads with their normals out. */
function cube() {
  const shape: Shape = { positions: [], normals: [], indices: [] }
  // Each face: its normal and two tangents whose cross product is that normal.
  const faces: [Vec, Vec, Vec][] = [
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [
      [-1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ],
    [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
    [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, -1],
      [0, 1, 0],
      [1, 0, 0],
    ],
  ]
  for (const [n, u, v] of faces) {
    const corner = (a: number, b: number): Vec => [
      (n[0] + a * u[0] + b * v[0]) / 2,
      (n[1] + a * u[1] + b * v[1]) / 2,
      (n[2] + a * u[2] + b * v[2]) / 2,
    ]
    quad([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], n, shape)
  }
  return shape
}

/** The quaternion (x, y, z, w) of a turn of `degrees` about the unit `axis`. */
function turn(axis: Vec, degrees: number): [number, number, number, number] {
  const half = (degrees * DEG2RAD) / 2
  return [...axis.map((a) => a * Math.sin(half)), Math.cos(half)] as [
    number,
    number,
    number,
    number,
  ]
}

/** The nodes: the mesh each places, then its pose. */
const NODES: { name: string; mesh: number; translation?: Vec; rotation?: number[]; scale?: Vec }[] =
  [
    { name: 'ground', mesh: 0 },
    { name: 'cube', mesh: 1, translation: [-3, 1, 0], scale: [2, 2, 2] },
    {
      name: 'turned',
      mesh: 1,
      translation: [2, 0.75, -2],
      rotation: turn([0, 1, 0], 30),
      scale: [1.5, 1.5, 1.5],
    },
    {
      name: 'stretched',
      mesh: 1,
      translation: [4, 1.5, 3],
      rotation: turn([0, 0, 1], 20),
      scale: [1, 3, 2],
    },
    { name: 'mirrored', mesh: 1, translation: [-6, 1, -4], scale: [-2, 2, 2] },
    {
      name: 'panel toward the eye',
      mesh: 2,
      translation: [0, 1.5, 4],
      rotation: turn([0, 1, 0], 15),
    },
    { name: 'panel away', mesh: 2, translation: [-1, 1.5, -7], rotation: turn([0, 1, 0], 180) },
  ]

/** The scene's nodes moved by `offset` metres. */
const movedBy = (offset: Vec) =>
  NODES.map((node) => ({
    ...node,
    translation: (node.translation ?? [0, 0, 0]).map((v, axis) => v + offset[axis]) as Vec,
  }))

/** The glTF of the scene and its binary, written in `directory`, the scene `offset` metres from the origin. */
function writeSource(directory: string, offset: Vec) {
  const nodes = movedBy(offset)
  const g = GROUND_HALF
  const ground = quad(
    [
      [-g, 0, -g],
      [-g, 0, g],
      [g, 0, g],
      [g, 0, -g],
    ],
    [0, 1, 0],
  )
  const panel = quad(
    [
      [-1.5, -1.5, 0],
      [1.5, -1.5, 0],
      [1.5, 1.5, 0],
      [-1.5, 1.5, 0],
    ],
    [0, 0, 1],
  )
  const shapes = [ground, cube(), panel]
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
  const colour = (rgb: number[], extra = {}) => ({
    pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: 0.8 },
    ...extra,
  })
  const bytes = Buffer.concat(chunks)
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: [
      colour([0.5, 0.5, 0.5]),
      colour([0.8, 0.2, 0.2]),
      colour([0.2, 0.7, 0.3], { doubleSided: true }),
    ],
    buffers: [{ uri: 'scene.bin', byteLength: byteLength() }],
    bufferViews: views,
    accessors,
  }
  mkdirSync(directory, { recursive: true })
  writeFileSync(resolve(directory, 'scene.bin'), bytes)
  writeFileSync(resolve(directory, 'scene.gltf'), JSON.stringify(gltf))
}

/** The scene compiled with the native compiler (no simplification: its structures hold the scene's
 *  own triangles) into the proof's own area, and the address of its full manifest. */
export function traceSceneManifest() {
  const out = measureOutput('gpu-proofs', 'scene-trace')
  const source = resolve(out, 'source')
  writeSource(source, [0, 0, 0])
  return compileModel(out, source, 'none')
}

/** Where the HLOD scene lies: far enough from the proof's eye (`HLOD_POSE`) that the cells of its HLOD 0 are out of
 *  their loading range, 512 metres, and those of its HLOD 1 within theirs, 1024: the cut draws the HLOD 0 cells' actors. */
export const HLOD_OFFSET: Vec = [100, 0, -700]

/** The two layers of the HLOD scene, in the expert form: the first instanced, the second merged, on the simple form's
 *  grids (each twice as coarse as the one before it) and with its settings, but for `allowDistanceField`: the merged
 *  layer's cells get a field, so the cut draws a stand-in for each of its actors, which tells a hit by that stand-in. */
const HLOD_LAYERS: HlodOptions = {
  layers: [
    {
      name: 'hlod0',
      builder: 'instanced',
      parent: 'hlod1',
      cellSize: DEFAULT_HLOD_CELL_SIZE,
      loadingRange: DEFAULT_HLOD_LOADING_RANGE,
    },
    {
      name: 'hlod1',
      builder: 'merge',
      cellSize: DEFAULT_HLOD_CELL_SIZE * 2,
      loadingRange: DEFAULT_HLOD_LOADING_RANGE * 2,
      lodSelection: 'lowest',
      mergeMaterials: true,
      textureSizing: 'drawDistance',
      allowDoubleSided: false,
      maps: { normal: true, roughness: true, metallic: true, specular: true, emissive: true },
      allowDistanceField: true,
    },
  ],
  default: 'hlod0',
}

/** The same scene at `HLOD_OFFSET`, compiled with `HLOD_LAYERS`, so that its ray tracing file holds the HLOD actors'
 *  records and the world's directory and the cells of its merged layer have a field, and the address of its full
 *  manifest. */
export function hlodSceneManifest() {
  const out = measureOutput('gpu-proofs', 'scene-trace-hlod')
  const source = resolve(out, 'source')
  writeSource(source, HLOD_OFFSET)
  return compileModel(out, source, 'none', HLOD_LAYERS)
}
