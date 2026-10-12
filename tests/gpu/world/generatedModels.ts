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

/** The compiled manifest of a crowd of `columns` × `rows` cubes named `name`, as a file address.
 *  Compiled again at each call: the area is the proof's own. */
export function crowdModel(name: string, columns: number, rows: number, color: number[]) {
  const out = measureOutput('gpu-proofs', `append-models-${name}`)
  const source = resolve(out, 'source')
  crowdSource(source, columns, rows, color)
  compileFullCache({
    cwd: REPOSITORY_ROOT,
    source,
    cache: resolve(out, 'cache'),
    resourceBase: `${pathToFileURL(source).href}/`,
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
