// #364: what a world hands the engine for a sprite — its surface, its bounds, its row — so that
// every raster turns it to the camera and every culling test keeps it whichever way it turns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { drawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import type { GraphMesh } from '../../host/graph/mesh.ts';
import type { GraphSurface } from '../../host/graph/surface.ts';
import { clusterMaterialReason } from '../../host/surfaceGate.ts';
import type { HostAttributes } from '../../host/resources.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { importHostSurface } from '../../host/surfaceImport.ts';
import { hostSide } from '../../scene/materialSide.ts';
import { createPlacementRows, type PlacementRows } from '../../placement/rows.ts';
import { hostSurface, repaintHostSurface } from './worldSurface.ts';
import { buildWorldMirror } from './worldMirror.ts';
import { createWorldMaterials } from './worldMaterials.ts';
import { createWorldPoses } from './worldPoses.ts';
import type { Cut } from './worldCuts.ts';
import type { Seat } from './worldBatches.ts';

test('a sprite surface carries its turn and size rule, both sides, and a repaint writes them', () => {
  const picture = material.sprite({ rotation: 0.4, sizeAttenuation: false });
  const surface = hostSurface(picture, false, new Map(), 'sprite');
  assert.equal(surface.side, hostSide('double'), 'a quad turned to the camera has no back');
  const drawn = drawnTriangles(object.sprite().geometry, 'sprite')!;
  const attributes = {
    position: new BufferAttribute(drawn.positions, 3),
    normal: new BufferAttribute(drawn.normals, 3),
  } as unknown as HostAttributes;
  assert.equal(clusterMaterialReason(surface, attributes), undefined, 'the engine paths draw it');
  assert.deepEqual(importHostSurface(surface)?.sprite, { rotation: 0.4, sizeAttenuation: false });
  picture.rotation = 1.2;
  picture.sizeAttenuation = true;
  repaintHostSurface(surface, picture);
  assert.deepEqual(importHostSurface(surface)?.sprite, { rotation: 1.2, sizeAttenuation: true });
  // The same material worn by faces is no sprite.
  assert.equal(importHostSurface(hostSurface(picture, false, new Map()))?.sprite, undefined);
});

test("a sprite's rotation written at run time repaints its entry in place", () => {
  const table = createWorldMaterials();
  const cutout = material.sprite({ transparent: false, alphaTest: 0.5 });
  const entry = table.entryOf(cutout);
  cutout.rotation = 0.8;
  assert.equal(table.entryOf(cutout), entry);
  assert.deepEqual(table.takeRepainted(), [{ entry, values: true }]);
});

test("a sprite's host mesh wears the sprite surface and is bounded by its radius", () => {
  const drawn = drawnTriangles(object.sprite().geometry, 'sprite', { center: [0, 0] })!;
  const cut = { key: 's', drawn, runtime: {} as never, users: new Set(), held: false } as Cut;
  const picture = material.sprite();
  const rows = {} as PlacementRows;
  const { root } = buildWorldMirror({
    placed: [{ cut, material: picture, rows, name: 's' }],
    models: [],
    rankOf: () => 0,
  });
  const mesh = root.children[0] as GraphMesh;
  assert.ok(importHostSurface(mesh.material as GraphSurface)?.sprite);
  const { boundingBox, boundingSphere } = mesh.geometry;
  const r = Math.SQRT2;
  assert.deepEqual(boundingBox!.min.toArray(), [-r, -r, -r]);
  assert.deepEqual(boundingBox!.max.toArray(), [r, r, r]);
  assert.deepEqual([...boundingSphere!.center.toArray(), boundingSphere!.radius], [0, 0, 0, r]);
});

test("a sprite's row keeps its position and axis lengths, never its turn", () => {
  const rows = createPlacementRows(2);
  const seat = (row: number) => ({ batch: { rows }, row }) as unknown as Seat;
  const poses = createWorldPoses();
  const sprite = object.sprite(),
    box = object.mesh(sprite.geometry);
  for (const node of [sprite, box]) {
    node.position.set(1, 2, 3);
    node.rotation.set(0.3, 1.1, -0.4);
    node.scale.set(3, 1.5, 0.25);
    node.updateMatrixWorld(true);
  }
  poses.writeSeat(sprite, seat(0), true);
  poses.writeSeat(box, seat(1), true);
  const row = Array.from(rows.matrices.subarray(0, 16)).map((v) => Math.round(v * 1e9) / 1e9);
  assert.deepEqual(row, [3, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 3, 0, 1, 2, 3, 1]);
  assert.deepEqual(
    Array.from(rows.matrices.subarray(16, 32)),
    Array.from(box.matrixWorld.elements),
  );
});
