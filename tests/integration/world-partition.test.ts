// A large world's first frame reads what its camera sees, not the world (#404). A synthetic world
// laid out as the open world lays its own — flat scene roots, one node per placed instance of a
// handful of meshes (rocks, trees, houses), turned and scaled, a few lamps — is compiled by this
// checkout's native compiler at one and at sixteen times its area, same density. Each is then
// prepared the way a session prepares it (`loadPreparedScene`), and the cells its first camera
// needs are read through the page streamer (`PartitionCells.prime`): every byte fetched before the
// first frame is counted. Sixteen times the world costs about the same bytes; the world itself
// weighs sixteen times more.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ClusterManifest } from '../../packages/sdk-core/src/index.ts';
import { loadPreparedScene } from '../../packages/sdk-browser/src/world/scene/scene.ts';
import { cellReach } from '../../packages/sdk-browser/src/scene/partition/plan.ts';
import { createPageStreamer } from '../../packages/sdk-browser/src/streaming/pages.ts';

const compiler = fileURLToPath(
  new URL('../../packages/asset-compiler-rust/target/release/trillion3d-compiler', import.meta.url),
);

/** Three meshes of the open world's kinds, a box each: side and height in metres. */
const KINDS = [
  { name: 'rock', side: 1, height: 0.8 },
  { name: 'tree', side: 3, height: 9 },
  { name: 'house', side: 8, height: 6 },
];
/** Metres between two placements. */
const SPACING = 24;

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
function world(side: number) {
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

/** Compiles a `side`² world under `root`; returns its key folder. */
async function compiled(root: string, side: number) {
  const source = join(root, 'source');
  await mkdir(source, { recursive: true });
  const { gltf, bin } = world(side);
  await writeFile(join(source, 'world.gltf'), JSON.stringify(gltf));
  await writeFile(join(source, 'world.bin'), bin);
  execFileSync(
    compiler,
    ['source', 'cache', 'full', '150000', '2', '256', '../../../../source/', 'none'],
    {
      cwd: root,
      stdio: 'ignore',
    },
  );
  const full = join(root, 'cache/native/full/');
  const { key } = JSON.parse(await readFile(join(full, 'manifest.json'), 'utf8')) as {
    key: string;
  };
  return pathToFileURL(join(full, key, '/'));
}

/** Serves files from disk and counts every byte fetched. */
function served(t: TestContext) {
  const read = { bytes: 0 };
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const body = await readFile(
      fileURLToPath(input instanceof Request ? input.url : String(input)),
    );
    read.bytes += body.byteLength;
    return new Response(body);
  });
  return read;
}

/** What a session reads before its first frame, from the middle of the smaller world, a
 *  camera of the open world's optics: 60° at 1080 pixels, a 300 m far plane, 1 px of error. */
async function firstFrame(t: TestContext, folder: URL) {
  const read = served(t);
  const scene = await loadPreparedScene(
    { manifestUrl: '', textureSource: 'host' },
    { primitives: [] } as unknown as ClusterManifest,
    'source.gltf',
    folder.href,
    'full',
    false,
    undefined,
    () => {},
    () => {},
  );
  const [cells] = scene.partitions;
  assert.ok(cells, 'the world is partitioned');
  const streamer = createPageStreamer(cells.pages, folder.href);
  const optics = { fov: 60, aspect: 16 / 9, far: 300 };
  const reach = (size: number) => cellReach(size, optics, 1080, 1);
  const eye = [48 * SPACING, 2, 48 * SPACING];
  await cells.prime(eye, reach, (url) => streamer.readBytes(url));
  const all = cells.pages.reduce((sum, page) => sum + page.bytes, 0);
  return { bytes: read.bytes, cells: all, held: cells.stats().held };
}

test(
  'the bytes a world reads before its first frame are bounded by the view, not by its size',
  { skip: !existsSync(compiler) },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'world-partition-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const small = await firstFrame(t, await compiled(join(root, 'small'), 96));
    t.mock.restoreAll();
    const large = await firstFrame(t, await compiled(join(root, 'large'), 384));
    assert.ok(
      large.cells > 12 * small.cells,
      `the world is 16× larger: ${small.cells} → ${large.cells} B`,
    );
    assert.ok(
      large.bytes < 1.5 * small.bytes,
      `the first frame is not: ${small.bytes} → ${large.bytes} B`,
    );
    assert.ok(large.bytes < large.cells / 4, 'a fraction of the world');
    t.diagnostic(JSON.stringify({ small, large }));
  },
);
