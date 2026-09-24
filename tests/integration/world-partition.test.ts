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
import { SPACING, world } from './world-partition.fixture.ts';

const compiler = fileURLToPath(
  new URL('../../packages/asset-compiler-rust/target/release/trillion3d-compiler', import.meta.url),
);

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
