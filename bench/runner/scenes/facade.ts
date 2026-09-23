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
// a seam corner, the layout whose stalled groups the DAG names mostly `seam-locked`.
//
// It writes `.mesure/assets/facade-<seed>/` (`facade-<seed>-bricks/` under `--islands brick`:
// glTF, binary and PNG), which
// `node bench/runner/assets.ts --only facade-<seed>` then compiles like any other scene.
// =====================================================================================
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../options.ts';
import { ASSETS } from '../scene.ts';
import { baySubdivision, facadePlan, facadeWalls, random, type WallMesh } from './facadeModel.ts';
import { facadeTexture } from './facadeTexture.ts';

const TEXTURE_FILE = 'facade-checker.png';

/** Between two and four hundred thousand triangles, the count drawn from the seed like the rest. */
export const defaultTriangles = (seed: number) => 200_000 + Math.round(random(seed)() * 200_000);

const aligned = (value: number) => (value + 3) & ~3;

/** The glTF of a block: one mesh, one primitive per wall, one material over the checker. */
export function facadeGltf(walls: WallMesh[]) {
  const chunks: Buffer[] = [],
    views: Record<string, number>[] = [],
    accessors: Record<string, unknown>[] = [],
    primitives: Record<string, unknown>[] = [];
  let offset = 0;
  const push = (data: ArrayBufferView, target: number) => {
    const start = aligned(offset),
      bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (start > offset) chunks.push(Buffer.alloc(start - offset));
    chunks.push(bytes);
    views.push({ buffer: 0, byteOffset: start, byteLength: bytes.length, target });
    offset = start + bytes.length;
    return views.length - 1;
  };
  const accessor = (entry: Record<string, unknown>) => accessors.push(entry) - 1;
  for (const wall of walls) {
    const count = wall.positions.length / 3;
    // glTF asks a POSITION accessor for its own bounds; one pass gives both corners.
    const min = [...wall.positions.subarray(0, 3)],
      max = [...min];
    for (let i = 0; i < wall.positions.length; i++) {
      const axis = i % 3;
      min[axis] = Math.min(min[axis], wall.positions[i]);
      max[axis] = Math.max(max[axis], wall.positions[i]);
    }
    const position = accessor({
      bufferView: push(wall.positions, 34962),
      componentType: 5126,
      type: 'VEC3',
      count,
      min,
      max,
    });
    const normal = accessor({
      bufferView: push(wall.normals, 34962),
      componentType: 5126,
      type: 'VEC3',
      count,
    });
    const uv = accessor({
      bufferView: push(wall.uvs, 34962),
      componentType: 5126,
      type: 'VEC2',
      count,
    });
    const index = accessor({
      bufferView: push(wall.indices, 34963),
      componentType: 5125,
      type: 'SCALAR',
      count: wall.indices.length,
    });
    primitives.push({
      attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv },
      indices: index,
      material: 0,
    });
  }
  const binary = Buffer.concat(chunks);
  return {
    binary,
    gltf: {
      asset: { version: '2.0', generator: 'trillion3D facade scene generator' },
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
  };
}

/** Writes the scene folder and returns what it holds. */
function writeFacade(directory: string, seed: number, triangles: number, bricks: boolean) {
  const plan = facadePlan(seed),
    subdivision = baySubdivision(plan, triangles),
    walls = facadeWalls(plan, subdivision, bricks),
    { binary, gltf } = facadeGltf(walls);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'facade.bin'), binary);
  writeFileSync(join(directory, 'facade.gltf'), `${JSON.stringify(gltf)}\n`);
  writeFileSync(join(directory, TEXTURE_FILE), facadeTexture());
  return {
    plan,
    subdivision,
    triangles: walls.reduce((sum, wall) => sum + wall.indices.length / 3, 0),
    layouts: walls.map((wall) => wall.layout),
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const seed = Number(flags.get('seed') ?? 7);
  const asked = flags.get('triangles');
  const triangles = asked && asked !== 'true' ? Number(asked) : defaultTriangles(seed);
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(triangles) || triangles < 1)
    throw new Error('--seed and --triangles must be integers, --triangles positive');
  const islands = flags.get('islands');
  if (islands !== undefined && islands !== 'brick') throw new Error('--islands takes `brick`');
  const bricks = islands === 'brick';
  const scene = `facade-${seed}${bricks ? '-bricks' : ''}`;
  const written = writeFacade(join(ASSETS, scene), seed, triangles, bricks);
  process.stdout.write(
    `${scene}: ${written.triangles} triangles, ${written.plan.bays.join('×')} bays, ` +
      `${written.plan.storeys} storeys, bay cut ${written.subdivision}², ` +
      `layouts ${written.layouts.join(', ')}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
