import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { createWorldCuts } from './worldCuts.ts';
import { prepareSdkWasm } from '../../page/decode/geometryPageWasm.ts';

// An opaque cut takes the compiler's grid from the SDK module (`cutGrid.ts`): Node cannot fetch
// the module by its URL, so the test hands it the bytes.
await prepareSdkWasm(readFileSync(join(import.meta.dirname, '../../page/decode/pageCodec.wasm')));

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

// #875: a blended surface draws from its pages what it drew from its floats. Its pages take the
// finest grids a page holds (2^23 steps across the widest span); an opaque wearer of the same
// geometry keeps the grids its image was proved on, in a resource of its own.
test('a blended wearer is cut on the finest page grid, an opaque one keeps its grid', async () => {
  const cuts = createWorldCuts();
  const sphere = geometry.sphere(1, 16, 12);
  const opaque = await cuts.of(object.mesh(sphere, material.meshStandard()));
  const blended = await cuts.of(
    object.mesh(sphere, material.meshStandard({ transparent: true, opacity: 0.5 })),
  );
  assert.notEqual(opaque!.key, blended!.key);
  const grid = (cut: typeof opaque) => cut!.runtime.primitive.quantization!;
  assert.equal(grid(opaque).positionExponent, 1 - 16);
  assert.equal(grid(blended).positionExponent, 1 - 23);
  assert.ok(grid(blended).maxPositionError! <= 2 ** -22);
  assert.ok(grid(opaque).maxPositionError! > grid(blended).maxPositionError!);
  // Its texture coordinates too, a unit wide: 2^-23 where the format keeps 2^-14.
  assert.equal(grid(opaque).uvExponent, -14);
  assert.equal(grid(blended).uvExponent, -23);
  // Added light blends whatever `transparent` says: the same finest grids.
  const added = await cuts.of(object.mesh(sphere, material.meshBasic({ blending: 'additive' })));
  assert.equal(grid(added).positionExponent, 1 - 23);
  cuts.dispose();
});
