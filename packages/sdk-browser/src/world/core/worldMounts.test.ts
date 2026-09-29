// #572: a batch the session was not opened with reopened it (floating-crates' water, every frame,
// drew only the clear colour); it is now mounted in the open session, and unmounted once vacant.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { PlacementMount } from '../../placement/backendSceneUpdates.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import type { ExplorerSource } from '../session/prepare.ts';
import { listenWorldNotices } from '../diagnostic/worldNotices.ts';
import { Scene } from './scene.ts';
import {
  runtimeOf,
  sessionStandIn,
  takeContentReopens,
  type Open,
} from './worldRuntime.fixture.ts';

/** A session that mounts, unmounts and grows rows in place — each growth it `takes` —, each mount
 *  drawn `late` frames after it is asked (`frame` moves them on), and the rows it draws with the
 *  frame that mounted them. */
function mountingSession(late: number, takes = true) {
  const { session } = sessionStandIn();
  const drawn = new Map<PlacementRows, number>();
  const pending: { at: number; done: () => void }[] = [];
  let opened = 0,
    mounts = 0,
    grown = 0,
    rewrites = 0,
    now = 0;
  Object.assign(session, {
    growsPlacements: () => true,
    growsInPlace: () => takes,
    growPlacements: (from: PlacementRows, to: PlacementRows) => (
      grown++,
      drawn.set(to, drawn.get(from)!)
    ),
    mountsPlacements: () => true,
    mountPlacements: ({ association }: PlacementMount) =>
      new Promise<void>((done) => {
        mounts++;
        pending.push({
          at: now + late,
          done: () => (drawn.set(association.placements, now), done()),
        });
      }),
    unmountPlacements: (rows: PlacementRows) => drawn.delete(rows),
    updateVertices: () => ++rewrites > 0,
  });
  const open = (async (_canvas: unknown, _options: unknown, source: ExplorerSource) => {
    opened++;
    for (const link of source.scene.associations.values())
      if (link.placements) drawn.set(link.placements, -1);
    return session;
  }) as unknown as Open;
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
      for (const flag of placed.live) {
        rows += flag;
        if (flag) newest = Math.max(newest, at);
      }
    return { rows, newest };
  };
  return {
    open,
    drawn,
    frame,
    live,
    opened: () => opened,
    mounts: () => mounts,
    grown: () => grown,
    rewrites: () => rewrites,
  };
}

test('a growth the session refuses leaves its rows as they are, and a session sized for it opens', async () => {
  for (const takes of [true, false]) {
    const scene = new Scene(() => Promise.reject(new Error('no loader')));
    const { open, opened, grown } = mountingSession(0, takes);
    const runtime = runtimeOf(
      scene,
      Promise.resolve(),
      (error) => assert.fail(String(error)),
      open,
    );
    const box = geometry.box(1, 1, 1),
      stone = material.meshStandard({ color: 0x808080 });
    scene.add(object.mesh(box, stone));
    await runtime.settled();
    runtime.render();
    // A second crate of the same box and stone: one more row of the batch the session holds.
    scene.add(object.mesh(box, stone));
    for (let frame = 0; frame < 4; frame++) {
      await runtime.settled();
      runtime.render();
    }
    runtime.dispose();
    assert.deepEqual([grown(), opened()], takes ? [1, 1] : [0, 2]);
    // Refused, the growth takes today's path: one reopen, the one this test asks for.
    assert.equal(takeContentReopens().length, takes ? 0 : 1);
  }
});

test('1 000 frames adding and removing a mesh and replacing a geometry never open the session again', async () => {
  const scene = new Scene(() => Promise.reject(new Error('no loader')));
  const { open, drawn, frame: tick, live, opened, mounts, rewrites } = mountingSession(2);
  const runtime = runtimeOf(scene, Promise.resolve(), (error) => assert.fail(String(error)), open);
  const reopens: unknown[] = [];
  const stop = listenWorldNotices((n) => void (n.phase === 'session-reopen' && reopens.push(n)));
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
    // The ground and the water always drawn, a crate beside them once mounted; the water, rewritten
    // every frame, turns dynamic and is rewritten in place from then on (#573).
    assert.ok(live().rows >= 2 && live().rows <= 3, `frame ${frame}: ${live().rows} rows drawn`);
  }
  runtime.dispose();
  await new Promise(setImmediate);
  stop();
  assert.deepEqual(reopens, [], 'no session-reopen said (#837)');
  assert.equal(opened(), 1, 'one session for every mesh and every geometry');
  assert.ok(mounts() >= 51, `${mounts()} mounts: the crates', the water's dynamic one`);
  assert.ok(rewrites() >= 990, `${rewrites()} rewrites of the water in place`);
  assert.equal(imageless, 0, 'no frame without an image');
  assert.ok(drawn.size <= 6, `${drawn.size} resources left mounted: the others are unmounted`);
});
