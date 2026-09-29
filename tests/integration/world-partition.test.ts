// A large world's first frame reads what its page's camera reaches, not the world (#404, #575). A
// synthetic world laid out as the open world lays its own — flat scene roots, one node per placed
// instance of a handful of meshes (rocks, trees, houses), turned and scaled, a few lamps — is
// compiled by this checkout's native compiler at one and at sixteen times its area, same density.
// Each is then opened the way a page opens it: loaded into a world (`scene.load`), whose session
// is opened by the world runtime on the engine's own entry point (`openMeasuredWorld` →
// `prepareExplorer`), with a page camera of the open world's optics. Every byte and file fetched
// before the first frame is counted, and the rows the session sized are read from its `partition`
// diagnostic. Sixteen times the world costs about the same bytes and rows, those of the view: the
// root, the pages of the cell index on the camera's way and the cells it reaches; the world itself
// weighs sixteen times more.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Camera } from '../../packages/sdk-core/src/world/camera/camera.ts';
import {
  assertTablePartition,
  tablePartition,
} from '../../packages/sdk-core/src/scene/core/tablePartition.ts';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cellRecords } from './world-partition-pages.fixture.ts';
import type { BackendDiagnostic } from '../../packages/sdk-browser/src/diagnostic/types.ts';
import { cellReach, KEEP } from '../../packages/sdk-browser/src/scene/partition/plan.ts';
import { openMeasuredWorld } from '../../packages/sdk-browser/src/world/session/explorer.ts';
import { compiled, compiler, machine, SPACING, world } from './world-partition.fixture.ts';
import { openedWorld } from './world-runtime.fixture.ts';

type Stats = { pages: number; cells: number; held: number; rows: number };
type Primed = { bytes: number; cells: Stats[] };

/** The page's camera: 60°, a 300 m far plane, in the middle of the smaller world; the canvas
 *  stand-in is 16:9. */
const REACH = cellReach({ fov: 60, aspect: 16 / 9, near: 0.1, far: 300, zoom: 1 });
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

/** The bytes of every cell of the compiled world under `root`, and the widest cell's side. */
async function cellsOf(root: string) {
  const folder = join(root, 'cache/native/full');
  const [key] = (await readdir(folder)).filter((name) => name !== 'manifest.json');
  const tables = JSON.parse(await readFile(join(folder, key, 'scene-tables.json'), 'utf8'));
  const base = pathToFileURL(join(folder, key, '/')).href;
  const { pages } = tablePartition(assertTablePartition(tables.partition)!);
  const cells = await cellRecords(pages.map(({ page }) => ({ url: new URL(page.url, base).href })));
  const boxes = await Promise.all(
    cells.map(async ({ url }) => {
      const nodes = JSON.parse(await readFile(fileURLToPath(url), 'utf8')).nodes;
      const xs = nodes.map((node: { translation: number[] }) => node.translation[0]);
      const zs = nodes.map((node: { translation: number[] }) => node.translation[2]);
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    }),
  );
  const widest = Math.max(...boxes) + 2 * SPACING; // the placements' own size, at most a spacing
  return { bytes: cells.reduce((sum, cell) => sum + cell.bytes, 0), widest, count: cells.length };
}

test(
  'a world reads and sizes before its first frame what its page camera reaches, not the world',
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
    // The first frame draws what the camera reaches: pages on its way and those cells, read.
    const partitioned = (url: string) => /scene-(page|cell)-/.test(url);
    assert.ok(large.held > 0 && large.urls.some(partitioned), 'the cells the camera reaches');
    assert.ok(large.held < whole.large.count, 'the cells past the far plane are not read');
    assert.ok(
      large.bytes < 1.5 * small.bytes,
      `the first frame is not: ${small.bytes} → ${large.bytes} B`,
    );
    assert.ok(large.bytes < whole.large.bytes / 4, 'a fraction of the world');
    // The world's other files, each by kind: the page codec is fetched once per process, by the
    // first session alone, and is no part of the world. They differ by a few digits of the
    // numbers the cook writes, never by the cells.
    const files = async (urls: readonly string[]) => {
      const sizes: Record<string, number> = {};
      for (const url of new Set(urls.filter((u) => !u.endsWith('.wasm') && !partitioned(u)))) {
        const kind = url
          .split('/')
          .at(-1)!
          .replace(/-[0-9a-f]{64}/, '');
        sizes[kind] = (sizes[kind] ?? 0) + (await stat(fileURLToPath(url))).size;
      }
      return sizes;
    };
    const [before, after] = [await files(small.urls), await files(large.urls)];
    t.diagnostic(JSON.stringify({ before, after }));
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'the same files');
    const sum = (sizes: Record<string, number>) => Object.values(sizes).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum(after) - sum(before)) < 0.01 * sum(before), 'the same core');
    // The rows are sized at open for what the view can hold (`sizing.ts`): under the scene root, a
    // cube of side 2·reach·(1 + KEEP), rounded up to a rung (√2, the first one the widest cell's
    // diagonal) and widened to its window (1.5), plus the cells that meet it — a bound set by the
    // reach and the cells' size, not by the world.
    const rung = Math.max(Math.SQRT2 * 2 * REACH * (1 + KEEP), 2 * whole.large.widest);
    const window = 1.5 * rung + 2 * whole.large.widest;
    assert.ok(large.rows <= (window / SPACING + 1) ** 2, `rows: ${small.rows} → ${large.rows}`);
    assert.ok(large.rows < (384 * 384) / 4, 'the rows hold a part of the larger world');
    assert.ok(small.rows <= 96 * 96, 'no more than the world');
  },
);

// At 16× the framing camera holds every placement: the WebGL2 path shows its whole bootstrap at
// once, which a spread argument list overflowed the stack on (`pages.ts`).
for (const side of [96, 384])
  test(
    `a bare explorer, with no page camera, reads for its framing camera: the whole ${side}² scene`,
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
      assert.deepEqual([cells.held, cells.rows], [cells.cells, side * side]);
      assert.ok(cells.pages > 0, 'the pages of the index read on its way');
    },
  );
