// A large world opens on its partition's root alone, not on the world (#404, #575). A synthetic
// world laid out as the open world lays its own — flat scene roots, one node per placed instance
// of a handful of meshes (rocks, trees, houses), turned and scaled, a few lamps — is compiled by
// this checkout's native compiler at one and at sixteen times its area, same density. Each is then
// opened the way a page opens it: loaded into a world (`scene.load`), whose session is opened by
// the world runtime on the engine's own entry point (`openMeasuredWorld` → `prepareExplorer`),
// with a page camera of the open world's optics. Every byte and file fetched before the first frame
// is counted, and the rows the session sized are read from its `partition` diagnostic. Sixteen
// times the world costs the same bytes, no page of its cell index and no cell; the world itself
// weighs sixteen times more.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Camera } from '../../packages/sdk-core/src/world/camera/camera.ts';
import {
  assertTablePartition,
  tablePartition,
} from '../../packages/sdk-core/src/scene/core/tablePartition.ts';
import { pathToFileURL } from 'node:url';
import { cellRecords } from './world-partition-pages.fixture.ts';
import type { BackendDiagnostic } from '../../packages/sdk-browser/src/diagnostic/types.ts';
import { openMeasuredWorld } from '../../packages/sdk-browser/src/world/session/explorer.ts';
import { compiled, compiler, machine, SPACING, world } from './world-partition.fixture.ts';
import { openedWorld } from './world-runtime.fixture.ts';

type Stats = { pages: number; cells: number; held: number; rows: number };
type Primed = { cells: Stats[] };

/** The page's camera: 60°, a 300 m far plane, in the middle of the smaller world. */
function pageCamera() {
  const camera = new Camera('perspective', { fov: 60, near: 0.1, far: 300 });
  camera.position.set(48 * SPACING, 2, 48 * SPACING);
  return camera;
}

/** What the session read and sized before its first frame, as its diagnostic says it. */
function primedBy(into: { primed?: Primed }) {
  return (diagnostic: BackendDiagnostic) => {
    if (diagnostic.phase === 'partition') into.primed = diagnostic.context as Primed;
  };
}

/** Opens `pointer` in a world whose page draws from `pageCamera()`: the bytes and the files
 *  fetched and the rows sized before its first frame. The session draws that frame as it opens,
 *  before `opened`; a read it asks for settles later, so the count taken in `opened` holds none. */
async function openWorld(t: TestContext, pointer: URL) {
  const seen: { primed?: Primed; bytes?: number; urls?: readonly string[] } = {};
  await openedWorld(t, pointer, {
    camera: pageCamera(),
    options: { onDiagnostic: primedBy(seen) },
    opened: (read) => void ((seen.bytes = read.bytes), (seen.urls = [...read.urls])),
  });
  assert.ok(seen.bytes !== undefined && seen.urls && seen.primed, 'the session opened');
  return { bytes: seen.bytes, urls: seen.urls, ...seen.primed.cells[0] };
}

/** The bytes of every cell of the compiled world under `root`. */
async function cellsOf(root: string) {
  const folder = join(root, 'cache/native/full');
  const [key] = (await readdir(folder)).filter((name) => name !== 'manifest.json');
  const tables = JSON.parse(await readFile(join(folder, key, 'scene-tables.json'), 'utf8'));
  const base = pathToFileURL(join(folder, key, '/')).href;
  const { pages } = tablePartition(assertTablePartition(tables.partition)!);
  const cells = await cellRecords(pages.map(({ page }) => ({ url: new URL(page.url, base).href })));
  return { bytes: cells.reduce((sum, cell) => sum + cell.bytes, 0) };
}

test(
  'a world reads before its first frame the root of its partition alone, not the world',
  { skip: !existsSync(compiler) },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'world-partition-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const small = await openWorld(t, await compiled(join(root, 'small'), world(96)));
    t.mock.restoreAll();
    const large = await openWorld(t, await compiled(join(root, 'large'), world(384)));
    const whole = {
      small: await cellsOf(join(root, 'small')),
      large: await cellsOf(join(root, 'large')),
    };
    const { urls: _small, ...smallStats } = small;
    const { urls: _large, ...largeStats } = large;
    t.diagnostic(JSON.stringify({ small: smallStats, large: largeStats, whole }));
    assert.ok(whole.large.bytes > 12 * whole.small.bytes, 'the world is 16× larger');
    const partitioned = (url: string) => /scene-(page|cell)-/.test(url);
    assert.deepEqual(large.urls.filter(partitioned), [], 'no page of the index, no cell');
    assert.deepEqual(small.urls.filter(partitioned), []);
    assert.ok(
      large.bytes < 1.5 * small.bytes,
      `the first frame is not: ${small.bytes} → ${large.bytes} B`,
    );
    // The rows are sized at open from the root's totals: one per placed node, read nowhere else.
    assert.deepEqual([large.pages, large.cells, large.held], [0, 0, 0]);
    assert.deepEqual([small.rows, large.rows], [96 * 96, 384 * 384]);
  },
);

// At 16× the WebGL2 path opens on rows for every placement, which a spread argument list overflowed
// the stack on (`pages.ts`).
for (const side of [96, 384])
  test(
    `a bare explorer opens on the rows of the whole ${side}² scene, its root alone read`,
    { skip: !existsSync(compiler) },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), 'world-partition-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      const pointer = await compiled(root, world(side));
      const { canvas } = machine(t, pointer);
      const seen: { primed?: Primed } = {};
      const explorer = await openMeasuredWorld(canvas, {
        manifestUrl: pointer.href,
        scope: 'full',
        renderer: 'webgl2',
        onDiagnostic: primedBy(seen),
      });
      t.after(() => explorer.dispose());
      const [cells] = seen.primed!.cells;
      assert.deepEqual([cells.pages, cells.held, cells.rows], [0, 0, side * side]);
    },
  );
