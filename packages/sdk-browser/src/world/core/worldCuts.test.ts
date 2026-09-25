import test from 'node:test';
import assert from 'node:assert/strict';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { createWorldCuts } from './worldCuts.ts';

// #359: a line worn by a dashed material is read with its distance along the line; the same line
// worn solid is read as before, into a resource of its own.
test('a dashed line is read with its distance along the line, a solid one without', async () => {
  const cuts = createWorldCuts();
  const path = geometry.createBuffer({
    position: new BufferAttribute(new Float32Array([0, 0, 0, 4, 0, 0]), 3),
  });
  const dashed = await cuts.of(object.line(path, material.lineDashed({ dashSize: 0.3 })));
  const solid = await cuts.of(object.line(path, material.line()));
  assert.deepEqual(Array.from(dashed!.drawn.uvs!), [0, 0, 0, 0, 4, 0, 4, 0]);
  assert.equal(solid!.drawn.uvs, null);
  assert.notEqual(dashed!.key, solid!.key);
  cuts.dispose();
});
