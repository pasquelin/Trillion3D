// The compiled models the append proofs load, generated: a glTF of cubes in a grid, compiled once
// by the native compiler. One that places more cubes than a stream unit holds is partitioned in
// cells the world reads by distance (`compiler_tables/partition.rs`), a smaller one is not. The
// bench and the coplanar fixtures are the proofs' other models; nothing here names a site example.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileFullCache } from '../../../scripts/native-compiler.ts'
import { measureOutput } from '../../../bench/core/paths.ts'
import { REPOSITORY_ROOT } from '../../../scripts/repository-files.ts'

/** A unit cube's corners — four to a face, with its normal — and its twelve triangles. */
function cube(size: number) {
  const h = size / 2
  const faces: [number[], number[][]][] = [
    [
      [0, 0, 1],
      [
        [-h, -h, h],
        [h, -h, h],
        [h, h, h],
        [-h, h, h],
      ],
    ],
    [
      [0, 0, -1],
      [
        [h, -h, -h],
        [-h, -h, -h],
        [-h, h, -h],
        [h, h, -h],
      ],
    ],
    [
      [1, 0, 0],
      [
        [h, -h, h],
        [h, -h, -h],
        [h, h, -h],
        [h, h, h],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [-h, -h, -h],
        [-h, -h, h],
        [-h, h, h],
        [-h, h, -h],
      ],
    ],
    [
      [0, 1, 0],
      [
        [-h, h, h],
        [h, h, h],
        [h, h, -h],
        [-h, h, -h],
      ],
    ],
    [
      [0, -1, 0],
      [
        [-h, -h, -h],
        [h, -h, -h],
        [h, -h, h],
        [-h, -h, h],
      ],
    ],
  ]
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = []
  faces.forEach(([normal, corners], face) => {
    for (const corner of corners) {
      positions.push(...corner)
      normals.push(...normal)
    }
    const base = face * 4
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  })
  return { positions, normals, indices }
}

/** The glTF of `columns` × `rows` cubes of `size`, `spacing` apart on the ground plane, each the
 *  leaf node of one mesh, painted `color`; its binary beside it. */
function crowdSource(directory: string, columns: number, rows: number, color: number[]) {
  const spacing = 1,
    shape = cube(0.6)
  const bytes = Buffer.concat([
    Buffer.from(new Float32Array(shape.positions).buffer),
    Buffer.from(new Float32Array(shape.normals).buffer),
    Buffer.from(new Uint16Array(shape.indices).buffer),
  ])
  const nodes = Array.from({ length: columns * rows }, (_, i) => ({
    mesh: 0,
    translation: [
      ((i % columns) - (columns - 1) / 2) * spacing,
      0.3,
      (Math.floor(i / columns) - (rows - 1) / 2) * spacing,
    ],
  }))
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 0.8 },
      },
    ],
    buffers: [{ uri: 'crowd.bin', byteLength: bytes.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: shape.positions.length * 4 },
      { buffer: 0, byteOffset: shape.positions.length * 4, byteLength: shape.normals.length * 4 },
      { buffer: 0, byteOffset: shape.positions.length * 8, byteLength: shape.indices.length * 2 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        type: 'VEC3',
        count: shape.positions.length / 3,
        min: [-0.3, -0.3, -0.3],
        max: [0.3, 0.3, 0.3],
      },
      { bufferView: 1, componentType: 5126, type: 'VEC3', count: shape.normals.length / 3 },
      { bufferView: 2, componentType: 5123, type: 'SCALAR', count: shape.indices.length },
    ],
  }
  mkdirSync(directory, { recursive: true })
  writeFileSync(resolve(directory, 'crowd.bin'), bytes)
  writeFileSync(resolve(directory, 'crowd.gltf'), JSON.stringify(gltf))
}

/** The glTF of one mesh, `positions` and `normals` of `count` vertices and its `indices`, painted
 *  `color`, under `nodes` (the mesh node first), its binary beside it as `shape.bin`; `skin`, extra
 *  attributes and the skin of node 0, when the case has them. */
