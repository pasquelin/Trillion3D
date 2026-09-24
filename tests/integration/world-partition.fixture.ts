// A synthetic world laid out as the open world lays its own (#404): flat scene roots, one node per
// placed instance of a handful of meshes — rocks, trees, houses —, turned and scaled, and a few
// lamps. `world-partition.test.ts` compiles it at two sizes.

/** Three meshes of the open world's kinds, a box each: side and height in metres. */
const KINDS = [
  { name: 'rock', side: 1, height: 0.8 },
  { name: 'tree', side: 3, height: 9 },
  { name: 'house', side: 8, height: 6 },
];
/** Metres between two placements. */
export const SPACING = 24;

/** A closed box of `side` × `height` × `side`, eight corners and twelve triangles. */
function box(side: number, height: number) {
  const h = side / 2;
  const positions = new Float32Array([
    -h,
    0,
    -h,
    h,
    0,
    -h,
    h,
    0,
    h,
    -h,
    0,
    h,
    -h,
    height,
    -h,
    h,
    height,
    -h,
    h,
    height,
    h,
    -h,
    height,
    h,
  ]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
    4, 3, 4, 7,
  ]);
  return { positions, indices, min: [-h, 0, -h], max: [h, height, h] };
}

/** The glTF of a `side`² world and its binary. */
export function world(side: number) {
  const chunks: Uint8Array[] = [];
  const views: object[] = [],
    accessors: object[] = [];
  let offset = 0;
  const view = (bytes: Uint8Array) => {
    chunks.push(bytes, new Uint8Array((4 - (bytes.byteLength % 4)) % 4));
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
    offset += bytes.byteLength + ((4 - (bytes.byteLength % 4)) % 4);
    return views.length - 1;
  };
  const meshes = KINDS.map(({ name, side: width, height }) => {
    const { positions, indices, min, max } = box(width, height);
    const at = accessors.length;
    accessors.push(
      {
        bufferView: view(new Uint8Array(positions.buffer)),
        componentType: 5126,
        count: 8,
        type: 'VEC3',
        min,
        max,
      },
      {
        bufferView: view(new Uint8Array(indices.buffer)),
        componentType: 5123,
        count: 36,
        type: 'SCALAR',
      },
    );
    return { name, primitives: [{ attributes: { POSITION: at }, indices: at + 1 }] };
  });
  const nodes: object[] = [];
  for (let i = 0; i < side * side; i++) {
    const yaw = (i * 2.399963) % (2 * Math.PI),
      scale = 0.75 + ((i * 7) % 10) / 20;
    nodes.push({
      name: `${KINDS[i % 3].name} ${i}`,
      mesh: i % 3,
      translation: [(i % side) * SPACING, 0, Math.floor(i / side) * SPACING],
      rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
      scale: [scale, scale, scale],
    });
  }
  for (let lamp = 0; lamp < 16; lamp++)
    nodes.push({
      name: `lamp ${lamp}`,
      translation: [(lamp % 4) * side * 6, 4, Math.floor(lamp / 4) * side * 6],
      extensions: { KHR_lights_punctual: { light: 0 } },
    });
  const bin = Buffer.concat(chunks);
  const gltf = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_lights_punctual'],
    extensions: { KHR_lights_punctual: { lights: [{ type: 'point', range: 20 }] } },
    buffers: [{ uri: 'world.bin', byteLength: bin.byteLength }],
    bufferViews: views,
    accessors,
    meshes,
    nodes,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    scene: 0,
  };
  return { gltf, bin };
}
