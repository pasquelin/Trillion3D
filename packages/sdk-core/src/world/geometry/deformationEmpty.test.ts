import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from './geometry.ts';
import { pendingAttribute } from '../buffer/attribute.ts';
import { drawnDeformation } from './drawnDeformation.ts';
import type { DrawnTriangles } from './drawn.ts';

test('empty drawn deformation preserves pending skin and morph buffers without reading them', () => {
  for (const kind of ['skin', 'morph']) {
    let reads = 0;
    const pending = (size: number) =>
      pendingAttribute(
        {
          length: 0,
          type: 'Float32Array',
          read: async () => {
            reads++;
            return new Float32Array();
          },
        },
        size,
        false,
      );
    const g = new Geometry();
    if (kind === 'skin') {
      g.setAttribute('skinIndex', pending(1));
      g.setAttribute('skinWeight', pending(1));
    } else {
      g.morphAttributes.position = [pending(3)];
      g.morphTargetsRelative = true;
    }
    const drawn: DrawnTriangles = {
      positions: new Float32Array(),
      normals: new Float32Array(),
      indices: new Uint32Array(),
      uvs: null,
      colors: null,
    };
    assert.equal(drawnDeformation(g, drawn), drawn);
    const d = drawn.deformation!;
    assert.equal(reads, 0);
    if (kind === 'skin') {
      assert.deepEqual(d.joints, new Float32Array());
      assert.deepEqual(d.weights, new Float32Array());
      assert.equal(d.influences, 1);
      assert.deepEqual(d.targets, []);
    } else {
      assert.equal(d.targets.length, 1);
      assert.deepEqual(d.targets[0], {
        positions: new Float32Array(),
        normals: new Float32Array(),
      });
    }
  }
});
