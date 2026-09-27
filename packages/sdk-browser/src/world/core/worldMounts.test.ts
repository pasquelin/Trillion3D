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

/** A session that mounts, unmounts and grows rows in place, and the rows it draws. */
function mountingSession() {
  const { session } = sessionStandIn();
  const drawn = new Set<PlacementRows>();
  let opened = 0,
    mounts = 0;
  Object.assign(session, {
    growsPlacements: () => true,
    growPlacements: (from: PlacementRows, to: PlacementRows) => drawn.delete(from) && drawn.add(to),
    mountsPlacements: () => true,
    mountPlacements: async ({ association }: PlacementMount) => {
      mounts++;
      drawn.add(association.placements);
    },
    unmountPlacements: (rows: PlacementRows) => drawn.delete(rows),
  });
  const open = (async (_canvas, _options, source) => {
    opened++;
    for (const link of source.scene.associations.values())
      if (link.placements) drawn.add(link.placements);
    return session;
  }) as Open;
  /** The rows drawn now: each a placement on screen. */
  const live = () => [...drawn].reduce((n, rows) => n + rows.live.reduce((a, b) => a + b, 0), 0);
  return { open, drawn, live, opened: () => opened, mounts: () => mounts };
}

test('1 000 frames adding and removing a mesh and replacing a geometry never open the session again', async () => {
  const scene = new Scene(() => Promise.reject(new Error('no loader')));
  const { open, drawn, live, opened, mounts } = mountingSession();
  const runtime = runtimeOf(scene, Promise.resolve(), (error) => assert.fail(String(error)), open);
  const stone = material.meshStandard({ color: 0x808080 });
  scene.add(object.mesh(geometry.box(4, 0.2, 4), stone));
  const sheet = geometry.plane(4, 4, 2, 2);
  const water = object.mesh(sheet, material.meshStandard({ color: 0x1d6d8c }));
  scene.add(water);
  await runtime.settled();
  let crate: Mesh | null = null,
    since = 0,
    imageless = 0;
  for (let frame = 0; frame < 1000; frame++) {
    if (frame % 10 === 0 && crate) {
      scene.remove(crate);
      crate = null;
    } else if (frame % 10 === 0) {
      crate = object.mesh(geometry.box(1 + frame / 1000, 1, 1), stone);
      scene.add(crate);
      since = frame;
    }
    const position = sheet.attributes.position;
    for (let v = 0; v < position.count; v++) position.setY(v, Math.sin(frame + v) * 0.1);
    position.needsUpdate = true;
    await runtime.settled();
    if (!runtime.render()) imageless++;
    // Every mesh on screen a frame ago is on screen: the ground, the water, and a crate once its
    // own resource is mounted — the mount settles, then the next resolution seats it.
    const shown = 2 + (crate && frame - since > 2 ? 1 : 0);
    assert.ok(live() >= shown && live() <= 3, `frame ${frame}: ${live()} rows drawn, ${shown} due`);
  }
  runtime.dispose();
  assert.equal(opened(), 1, 'one session for every mesh and every geometry');
  assert.ok(mounts() >= 1000, `${mounts()} mounts: the water's every geometry, the crates'`);
  assert.equal(imageless, 0, 'no frame without an image');
  assert.ok(drawn.size <= 4, `${drawn.size} resources left mounted: the others are unmounted`);
});
