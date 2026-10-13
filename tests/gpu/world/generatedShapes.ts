// Generated glTF shapes the proofs compile: the writer of one mesh and its compile, and a dense
// sphere cooked with simplification — its clusters have levels of detail, so the stretch of a
// placement decides how much of it is drawn. Nothing here names a site example.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileFullCache } from '../../../scripts/native-compiler.ts'
import { measureOutput } from '../../../bench/core/paths.ts'
import { REPOSITORY_ROOT } from '../../../scripts/repository-files.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { PI, TAU } from '../../../packages/math/src/constants.ts'

/** The glTF of one mesh, `positions` and `normals` of `count` vertices and its `indices`, painted
 *  `color`, under `nodes` (the mesh node first), its binary beside it as `shape.bin`; `skin`, extra
 *  attributes and the skin of node 0, when the case has them. */
export function shapeSource(
  directory: string,
  shape: { positions: number[]; normals: number[]; indices: number[]; indexType?: 5123 | 5125 },
  color: number[],
  extra: {
    attributes?: Record<string, number>
    accessors?: object[]
    bytes?: Buffer[]
    views?: { byteLength: number }[]
    nodes?: object[]
    skins?: object[]
    scene?: number[]
  } = {},
) {
  const indexType = shape.indexType ?? 5123
  const index = indexType === 5123 ? new Uint16Array(shape.indices) : new Uint32Array(shape.indices)
  const parts = [
    Buffer.from(new Float32Array(shape.positions).buffer),
    Buffer.from(new Float32Array(shape.normals).buffer),
    Buffer.from(index.buffer),
    ...(extra.bytes ?? []),
  ]
  const views = parts.map((part) => ({ byteLength: part.length }))
  let offset = 0
  const bufferViews = views.map(({ byteLength }) => {
    const view = { buffer: 0, byteOffset: offset, byteLength }
    offset += ceilDiv(byteLength, 4) * 4
    return view
  })
  const padded = Buffer.concat(
    parts.map((part) => Buffer.concat([part, Buffer.alloc((4 - (part.length % 4)) % 4)])),
  )
  const lows = [0, 1, 2].map((axis) =>
    Math.min(...shape.positions.filter((_, i) => i % 3 === axis)),
  )
  const highs = [0, 1, 2].map((axis) =>
    Math.max(...shape.positions.filter((_, i) => i % 3 === axis)),
  )
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: extra.scene ?? [0] }],
    nodes: extra.nodes ?? [{ mesh: 0 }],
    ...(extra.skins && { skins: extra.skins }),
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, ...extra.attributes },
            indices: 2,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 0.8 } },
    ],
    buffers: [{ uri: 'shape.bin', byteLength: padded.length }],
    bufferViews,
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        type: 'VEC3',
        count: shape.positions.length / 3,
        min: lows,
        max: highs,
      },
      { bufferView: 1, componentType: 5126, type: 'VEC3', count: shape.normals.length / 3 },
      { bufferView: 2, componentType: indexType, type: 'SCALAR', count: shape.indices.length },
      ...(extra.accessors ?? []),
    ],
  }
  mkdirSync(directory, { recursive: true })
  writeFileSync(resolve(directory, 'shape.bin'), padded)
  writeFileSync(resolve(directory, 'shape.gltf'), JSON.stringify(gltf))
}

/** A UV sphere of `rings` × `segments` quads, radius 1. */
function sphere(rings: number, segments: number) {
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = []
  for (let r = 0; r <= rings; r++)
    for (let s = 0; s <= segments; s++) {
      const v = (r / rings) * PI,
        u = (s / segments) * TAU
      const n = [Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)]
      positions.push(...n)
      normals.push(...n)
    }
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s,
        b = a + segments + 1
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  return { positions, normals, indices, indexType: 5125 as const }
}

/** The compiled manifest of a dense UV sphere cooked with simplification: its clusters have levels
 *  of detail, so the stretch of a placement decides how much of it is drawn. */
export function sphereModel(name: string, color: number[]) {
  const out = measureOutput('gpu-proofs', `append-models-${name}`)
  const source = resolve(out, 'source')
  shapeSource(source, sphere(160, 240), color)
  return compileModel(out, source, 'qem-endpoints')
}

/** Compiles `source` into `<out>/cache` and gives the address of its manifest. */
export function compileModel(
  out: string,
  source: string,
  simplification?: 'none' | 'qem-endpoints',
) {
  compileFullCache({
    cwd: REPOSITORY_ROOT,
    source,
    cache: resolve(out, 'cache'),
    resourceBase: `${pathToFileURL(source).href}/`,
    simplification,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  return pathToFileURL(resolve(out, 'cache/native/full/manifest.json')).href
}
