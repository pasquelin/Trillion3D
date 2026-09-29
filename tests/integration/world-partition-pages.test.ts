// The manifest held by the view on WebGL2 (#751). The synthetic worlds of `world-partition.test.ts`,
// compiled by this checkout's native compiler, are loaded as a WebGL2 world loads them
// (`loadModel`, `lazy`): the manifest's root and head, then the pages its node table needs; each
// cell placed holds the pages its meshes lie in, and the session mounts their meshes in place
// (`world-partition-pages.fixture.ts`). #750: the tables and the manifest read through the paged
// root give the scene the whole read gives. #404 on WebGL2: a zoom out to 0.5 and a parent scaled
// down leave no object missing, with no session reopened. And the pages leave with their cells.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Object3D } from '../../packages/sdk-core/src/world/object/object3d.ts';
import { absolutePrimitive } from '../../packages/sdk-browser/src/scene/absolutePrimitive.ts';
import { cellHoldings } from '../../packages/sdk-browser/src/scene/partition/cellPages.ts';
import { loadModel } from '../../packages/sdk-browser/src/world/core/loadedModel.ts';
import { createWorldPoses } from '../../packages/sdk-browser/src/world/core/worldPoses.ts';
import { compiled, compiler, machine, SPACING, world } from './world-partition.fixture.ts';
import { assertNoneMissing, cellRecords, followed } from './world-partition-pages.fixture.ts';

const skip = !existsSync(compiler);

/** `gltf` compiled under a folder of its own, served; `lazy` and whole loads of it. */
async function served(t: TestContext, gltf: ReturnType<typeof world>) {
  const root = await mkdtemp(join(tmpdir(), 'world-partition-pages-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pointer = await compiled(root, gltf);
  machine(t, pointer);
  return (lazy: boolean) => loadModel(pointer.href, { textureSource: 'host', scope: 'full', lazy });
}

/** A primitive as a world's session reads it, its addresses absolute. */
const asRead = (model: Awaited<ReturnType<typeof loadModel>>) =>
  model.record.metadata.primitives.map((primitive) =>
    absolutePrimitive(primitive, model.record.base),
  );

test(
  '#750: the tables and the manifest read through the paged root build the scene the whole read builds',
  { skip },
  async (t) => {
    // The district draws a mesh of its own: the node table needs its page at open.
    const district = world(96, 'district');
    (district.gltf.nodes.at(-1) as { mesh?: number }).mesh = 0;
    for (const gltf of [district, world(96)]) {
      const load = await served(t, gltf);
      const [whole, held] = [await load(false), await load(true)];
      const [cells, heldCells] = [whole, held].map((model) => model.record.scene.partitions[0]);
      assert.deepEqual(heldCells.pages, cells.pages, 'the same root, whichever manifest is read');
      assert.deepEqual(held.bounds, whole.bounds, 'the same scene, framed alike');
      const opened = new Set(held.record.metadata.primitives.map(({ mesh }) => mesh));
      assert.equal(opened.has(0), gltf === district, 'the core mesh is read at open');
      // Every cell's mesh pages held: the manifest lists what the whole read lists, byte for byte.
      const slots = (await cellRecords(heldCells.pages)).flatMap(({ meshPages }) => meshPages);
      await cellHoldings(heldCells).manifest.pages!.hold([...new Set(slots)]);
      const order = (a: { mesh: number }, b: { mesh: number }) => a.mesh - b.mesh;
      assert.deepEqual(asRead(held).sort(order), asRead(whole).sort(order));
    }
  },
);

test(
  '#404 on WebGL2: a zoom out to 0.5 leaves no object missing, and no session is reopened',
  { skip },
  async (t) => {
    const model = await (await served(t, world(96)))(true);
    const view = await followed(model, [48 * SPACING, 2, 48 * SPACING]);
    const before = await view.settle();
    const near = await assertNoneMissing(view);
    view.camera.zoom = 0.5;
    const after = await view.settle();
    const wider = await assertNoneMissing(view);
    t.diagnostic(JSON.stringify({ before, after, near, wider, ...view.engine.counts }));
    assert.ok(wider > near && after.held > before.held, 'the wider view holds more cells');
    assert.deepEqual([after.waiting, view.renewed.count], [0, 0]);
    assert.ok(view.engine.counts.mounts > 0, 'the meshes the view read were mounted in place');
  },
);

test(
  '#404 on WebGL2: a parent scaled down leaves no object missing, and no session is reopened',
  { skip },
  async (t) => {
    const model = await (await served(t, world(384, 'district')))(true);
    const view = await followed(model, [48 * SPACING, 2, 48 * SPACING]);
    const before = await view.settle();
    const scene = new Object3D();
    scene.add(model);
    const district = model.getObjectByName('district')!;
    district.scale.set(0.25, 0.25, 0.25);
    const poses = createWorldPoses();
    poses.moved(district);
    poses.apply(scene, new Map(), new Map(), () => {});
    const after = await view.settle();
    const near = await assertNoneMissing(view, 0.25);
    t.diagnostic(JSON.stringify({ before, after, near, ...view.engine.counts }));
    assert.ok(view.engine.counts.grown > 0 && after.held > before.held, 'rows grown in place');
    assert.deepEqual([after.waiting, view.renewed.count], [0, 0]);
  },
);

test(
  'the manifest pages leave with the cells that held them, and their meshes the session',
  { skip },
  async (t) => {
    const model = await (await served(t, world(96)))(true);
    const view = await followed(model, [48 * SPACING, 2, 48 * SPACING]);
    const { held } = await view.settle();
    const { metadata } = model.record;
    assert.ok(held > 0 && metadata.primitives.length > 0 && view.engine.drawn.size > 0);
    // The camera flies 100 km off: every cell leaves, and the pages with them.
    view.camera.position.set(-1e5, 2, -1e5);
    view.camera.updateMatrixWorld();
    const away = await view.settle();
    assert.deepEqual(
      [away.held, cellHoldings(view.cells).manifest.held(), metadata.primitives.length],
      [0, 0, 0],
    );
    assert.equal(view.engine.drawn.size, 0, 'the session unmounted every mesh they brought');
    // Back: the pages are read again and the meshes mounted again.
    view.camera.position.set(48 * SPACING, 2, 48 * SPACING);
    view.camera.updateMatrixWorld();
    await view.settle();
    assert.ok((await assertNoneMissing(view)) > 100);
  },
);
