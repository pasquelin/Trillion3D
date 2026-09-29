import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';
import { BufferAttribute } from '../../../sdk-core/src/world/buffer/attribute.ts';
import { drawnTriangles } from '../../../sdk-core/src/world/geometry/drawn.ts';
import { wholeDeformationInputs } from './wholeInputs.ts';
import { deformationTexels } from './vertexTexture.ts';
import { packDrawn, unpackDrawn } from '../world/page/runtimePack.ts';
import { runtimeDeformation } from '../world/page/runtimeDeformation.ts';

function geometry() {
  const g = new Geometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setIndex([0, 1, 2]);
  for (let set = 0; set < 2; set++) {
    const suffix = set ? String(set) : '';
    g.setAttribute(
      `skinIndex${suffix}`,
      new BufferAttribute(
        new Float32Array(
          Array(3)
            .fill([0, 1, 2, 3].map((v) => v + 4 * set))
            .flat(),
        ),
        4,
      ),
    );
    g.setAttribute(`skinWeight${suffix}`, new BufferAttribute(new Float32Array(12).fill(0.125), 4));
  }
  return g;
}

test('whole GPU inputs and the WebGL texture retain every source influence', () => {
  const g = geometry(),
    whole = wholeDeformationInputs(g),
    gl = deformationTexels(g, 0);
  assert.equal(whole[3], 16);
  assert.deepEqual([...whole.slice(4, 12)], [0, 1, 2, 3, 4, 5, 6, 7]);
  let x = 0;
  for (let k = 0; k < 8; k++) {
    assert.equal(gl[k * 4], whole[4 + k]);
    assert.equal(gl[k * 4 + 1], whole[12 + k]);
    x += gl[k * 4 + 1] * (gl[k * 4] >= 4 ? 8 : 0);
  }
  assert.equal(x, 4);
});

test('runtime cutter transfer and conservative joint bounds preserve influences beyond four', () => {
  const drawn = drawnTriangles(geometry(), 'triangles')!;
  const copied = unpackDrawn(packDrawn(drawn, false)).drawn;
  assert.equal(copied.deformation!.influences, 8);
  assert.deepEqual(copied.deformation!.joints, drawn.deformation!.joints);
  assert.equal(runtimeDeformation(copied)!.joints.length, 8 * 4);
});
