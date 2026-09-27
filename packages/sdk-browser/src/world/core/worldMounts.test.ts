// #572: a mesh of a geometry or a material the session was not opened with made its batch wait,
// and a waiting batch opened the session again: on floating-crates, whose water is written every
// frame, every frame opened one, and drew only the clear colour meanwhile. A new batch is now
// mounted in the open session, and one no mesh draws is unmounted from it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { PlacementMount } from '../../placement/backendSceneUpdates.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import { Scene } from './scene.ts';
import { runtimeOf, sessionStandIn, type Open } from './worldRuntime.fixture.ts';

/** A session that mounts, unmounts and grows rows in place, each mount drawn `late` frames after
 *  it is asked (`frame` moves them on), and the rows it draws with the frame that mounted them. */
function mountingSession(late: number) {
  const { session } = sessionStandIn();
  const drawn = new Map<PlacementRows, number>();
  const pending: { at: number; done: () => void }[] = [];
  let opened = 0,
    mounts = 0,
    now = 0;
  Object.assign(session, {
    growsPlacements: () => true,
    growPlacements: (from: PlacementRows, to: PlacementRows) => drawn.set(to, drawn.get(from)!),
    mountsPlacements: () => true,
    mountPlacements: ({ association }: PlacementMount) =>
      new Promise<void>((done) => {
        mounts++;
        pending.push({ at: now + late, done: () => (drawn.set(association.placements, now), done()) });
      }),
    unmountPlacements: (rows: PlacementRows) => drawn.delete(rows),
  });
  const open = (async (_canvas, _options, source) => {
    opened++;
    for (const link of source.scene.associations.values())
      if (link.placements) drawn.set(link.placements, -1);
    return session;
  }) as Open;
  const frame = (at: number) => {
    now = at;
    for (const mount of pending.filter((mount) => mount.at <= at)) mount.done();
    pending.splice(0, pending.length, ...pending.filter((mount) => mount.at > at));
  };
  /** The rows drawn now, and the newest frame a drawn row was mounted at. */
  const live = () => {
    let rows = 0,
      newest = -1;
    for (const [placed, at] of drawn)
      for (const flag of placed.live) if (flag) (rows++, (newest = Math.max(newest, at)));
    return { rows, newest };
  };
  return { open, drawn, frame, live, opened: () => opened, mounts: () => mounts };
}

test('1 000 frames adding and removing a mesh and replacing a geometry never open the session again', async () => {
  const scene = new Scene(() => Promise.reject(new Error('no loader')));
  const { open, drawn, frame: tick, live, opened, mounts } = mountingSession(2);
  const runtime = runtimeOf(scene, Promise.resolve(), (error) => assert.fail(String(error)), open);
  const stone = material.meshStandard({ color: 0x808080 });
  scene.add(object.mesh(geometry.box(4, 0.2, 4), stone));
  const sheet = geometry.plane(4, 4, 2, 2);
  const water = object.mesh(sheet, material.meshStandard({ color: 0x1d6d8c }));
  scene.add(water);
  await runtime.settled();
  let crate: Mesh | null = null,
    imageless = 0;
  for (let frame = 0; frame < 1000; frame++) {
    tick(frame);
    if (frame % 10 === 0 && crate) {
      scene.remove(crate);
      crate = null;
    } else if (frame % 10 === 0) {
      crate = object.mesh(geometry.box(1 + frame / 1000, 1, 1), stone);
      scene.add(crate);
    }
    const position = sheet.attributes.position;
    for (let v = 0; v < position.count; v++) position.setY(v, Math.sin(frame + v) * 0.1);
    position.needsUpdate = true;
    await runtime.settled();
    if (!runtime.render()) imageless++;
    // The ground and the water always drawn, a crate beside them once mounted, and the water on a
    // geometry at most a few frames old: a mesh rewritten faster than it mounts shows each mount.
    const { rows, newest } = live();
    assert.ok(rows >= 2 && rows <= 3, `frame ${frame}: ${rows} rows drawn`);
    if (frame > 10) assert.ok(newest >= frame - 6, `frame ${frame}: newest mount ${newest}`);
  }
  runtime.dispose();
  assert.equal(opened(), 1, 'one session for every mesh and every geometry');
  assert.ok(mounts() >= 300, `${mounts()} mounts: the water's geometries, the crates'`);
  assert.equal(imageless, 0, 'no frame without an image');
  assert.ok(drawn.size <= 6, `${drawn.size} resources left mounted: the others are unmounted`);
});
