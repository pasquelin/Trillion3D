#!/usr/bin/env node
// =====================================================================================
// A generated facade scene: a block of walls, pierced by windows, whose texture coordinates are
// laid out three ways on different walls — one island per wall, one island per window, and
// mirrored halves — over a checkerboard that names each of its cells in digits, so a slide of one
// cell is visible on a capture.
//
//   node bench/runner/scenes/facade.ts [--seed 7] [--triangles 300000] [--islands brick]
//
// `--islands brick` lays every wall out one texture island per brick instead: every position is
// a seam corner, the layout whose groups the DAG names `seam-locked` and reduces with solved
// vertices.
//
// It writes `.measure/assets/facade-<seed>/` (`facade-<seed>-bricks/` under `--islands brick`:
// glTF, binary and PNG), which
// `node bench/runner/assets/assets.ts --only facade-<seed>` then compiles like any other scene.
// =====================================================================================
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from '../harness/flags.ts'
import { ASSETS } from '../assets/scene.ts'
import { mulberry32 } from '../../../packages/math/src/sequence/random.ts'
import { bufferPacker } from '../../../scripts/fixtures/gltf.ts'
import { baySubdivision, facadePlan, facadeWalls, type WallMesh } from './facadeModel.ts'
import { facadeTexture } from './facadeTexture.ts'

const TEXTURE_FILE = 'facade-checker.png'

/** Between two and four hundred thousand triangles, the count drawn from the seed like the rest. */
export const defaultTriangles = (seed: number) => 200_000 + Math.round(mulberry32(seed)() * 200_000)

/** The glTF of a block: one mesh, one primitive per wall, one material over the checker. */
export function facadeGltf(walls: WallMesh[]) {
  const { views, accessors, chunks, accessor } = bufferPacker(0)
  const primitives = walls.map((wall) => ({
    attributes: {
      POSITION: accessor(wall.positions, 3),
      NORMAL: accessor(wall.normals, 3),
      TEXCOORD_0: accessor(wall.uvs, 2),
    },
    indices: accessor(wall.indices, 1),
    material: 0,
  }))
  const binary = Buffer.concat(chunks)
  return {
    binary,
    gltf: {
      asset: { version: '2.0', generator: 'Trillion3D facade scene generator' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'facade-block', mesh: 0 }],
      meshes: [{ name: 'facade-block', primitives }],
      materials: [
        {
          name: 'facade-checker',
          doubleSided: true,
          pbrMetallicRoughness: {
            baseColorTexture: { index: 0 },
            metallicFactor: 0,
            roughnessFactor: 0.8,
          },
        },
      ],
      textures: [{ source: 0, sampler: 0 }],
      samplers: [{ wrapS: 10497, wrapT: 10497 }],
      images: [{ uri: TEXTURE_FILE }],
      buffers: [{ uri: 'facade.bin', byteLength: binary.length }],
      bufferViews: views,
      accessors,
    },
  }
}

/** Writes the scene folder and returns what it holds. */
function writeFacade(directory: string, seed: number, triangles: number, bricks: boolean) {
  const plan = facadePlan(seed),
    subdivision = baySubdivision(plan, triangles),
    walls = facadeWalls(plan, subdivision, bricks),
    { binary, gltf } = facadeGltf(walls)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'facade.bin'), binary)
  writeFileSync(join(directory, 'facade.gltf'), `${JSON.stringify(gltf)}\n`)
  writeFileSync(join(directory, TEXTURE_FILE), facadeTexture())
  return {
    plan,
    subdivision,
    triangles: walls.reduce((sum, wall) => sum + wall.indices.length / 3, 0),
    layouts: walls.map((wall) => wall.layout),
  }
}

function main() {
  const flags = parseArgs(process.argv.slice(2))
  const seed = Number(flags.get('seed') ?? 7)
  const asked = flags.get('triangles')
  const triangles = asked && asked !== 'true' ? Number(asked) : defaultTriangles(seed)
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(triangles) || triangles < 1)
    throw new Error('--seed and --triangles must be integers, --triangles positive')
  const islands = flags.get('islands')
  if (islands !== undefined && islands !== 'brick') throw new Error('--islands takes `brick`')
  const bricks = islands === 'brick'
  const scene = `facade-${seed}${bricks ? '-bricks' : ''}`
  const written = writeFacade(join(ASSETS, scene), seed, triangles, bricks)
  process.stdout.write(
    `${scene}: ${written.triangles} triangles, ${written.plan.bays.join('×')} bays, ` +
      `${written.plan.storeys} storeys, bay cut ${written.subdivision}², ` +
      `layouts ${written.layouts.join(', ')}\n`,
  )
}

if (import.meta.main) main()
