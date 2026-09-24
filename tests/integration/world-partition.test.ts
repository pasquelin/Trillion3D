// A large world's first frame reads what its page's camera sees, not the world (#404). A synthetic
// world laid out as the open world lays its own — flat scene roots, one node per placed instance
// of a handful of meshes (rocks, trees, houses), turned and scaled, a few lamps — is compiled by
// this checkout's native compiler at one and at sixteen times its area, same density. Each is then
// opened the way a page opens it: loaded into a world (`scene.load`), whose session is opened by
// the world runtime on the engine's own entry point (`openMeasuredWorld` → `prepareExplorer`),
// with a page camera of the open world's optics. Every byte fetched before the first frame is
// counted, and the rows the session sized are read from its `partition` diagnostic. Sixteen times
// the world costs about the same bytes; the world itself weighs sixteen times more.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Camera } from '../../packages/sdk-core/src/world/camera/camera.ts';
import type { BackendDiagnostic } from '../../packages/sdk-browser/src/diagnostic/types.ts';
import { cellReach, KEEP } from '../../packages/sdk-browser/src/scene/partition/plan.ts';
import { Scene } from '../../packages/sdk-browser/src/world/core/scene.ts';
import { worldModelLoader } from '../../packages/sdk-browser/src/world/core/worldLoader.ts';
import { createWorldRuntime } from '../../packages/sdk-browser/src/world/core/worldRuntime.ts';
import { createWorldNotices } from '../../packages/sdk-browser/src/world/diagnostic/worldNotices.ts';
import { openMeasuredWorld } from '../../packages/sdk-browser/src/world/session/explorer.ts';
import { compiled, compiler, machine, SPACING, world } from './world-partition.fixture.ts';

type Primed = { bytes: number; cells: { cells: number; held: number; rows: number }[] };

/** The page's camera: 60°, a 300 m far plane, in the middle of the smaller world; the canvas
 *  stand-in is 16:9. */
const REACH = cellReach({ fov: 60, aspect: 16 / 9, far: 300 });
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

/** Opens `pointer` in a world whose page draws from `pageCamera()`: the bytes fetched and the rows
 *  sized before its first frame. The session draws that frame as it opens, before `opened`; a
 *  read it asks for settles later, so the count taken in `opened` holds none of them. */
async function openWorld(t: TestContext, pointer: URL) {
  const { read, canvas } = machine(t, pointer);
  const seen: { primed?: Primed; bytes?: number; failure?: unknown } = {};
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, undefined, () => 'webgl2'));
  const camera = pageCamera();
  const runtime = createWorldRuntime({
    canvas,
    scene,
    ready: () => ready,
    camera: () => camera,
    options: () => ({ manifestUrl: '', renderer: 'webgl2', onDiagnostic: primedBy(seen) }),
    opened: () => void (seen.bytes = read.bytes),
    frame: () => {},
    drawn: () => false,
    display: () => ({ exposure: 1, toneMapping: 'aces' }),
    diagnostic: { notices: createWorldNotices(), failed: (e) => (seen.failure = e), opening() {} },
  });
  t.after(() => runtime.dispose());
  await scene.load(pointer.href);
  await runtime.settled();
  assert.ok(seen.bytes !== undefined && seen.primed, `the session opened: ${String(seen.failure)}`);
  return { bytes: seen.bytes, ...seen.primed.cells[0] };
}

/** The bytes of every cell of the compiled world under `root`, and the widest cell's side. */
async function cellsOf(root: string) {
  const folder = join(root, 'cache/native/full');
  const [key] = (await readdir(folder)).filter((name) => name !== 'manifest.json');
  const tables = JSON.parse(await readFile(join(folder, key, 'scene-tables.json'), 'utf8'));
  type Cell = { bytes: number; parents: [null, number[]][] };
  const cells: Cell[] = tables.partition.cells;
  const side = (b: number[]) => Math.max(b[3] - b[0], b[5] - b[2]);
  const widest = Math.max(...cells.map((cell) => side(cell.parents[0][1])));
  return { bytes: cells.reduce((sum, cell) => sum + cell.bytes, 0), widest };
}

test(
  'a world reads and sizes before its first frame what its page camera sees, not the world',
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
    t.diagnostic(JSON.stringify({ small, large, whole }));
    assert.ok(whole.large.bytes > 12 * whole.small.bytes, 'the world is 16× larger');
    assert.ok(
      large.bytes < 1.5 * small.bytes,
      `the first frame is not: ${small.bytes} → ${large.bytes} B`,
    );
    assert.ok(large.bytes < whole.large.bytes / 4, 'a fraction of the world');
    assert.ok(large.held < large.cells, 'the cells past the far plane are not read');
    // The rows are sized at open for every placement the reach can hold at once. Two cells held
    // together are within 2·reach·(1 + KEEP) of each other, so every row counted lies in a square
    // of side 3·widest + 4·reach·(1 + KEEP): a bound set by the reach and the cells' size, not by
    // the world.
    const square = 3 * whole.large.widest + 4 * REACH * (1 + KEEP);
    assert.ok(large.rows <= (square / SPACING) ** 2, `rows: ${small.rows} → ${large.rows}`);
    assert.ok(large.rows < (384 * 384) / 1.5, 'the rows hold a part of the larger world');
  },
);

test(
  'a bare explorer, with no page camera, reads for its framing camera: the whole scene',
  { skip: !existsSync(compiler) },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'world-partition-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const pointer = await compiled(root, world(96));
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
    assert.deepEqual([cells.held, cells.rows], [cells.cells, 96 * 96]);
  },
);
