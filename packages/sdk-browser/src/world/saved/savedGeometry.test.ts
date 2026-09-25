import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../core/scene.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import {
  BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
} from '../../../../sdk-core/src/world/buffer/index.ts';

/** A scene that loads no model: these shapes are the page's own. */
const sceneOfShapes = () =>
  new Scene(async () => {
    throw new Error('no model is loaded here');
  });

/** The geometries of `scene` once saved and read back, in order. */
async function readBack(scene: Scene) {
  await scene.fromJSON(JSON.parse(JSON.stringify(scene.toJSON())));
  return scene.children.map((m) => (m as ReturnType<typeof object.mesh>).geometry);
}

// #457: a saved view of an interleaved buffer held the whole pack under its own width.
test('a view of an interleaved buffer is saved as its own numbers, not the whole pack', async () => {
  const scene = sceneOfShapes();
  // Per vertex: x, y, z, u, v.
  const pack = new InterleavedBuffer(
    new Float32Array([0, 0, 0, 0.1, 0.2, 1, 0, 0, 0.3, 0.4, 0, 1, 0, 0.5, 0.6]),
    5,
  );
  const shape = geometry.createBuffer({
    position: new InterleavedBufferAttribute(pack, 3, 0),
    uv: new InterleavedBufferAttribute(pack, 2, 3),
  });
  scene.add(object.mesh(shape));
  const [back] = await readBack(scene);
  assert.deepEqual(Array.from(back.attributes.position.array), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(
    Array.from(back.attributes.uv.array),
    Array.from(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])),
  );
});

// #457: a host geometry is read at its value, a world one as stored; a saved one keeps its owner.
test('a shape keeps who built it, the world or the host, once saved and read back', async () => {
  const scene = sceneOfShapes();
  for (const owner of ['world', 'host'] as const) {
    const shape = geometry.createBuffer({
      position: new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    });
    shape._owner = owner;
    scene.add(object.mesh(shape));
  }
  const owners = (await readBack(scene)).map((back) => back._owner);
  assert.deepEqual(owners, ['world', 'host']);
});
