#!/usr/bin/env node
// =====================================================================================
// The aerial scene of #410: the open world's pattern, small enough to cook and load in seconds.
// A rolling ground cut into square tiles, one mesh each, and a few props — trees, bushes, houses,
// rocks — each written once and placed by thousands of nodes that reference it, turned and scaled,
// so tens of millions of instanced triangles stand on a source of a few hundred thousand. Street
// lamps are point lights on nodes of their own (`KHR_lights_punctual`).
//
//   node bench/runner/scenes/aerial.ts [--seed 410] [--props 3600] [--lamps 600]
//
// It writes `.mesure/assets/aerial-<seed>/` (glTF and binary), which
// `node bench/runner/assets/assets.ts --only aerial-<seed>` then compiles like any other scene. The
// bench's `overview` view flies over it.
// =====================================================================================
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from '../options.ts';
import { ASSETS } from '../assets/scene.ts';
import { mulberry32 } from '../../../site/examples/kit/random.ts';
import { groundHeight, groundTile, lathe, PROPS, type ShapeMesh } from './aerialModel.ts';

/** The world: `TILES`² ground tiles of `TILE` metres, `CELLS`² quads each, `RELIEF` metres of relief. */
const TILES = 8,
  TILE = 500,
  CELLS = 64,
  RELIEF = 120;
const EXTENT = TILES * TILE;
/** A lamp's light: its range and intensity (candela), a warm white. */
const LAMP = { type: 'point', color: [1, 0.85, 0.6], intensity: 400, range: 18 };
const MATERIALS = [
  { name: 'ground', rgb: [0.32, 0.4, 0.22], roughness: 0.95 },
  { name: 'leaves', rgb: [0.12, 0.3, 0.1], roughness: 0.8 },
  { name: 'walls', rgb: [0.78, 0.72, 0.62], roughness: 0.7 },
  { name: 'stone', rgb: [0.45, 0.43, 0.4], roughness: 0.9 },
];

type Node = Record<string, unknown>;

/** The binary chunk and the accessors of every mesh, one primitive each. */
function meshTables(meshes: { name: string; material: number; shape: ShapeMesh }[]) {
  const chunks: Buffer[] = [],
    bufferViews: Node[] = [],
    accessors: Node[] = [];
  let offset = 0;
  const view = (data: Float32Array | Uint32Array, target: number) => {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    chunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    offset += bytes.length;
    return bufferViews.length - 1;
  };
  const accessor = (entry: Node) => accessors.push(entry) - 1;
  const gltfMeshes = meshes.map(({ name, material, shape }) => {
    const count = shape.positions.length / 3,
      min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    shape.positions.forEach((value, i) => {
      min[i % 3] = Math.min(min[i % 3], value);
      max[i % 3] = Math.max(max[i % 3], value);
    });
    const attributes = {
      POSITION: accessor({
        bufferView: view(shape.positions, 34962),
        componentType: 5126,
        type: 'VEC3',
        count,
        min,
        max,
      }),
      NORMAL: accessor({
        bufferView: view(shape.normals, 34962),
        componentType: 5126,
        type: 'VEC3',
        count,
      }),
    };
    const indices = accessor({
      bufferView: view(shape.indices, 34963),
      componentType: 5125,
      type: 'SCALAR',
      count: shape.indices.length,
    });
    return { name, primitives: [{ attributes, indices, material }] };
  });
  return { binary: Buffer.concat(chunks), bufferViews, accessors, meshes: gltfMeshes };
}

/** The whole scene for `seed`: its glTF, its binary, and what it counts. */
export function aerialScene(seed: number, props: number, lamps: number) {
  const random = mulberry32(seed),
    meshes: { name: string; material: number; shape: ShapeMesh }[] = [],
    nodes: Node[] = [];
  for (let j = 0; j < TILES; j++)
    for (let i = 0; i < TILES; i++) {
      const [x, z] = [i * TILE - EXTENT / 2, j * TILE - EXTENT / 2];
      nodes.push({ name: `ground-${i}-${j}`, mesh: meshes.length, translation: [x, 0, z] });
      meshes.push({
        name: `ground-${i}-${j}`,
        material: 0,
        shape: groundTile(x, z, TILE, CELLS, RELIEF),
      });
    }
  const first = meshes.length;
  for (const prop of PROPS)
    meshes.push({
      name: prop.name,
      material: prop.material,
      shape: lathe(prop.profile, prop.segments, prop.rings, random, prop.wobble),
    });
  const shares = PROPS.reduce((sum, prop) => sum + prop.share, 0),
    triangles = meshes.map(({ shape }) => shape.indices.length / 3);
  let instanced = triangles.slice(0, first).reduce((a, b) => a + b, 0);
  const place = () => {
    const [x, z] = [(random() - 0.5) * EXTENT * 0.98, (random() - 0.5) * EXTENT * 0.98];
    return [x, groundHeight(x, z, RELIEF), z];
  };
  for (let n = 0; n < props; n++) {
    let pick = random() * shares,
      k = 0;
    while ((pick -= PROPS[k].share) >= 0) k++;
    const turn = random() * Math.PI,
      scale = 0.7 + random() * 0.6;
    nodes.push({
      mesh: first + k,
      translation: place(),
      rotation: [0, Math.sin(turn), 0, Math.cos(turn)],
      scale: [scale, scale, scale],
    });
    instanced += triangles[first + k];
  }
  for (let n = 0; n < lamps; n++) {
    const [x, y, z] = place();
    nodes.push({
      name: `lamp-${n}`,
      translation: [x, y + 6, z],
      extensions: { KHR_lights_punctual: { light: 0 } },
    });
  }
  const tables = meshTables(meshes);
  const gltf = {
    asset: { version: '2.0', generator: 'Trillion3D aerial scene generator' },
    extensionsUsed: ['KHR_lights_punctual'],
    extensions: { KHR_lights_punctual: { lights: [LAMP] } },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: tables.meshes,
    materials: MATERIALS.map(({ name, rgb, roughness }) => ({
      name,
      pbrMetallicRoughness: {
        baseColorFactor: [...rgb, 1],
        metallicFactor: 0,
        roughnessFactor: roughness,
      },
    })),
    buffers: [{ uri: 'aerial.bin', byteLength: tables.binary.length }],
    bufferViews: tables.bufferViews,
    accessors: tables.accessors,
  };
  const source = triangles.reduce((a, b) => a + b, 0);
  return { gltf, binary: tables.binary, counts: { nodes: nodes.length, source, instanced } };
}

function main() {
  const flags = parseArgs(process.argv.slice(2)),
    number = (name: string, fallback: number) => Number(flags.get(name) ?? fallback);
  const [seed, props, lamps] = [number('seed', 410), number('props', 3600), number('lamps', 600)];
  flags.refuseUnread();
  if (![seed, props, lamps].every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new Error('--seed, --props and --lamps take whole numbers');
  const scene = `aerial-${seed}`,
    directory = join(ASSETS, scene),
    { gltf, binary, counts } = aerialScene(seed, props, lamps);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'aerial.bin'), binary);
  writeFileSync(join(directory, 'aerial.gltf'), `${JSON.stringify(gltf)}\n`);
  process.stdout.write(
    `${scene}: ${counts.nodes} nodes, ${counts.source} source triangles, ` +
      `${counts.instanced} instanced triangles, ${lamps} lamps\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
