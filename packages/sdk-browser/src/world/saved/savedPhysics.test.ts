import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../core/scene.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { PhysicsOption } from '../../../../sdk-core/src/physics/options.ts';

const noModel = () => new Scene(() => Promise.reject(new Error('no model here')));

/** A scene of one mesh per declaration, saved as plain JSON and read into another scene. */
async function savedAndRead(declarations: PhysicsOption[]) {
  const scene = noModel();
  for (const declared of declarations) {
    const mesh = object.mesh(geometry.box(1, 1, 1));
    mesh.physics = declared;
    scene.add(mesh);
  }
  const again = noModel();
  await again.fromJSON(JSON.parse(JSON.stringify(scene.toJSON())));
  return { before: scene.children as Mesh[], after: again.children as Mesh[] };
}

test("a saved scene keeps each mesh's body as it was declared, and a mesh without one gets none", async () => {
  const { before, after } = await savedAndRead([
    'static',
    { type: 'dynamic', mass: 20, friction: 0.2, damping: { linear: 0 }, ccd: true },
    { type: 'kinematic', shape: { type: 'sphere', radius: 0.5 }, gravityScale: 0 },
    { type: 'cloth', pins: [0, 1], stretch: 0.01 },
    { type: 'static', sensor: true },
    { type: 'dynamic', decorative: true, restitution: 0.5 },
    { type: 'volume', pressure: 40, bend: 0.1 },
  ]);
  assert.equal(after.length, before.length);
  const read = [
    'type',
    'mass',
    'shape',
    'friction',
    'restitution',
    'gravityScale',
    'ccd',
    'sensor',
    'decorative',
    'damping',
    'soft',
  ] as const;
  for (const [k, mesh] of after.entries()) {
    const was = before[k].physics!,
      is = mesh.physics!;
    for (const name of read) assert.deepEqual(is[name], was[name], `${k}: ${name}`);
  }
  assert.equal(after[3].physics?.soft?.bend, Infinity, 'a free bend comes back free');
  const bare = noModel();
  bare.add(object.mesh(geometry.box(1, 1, 1)));
  assert.equal(bare.toJSON().children[0].physics, undefined);
});
