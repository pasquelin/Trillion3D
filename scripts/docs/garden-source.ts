/** Original procedural learning scene. No downloaded geometry, textures or engine assets. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { geometry, type Geometry } from '../../packages/sdk-core/src/world/geometry/index.ts';

interface GltfBufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  target: number;
}

interface GltfAccessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: 'VEC3' | 'SCALAR';
  min: number[];
  max: number[];
}

interface GltfMesh {
  name: string;
  primitives: {
    attributes: { POSITION: number; NORMAL: number };
    indices: number;
    material: number;
  }[];
}

interface GltfNode {
  name: string;
  mesh?: number;
  rotation?: number[];
  extensions?: { KHR_lights_punctual: { light: number } };
}

export async function writeGarden(directory: string) {
  const chunks: Buffer[] = [],
    views: GltfBufferView[] = [],
    accessors: GltfAccessor[] = [],
    meshes: GltfMesh[] = [],
    nodes: GltfNode[] = [];
  let byteLength = 0;
  function accessor(values: number[], size: number, target: number): number {
    const data = target === 34963 ? new Uint32Array(values) : new Float32Array(values);
    const bufferView = views.length;
    views.push({ buffer: 0, byteOffset: byteLength, byteLength: data.byteLength, target });
    chunks.push(Buffer.from(data.buffer));
    byteLength += data.byteLength;
    const min = Array(size).fill(Infinity),
      max = Array(size).fill(-Infinity);
    values.forEach((v, i) => {
      min[i % size] = Math.min(min[i % size], v);
      max[i % size] = Math.max(max[i % size], v);
    });
    accessors.push({
      bufferView,
      componentType: target === 34963 ? 5125 : 5126,
      count: values.length / size,
      type: size === 3 ? 'VEC3' : 'SCALAR',
      min,
      max,
    });
    return accessors.length - 1;
  }
  function surface(
    name: string,
    material: number,
    nu: number,
    nv: number,
    point: (u: number, v: number) => number[],
  ) {
    const positions: number[] = [],
      normals: number[] = [];
    const vertex = (u: number, v: number) => {
      const p = point(u, v),
        a = point(u + 0.0001, v),
        b = point(u, v + 0.0001);
      const x = a.map((n, i) => n - p[i]),
        y = b.map((n, i) => n - p[i]);
      const n = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
      const length = Math.hypot(...n) || 1;
      positions.push(...p);
      normals.push(...n.map((c) => c / length));
    };
    for (let u = 0; u < nu; u++)
      for (let v = 0; v < nv; v++) {
        for (const [a, b] of [
          [u, v],
          [u + 1, v],
          [u + 1, v + 1],
          [u, v],
          [u + 1, v + 1],
          [u, v + 1],
        ])
          vertex(a / nu, b / nv);
      }
    primitive(name, material, positions, normals);
  }
  /** An sdk-core geometry, unwelded to one vertex per triangle corner like the patches. */
  function shape(name: string, material: number, built: Geometry) {
    const { position, normal } = built.attributes,
      positions: number[] = [],
      normals: number[] = [];
    for (const i of built.index!.array)
      for (let k = 0; k < 3; k++) {
        positions.push(position.array[i * 3 + k]);
        normals.push(normal.array[i * 3 + k]);
      }
    primitive(name, material, positions, normals);
  }
  function primitive(name: string, material: number, positions: number[], normals: number[]) {
    const indices = accessor(
      Array.from({ length: positions.length / 3 }, (_, i) => i),
      1,
      34963,
    );
    const position = accessor(positions, 3, 34962),
      normal = accessor(normals, 3, 34962);
    meshes.push({
      name,
      primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices, material }],
    });
    nodes.push({ name, mesh: meshes.length - 1 });
  }
  const colors = [
    [0.1, 0.65, 0.57, 1],
    [0.36, 0.34, 0.85, 1],
    [0.96, 0.54, 0.24, 1],
    [0.12, 0.17, 0.24, 1],
  ];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) {
      const index = row * 3 + col;
      // A torus about z, its tube 24 slices round and 64 along the ring.
      shape(
        `Ring-${index + 1}`,
        index % 3,
        geometry.torus(0.92, 0.24, 24, 64).translate((col - 1) * 3.2, 1.45, (row - 1) * 3.2),
      );
    }
  surface('Wave-plinth', 3, 64, 64, (u, v) => [
    (u - 0.5) * 12,
    -0.1 + 0.08 * Math.cos(u * 30) * Math.sin(v * 30),
    (0.5 - v) * 12,
  ]);
  nodes.push({
    name: 'Garden-sun',
    rotation: [-0.3826834323650898, 0, 0, 0.9238795325112867],
    extensions: { KHR_lights_punctual: { light: 0 } },
  });
  const gltf = {
    extensionsUsed: ['KHR_lights_punctual'],
    extensions: {
      KHR_lights_punctual: {
        lights: [
          { name: 'Garden-sun', type: 'directional', color: [1, 0.94, 0.86], intensity: 2400 },
        ],
      },
    },
    asset: {
      version: '2.0',
      generator: 'Trillion3D original procedural garden v1',
      copyright: 'Trillion3D contributors; repository license',
    },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: colors.map((baseColorFactor, i) => ({
      name: ['Jade', 'Iris', 'Amber', 'Slate'][i],
      doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor, metallicFactor: 0.15, roughnessFactor: 0.4 },
    })),
    buffers: [{ uri: 'garden.bin', byteLength }],
    bufferViews: views,
    accessors,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'garden.bin'), Buffer.concat(chunks));
  await writeFile(resolve(directory, 'garden.gltf'), JSON.stringify(gltf));
}
if (process.argv[1] === import.meta.filename)
  await writeGarden(resolve(process.argv[2] ?? 'tests/fixtures/scenes/kinetic-garden/source'));
