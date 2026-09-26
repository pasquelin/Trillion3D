// #456: every mesh casts a shadow unless it says `castShadow = false`, as a light casts none unless
// it says `true`. A write reaches the world (`SceneLink.shadow`), and the mesh's row carries it to the
// engine (`PlacementRows.shadowless`), where its root leaves every light cut (`update.test.ts`).
// A saved scene keeps it; one saved before a mesh's flag was read has its meshes cast.
import test from 'node:test';
import assert from 'node:assert/strict';
import { object, Object3D } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { light } from '../../../../sdk-core/src/world/light/index.ts';
import type { SceneLink } from '../../../../sdk-core/src/world/object/object3d.ts';
import { createPlacementRows, growPlacementRows } from '../../placement/rows.ts';
import { createWorldPoses } from './worldPoses.ts';
import type { Seat } from './worldBatches.ts';
import { Scene } from './scene.ts';

test('a mesh casts by default, a light and a group do not, and a clone keeps the flag', () => {
  const mesh = object.mesh(geometry.box(1, 1, 1));
  assert.deepEqual(
    [mesh.castShadow, light.directional().castShadow, object.group().castShadow],
    [true, false, false],
  );
  mesh.castShadow = false;
  assert.equal(mesh.clone().castShadow, false);
});

test("a mesh's castShadow reaches its world once per change, and its row carries it", () => {
  const mesh = object.mesh(geometry.box(1, 1, 1));
  const posed: unknown[] = [];
  mesh._link = { shadow: (node) => void posed.push(node) } as Partial<SceneLink> as SceneLink;
  mesh.castShadow = false;
  mesh.castShadow = false;
  assert.deepEqual(posed, [mesh], 'a write that changes nothing tells nothing');
  const rows = createPlacementRows(2),
    poses = createWorldPoses(),
    seat = { batch: { rows }, row: 1 } as unknown as Seat;
  poses.writeSeat(mesh, seat, true);
  assert.deepEqual([...rows.shadowless], [0, 1]);
  assert.deepEqual([...growPlacementRows(rows, 3).shadowless], [0, 1, 0, 0], 'kept as rows grow');
  mesh.castShadow = true;
  poses.writeSeat(mesh, seat, true);
  assert.deepEqual([...rows.shadowless], [0, 0]);
});

test('a saved scene keeps each flag; one of version 1, written when none was read, has meshes cast', async () => {
  const scene = new Scene(async () => new Object3D() as never);
  const [ink, box] = [0, 1].map(() => object.mesh(geometry.box(1, 1, 1)));
  ink.castShadow = false;
  scene.add(ink, box, light.directional({ castShadow: false }));
  const casts = () => scene.children.map((node) => node.castShadow);
  const saved = scene.toJSON();
  await scene.fromJSON(saved);
  assert.deepEqual(casts(), [false, true, false], 'version 2 keeps every flag');
  await scene.fromJSON({ ...saved, formatVersion: 1 });
  assert.deepEqual(
    casts(),
    [true, true, false],
    'a mesh of version 1 casts; a light keeps its own',
  );
});
