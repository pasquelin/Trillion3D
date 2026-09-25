import test from 'node:test';
import assert from 'node:assert/strict';
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import { wireframe } from '../../../../sdk-core/src/world/geometry/lines.ts';
import { preparedGeometries } from './geometry.ts';

// #457: a quantized glTF gives the host normalised integer lists; the host has always read them at
// the value they stand for, never as the stored numbers a world geometry is read as.
test('a prepared geometry is the host’s: its normalised lists are edged and turned at their value', () => {
  // View 0: three Int16 positions (18 bytes, padded to 20); view 1: three Int8 normals.
  const binary = new Uint8Array(29);
  binary.set(new Uint8Array(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]).buffer), 0);
  binary.set(new Uint8Array(new Int8Array([127, 0, 0, 0, 0, 127, 0, 0, 127]).buffer), 20);
  const run = (view: number, componentType: number) => ({
    view,
    offset: 0,
    componentType,
    normalized: true,
    count: 3,
    type: 'VEC3',
    min: null,
    max: null,
  });
  const document = {
    views: [
      { offset: 0, length: 18, stride: null },
      { offset: 20, length: 9, stride: null },
    ],
    accessors: [run(0, 5122), run(1, 5120)],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: null }] }],
  } as unknown as TableDocument;
  const geometry = preparedGeometries(document, binary.buffer)(0, 0);
  assert.equal(geometry.owner, 'host');
  assert.deepEqual(
    Array.from(wireframe(geometry).attributes.position.array),
    [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
  );
  geometry.rotateZ(Math.PI / 2);
  // (1, 0, 0) turned is (0, 1, 0), written normalised as 127.
  assert.deepEqual(Array.from(geometry.attributes.normal.array), [0, 127, 0, 0, 0, 127, 0, 0, 127]);
});
