import test from 'node:test';
import assert from 'node:assert/strict';
import { box } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { fakePhysicsWorld } from './worker.fixture.ts';

test('a mirrored compound is refused by name; it makes no body', async () => {
  const { scene, physics, restore } = await fakePhysicsWorld();
  try {
    const raft = new Mesh(box(), new Material('meshStandard'));
    raft.name = 'raft';
    raft.physics = { type: 'dynamic', shape: { type: 'compound', parts: [] } };
    raft.scale.setScalar(-1);
    scene.add(raft);
    physics.frame();
    const error = physics.handle.error;
    assert.equal(error?.code, 'PHYSICS_FAILED');
    assert.deepEqual(error?.details, { name: 'raft' });
    assert.match(error!.message, /"raft" has -1, -1, -1, a mirror/);
    assert.equal(raft.physics!._index, -1, 'no body');
    physics.dispose();
  } finally {
    restore();
  }
});
