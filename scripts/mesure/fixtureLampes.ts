#!/usr/bin/env node
// A tiny synthetic scene carrying its own lights: an enclosed room and two `KHR_lights_punctual`
// lights declared in the file. It serves as proof for the "light import from files" feature —
// no actual scene file is needed, geometry is calculated here.
//
//   node scripts/mesure/fixtureLampes.ts --out .mesure/fixture-lampes
//
// Writes `scene.gltf` and `scene.bin`. The native compiler reads it like any glTF.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from './options.ts';

/** The room: a hollow box with inward-facing normals, subdivided `n` times. */
function room(size: number, height: number, n: number) {
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = [];
  const half = size / 2;
  // Six faces: floor, ceiling, and four walls. Each is an `n × n` grid.
  const faces = [
    { origin: [-half, 0, -half], u: [size, 0, 0], v: [0, 0, size], normal: [0, 1, 0] },
    { origin: [-half, height, half], u: [size, 0, 0], v: [0, 0, -size], normal: [0, -1, 0] },
    { origin: [-half, 0, -half], u: [0, height, 0], v: [size, 0, 0], normal: [0, 0, 1] },
    { origin: [half, 0, half], u: [0, height, 0], v: [-size, 0, 0], normal: [0, 0, -1] },
    { origin: [-half, 0, half], u: [0, height, 0], v: [0, 0, -size], normal: [1, 0, 0] },
    { origin: [half, 0, -half], u: [0, height, 0], v: [0, 0, size], normal: [-1, 0, 0] },
  ];
  for (const face of faces) {
    const base = positions.length / 3;
    for (let row = 0; row <= n; row++)
      for (let column = 0; column <= n; column++) {
        const a = row / n,
          b = column / n;
        positions.push(
          face.origin[0] + face.u[0] * a + face.v[0] * b,
          face.origin[1] + face.u[1] * a + face.v[1] * b,
          face.origin[2] + face.u[2] * a + face.v[2] * b,
        );
        normals.push(...face.normal);
      }
    for (let row = 0; row < n; row++)
      for (let column = 0; column < n; column++) {
        const corner = base + row * (n + 1) + column;
        const next = corner + (n + 1);
        indices.push(corner, next, corner + 1, corner + 1, next, next + 1);
      }
  }
  return { positions, normals, indices };
}

/** The glTF and its binary: three accessors, one mesh, one node, two lights. */
function gltfOf(size: number, height: number, subdivisions: number, intensity: number) {
  const { positions, normals, indices } = room(size, height, subdivisions);
  const positionBytes = new Float32Array(positions),
    normalBytes = new Float32Array(normals),
    indexBytes = new Uint32Array(indices);
  const binary = Buffer.concat([
    Buffer.from(positionBytes.buffer),
    Buffer.from(normalBytes.buffer),
    Buffer.from(indexBytes.buffer),
  ]);
  const min = [-size / 2, 0, -size / 2],
    max = [size / 2, height, size / 2];
  const lamp = (name: string, color: [number, number, number]) => ({
    name,
    type: 'point',
    color,
    // In candela, as glTF requires. The compiler divides by the candela constant.
    intensity,
  });
  const gltf = {
    asset: { version: '2.0', generator: 'webGeometry fixtureLampes' },
    extensionsUsed: ['KHR_lights_punctual'],
    extensions: {
      KHR_lights_punctual: {
        lights: [lamp('lampe-chaude', [1, 0.72, 0.42]), lamp('lampe-froide', [0.42, 0.66, 1])],
      },
    },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2] }],
    nodes: [
      { name: 'piece', mesh: 0 },
      {
        name: 'noeud-lampe-chaude',
        translation: [-size / 4, height * 0.6, 0],
        extensions: { KHR_lights_punctual: { light: 0 } },
      },
      {
        name: 'noeud-lampe-froide',
        translation: [size / 4, height * 0.6, 0],
        extensions: { KHR_lights_punctual: { light: 1 } },
      },
    ],
    meshes: [
      {
        name: 'piece',
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
      },
    ],
    materials: [
      {
        name: 'platre',
        pbrMetallicRoughness: {
          baseColorFactor: [0.82, 0.8, 0.78, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: 'VEC3',
        min,
        max,
      },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength, target: 34962 },
      {
        buffer: 0,
        byteOffset: positionBytes.byteLength,
        byteLength: normalBytes.byteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: positionBytes.byteLength + normalBytes.byteLength,
        byteLength: indexBytes.byteLength,
        target: 34963,
      },
    ],
    buffers: [{ uri: 'scene.bin', byteLength: binary.byteLength }],
  };
  return { gltf, binary };
}

const flags = parseArgs(process.argv.slice(2));
const out = resolve(flags.get('out') ?? '.mesure/fixture-lampes');
const size = Number(flags.get('cote') ?? 8),
  height = Number(flags.get('hauteur') ?? 4),
  subdivisions = Number(flags.get('subdivisions') ?? 8),
  // Studio light: 68,300 cd equals exactly 100 W/sr after compiler conversion.
  intensity = Number(flags.get('candela') ?? 68300);
const { gltf, binary } = gltfOf(size, height, subdivisions, intensity);
await mkdir(out, { recursive: true });
await writeFile(join(out, 'scene.gltf'), JSON.stringify(gltf, null, 1));
await writeFile(join(out, 'scene.bin'), binary);
process.stdout.write(
  `${join(out, 'scene.gltf')} : ${gltf.accessors[2].count / 3} triangles, ${gltf.extensions.KHR_lights_punctual.lights.length} lampes\n`,
);