function shapeSource(
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
    offset += Math.ceil(byteLength / 4) * 4
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
      const v = (r / rings) * Math.PI,
        u = (s / segments) * 2 * Math.PI
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

/** A tube of three rings of four corners bent by two joints — the second a child of the first, one
 *  above it —, skinned, compiled: a model whose bones stand in its graph. */
export function skinnedModel(name: string, color: number[]) {
  const out = measureOutput('gpu-proofs', `append-models-${name}`)
  const source = resolve(out, 'source')
  const positions: number[] = [],
    normals: number[] = [],
    joints: number[] = [],
    weights: number[] = [],
    indices: number[] = []
  const corners = [
    [-0.3, -0.3],
    [0.3, -0.3],
    [0.3, 0.3],
    [-0.3, 0.3],
  ]
  for (let ring = 0; ring < 3; ring++)
    for (const [x, z] of corners) {
      positions.push(x, ring * 0.6, z)
      normals.push(x / 0.3 / Math.SQRT2, 0, z / 0.3 / Math.SQRT2)
      joints.push(ring === 2 ? 1 : 0, ring === 1 ? 1 : 0, 0, 0)
      weights.push(ring === 1 ? 0.5 : 1, ring === 1 ? 0.5 : 0, 0, 0)
    }
  for (let ring = 0; ring < 2; ring++)
    for (let c = 0; c < 4; c++) {
      const a = ring * 4 + c,
        b = ring * 4 + ((c + 1) % 4)
      indices.push(a, a + 4, b, b, a + 4, b + 4)
    }
  const bind = Buffer.from(
    new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.6,
      0, 1,
    ]).buffer,
  )
  shapeSource(source, { positions, normals, indices }, color, {
    attributes: { JOINTS_0: 3, WEIGHTS_0: 4 },
    accessors: [
      { bufferView: 3, componentType: 5121, type: 'VEC4', count: 12 },
      { bufferView: 4, componentType: 5126, type: 'VEC4', count: 12 },
      { bufferView: 5, componentType: 5126, type: 'MAT4', count: 2 },
    ],
    bytes: [
      Buffer.from(new Uint8Array(joints)),
      Buffer.from(new Float32Array(weights).buffer),
      bind,
    ],
    nodes: [
      { mesh: 0, skin: 0 },
      { name: 'hip', children: [2] },
      { name: 'knee', translation: [0, 0.6, 0] },
    ],
    skins: [{ joints: [1, 2], inverseBindMatrices: 5, skeleton: 1 }],
    scene: [0, 1],
  })
  return compileModel(out, source)
}

/** Compiles `source` into `<out>/cache` and gives the address of its manifest. */
function compileModel(out: string, source: string, simplification?: 'none' | 'qem-endpoints') {
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

/** The compiled manifest of a crowd of `columns` × `rows` cubes named `name`, as a file address.
 *  Compiled again at each call: the area is the proof's own. */
export function crowdModel(
  name: string,
  columns: number,
  rows: number,
  color: number[],
  simplification?: 'none' | 'qem-endpoints',
) {
  const out = measureOutput('gpu-proofs', `append-models-${name}`)
  const source = resolve(out, 'source')
  crowdSource(source, columns, rows, color)
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

/** A coplanar fixture of the compiler's tests, compiled once for a proof (`open-world`'s). */
export function coplanarModel(name: string) {
  const out = measureOutput('gpu-proofs', `open-world-${name}`)
  const source = resolve(REPOSITORY_ROOT, 'tests/fixtures/formats/coplanar', name)
  compileFullCache({
    cwd: REPOSITORY_ROOT,
    source,
    cache: resolve(out, 'cache'),
    resourceBase: `${pathToFileURL(source).href}/`,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  return pathToFileURL(resolve(out, 'cache/native/full/manifest.json')).href
}
