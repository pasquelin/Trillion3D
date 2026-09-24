import test from 'node:test';
import assert from 'node:assert/strict';
import { box, isDoubleSided, merge, SURFACES, transform } from '../props/index.ts';
import { inwardClosed, pieces } from '../props/winding.ts';
import { placeWorld } from './world.ts';

test('a box turned inside out is caught, two boxes sharing an edge still count as closed', () => {
  const cube = box(SURFACES.concrete, [1, 2, 3]),
    inverted = { ...cube, indices: Uint32Array.from(cube.indices).reverse() },
    pair = merge([cube, transform(cube, { at: [1, 0, 3] })])[0];
  assert.equal(inwardClosed(cube), 0);
  assert.equal(inwardClosed(inverted), 12);
  assert.deepEqual(
    pieces(pair).map((piece) => [piece.closed, piece.triangles]),
    [[true, 24]],
  );
});

test('no closed piece of any prop the whole world places faces inward', () => {
  const inward: string[] = [];
  for (const mesh of placeWorld().meshes)
    for (const part of mesh.parts) {
      // Cards are drawn from both sides: their winding hides nothing.
      if (isDoubleSided(part.surface)) continue;
      const count = inwardClosed(part);
      if (count) inward.push(`${mesh.id}/${part.surface.name}: ${count} triangles`);
    }
  assert.deepEqual(inward, []);
});
