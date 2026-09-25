// A synthetic world laid out as the open world lays its own (#404): flat scene roots, one node per
// placed instance of a handful of meshes — rocks, trees, houses —, turned and scaled, and a few
// lamps. `world-partition.test.ts` compiles it at two sizes and opens it the way a page does, on
// a machine stand-in: every byte fetched is counted, and the GPU is a context that answers all.
import type { TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const compiler = fileURLToPath(
  new URL('../../packages/asset-compiler-rust/target/release/trillion3d-compiler', import.meta.url),
);

/** Compiles `gltf` under `root` with this checkout's native compiler; returns its pointer file. */
export async function compiled(root: string, { gltf, bin }: { gltf: object; bin: Buffer }) {
  const source = join(root, 'source');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'world.gltf'), JSON.stringify(gltf));
  await writeFile(join(source, 'world.bin'), bin);
  const args = ['source', 'cache', 'full', '150000', '2', '256', '../../../../source/', 'none'];
  execFileSync(compiler, args, { cwd: root, stdio: 'ignore' });
  return pathToFileURL(join(root, 'cache/native/full/manifest.json'));
}

/** Serves files from disk to `fetch`, the page's location at `pointer`, and a WebGL2 context
 *  stand-in to any canvas; `read.bytes` counts every byte fetched. */
export function machine(t: TestContext, pointer: URL) {
  const read = { bytes: 0 };
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = await readFile(fileURLToPath(url));
    read.bytes += body.byteLength;
    const type = /\.(json|gltf)$/.test(url) ? 'application/json' : 'application/octet-stream';
    return new Response(body, { headers: { 'content-type': type } });
  });
  const canvas = { nodeName: 'CANVAS', width: 1600, height: 900, style: {} } as Record<
    string,
    unknown
  >;
  const answers: Record<string, unknown> = {
    then: undefined, // not a promise
    isContextLost: () => false,
    getSupportedExtensions: () => [],
    getExtension: () => null,
    checkFramebufferStatus: () => 1, // every constant is 1: complete
    canvas,
  };
  const gl = new Proxy(answers, {
    get: (_, key: string) =>
      key in answers ? answers[key] : /^[A-Z_0-9]+$/.test(key) ? 1 : () => ({}),
  });
  Object.assign(canvas, { getContext: () => gl, addEventListener() {}, removeEventListener() {} });
  for (const [name, value] of Object.entries({
    location: { href: pointer.href },
    document: { createElement: () => canvas },
  })) {
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => Reflect.deleteProperty(globalThis, name));
  }
  return { read, canvas: canvas as unknown as HTMLCanvasElement };
}

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
  // A lit surface carries normals: every corner's is up, all the proof reads is its bytes.
  const normals = new Float32Array(24).map((_, at) => (at % 3 === 1 ? 1 : 0));
  return { positions, normals, indices, min: [-h, 0, -h], max: [h, height, h] };
}

/** The glTF of a `side`² world and its binary; `district` hangs every placement under one scene
 *  root of that name instead of laying them flat. */
export function world(side: number, district?: string) {
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
    const { positions, normals, indices, min, max } = box(width, height);
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
      {
        bufferView: view(new Uint8Array(normals.buffer)),
        componentType: 5126,
        count: 8,
        type: 'VEC3',
      },
    );
    const attributes = { POSITION: at, NORMAL: at + 2 };
    return { name, primitives: [{ attributes, indices: at + 1 }] };
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
  const placements = side * side;
  if (district)
    nodes.push({ name: district, children: Array.from({ length: placements }, (_, i) => i) });
  const roots = nodes.map((_, i) => i).filter((i) => !district || i >= placements);
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
    scenes: [{ nodes: roots }],
    scene: 0,
  };
  return { gltf, bin };
}
