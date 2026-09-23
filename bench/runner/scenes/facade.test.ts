import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTriangles, facadeGltf } from './facade.ts';
import { baySubdivision, facadePlan, facadeWalls, uvAt, UV_LAYOUTS } from './facadeModel.ts';
import {
  CHECKER_GREYS,
  facadeTexels,
  facadeTexture,
  TEXTURE_CELLS,
  TEXTURE_SIZE,
} from './facadeTexture.ts';

test('a seed reproduces its block, another seed gives another block', () => {
  assert.deepEqual(facadePlan(7), facadePlan(7));
  assert.notDeepEqual(facadePlan(7).windows, facadePlan(8).windows);
  assert.equal(defaultTriangles(7), defaultTriangles(7));
  for (const seed of [1, 7, 42, 1291]) {
    const triangles = defaultTriangles(seed);
    assert.ok(triangles >= 200_000 && triangles <= 400_000, `seed ${seed}: ${triangles}`);
  }
});

test('the ground floor is solid and the storeys above are not', () => {
  const plan = facadePlan(7);
  for (const [index, wall] of plan.windows.entries()) {
    const columns = plan.bays[index];
    assert.equal(wall.length, columns * plan.storeys);
    assert.ok(
      wall.slice(0, columns).every((open) => !open),
      'a bay of the ground floor is open',
    );
    assert.ok(wall.slice(columns).includes(true), 'no storey above the ground floor is pierced');
  }
});

test('the block reaches the triangle count it was asked for', () => {
  for (const [seed, asked] of [
    [7, 300_000],
    [42, 120_000],
  ]) {
    const plan = facadePlan(seed);
    const walls = facadeWalls(plan, baySubdivision(plan, asked));
    const triangles = walls.reduce((sum, wall) => sum + wall.indices.length / 3, 0);
    // The subdivision is a whole number of cuts per bay, so the count lands on the nearest
    // reachable one: within a quarter of what was asked, never a tenth of it.
    assert.ok(Math.abs(triangles - asked) < asked / 4, `seed ${seed}: ${triangles} for ${asked}`);
  }
});

test('the three texture-coordinate layouts are on different walls', () => {
  const plan = facadePlan(7);
  const walls = facadeWalls(plan, baySubdivision(plan, 20_000));
  assert.deepEqual(
    walls.slice(0, 3).map((wall) => wall.layout),
    UV_LAYOUTS,
  );
  for (const wall of walls) {
    assert.equal(wall.positions.length, wall.normals.length);
    assert.equal(wall.uvs.length, (wall.positions.length / 3) * 2);
    assert.ok(wall.indices.length > 0 && wall.indices.length % 3 === 0);
    for (const uv of wall.uvs)
      assert.ok(uv >= 0 && uv <= 1, `${wall.name}: uv ${uv} off the image`);
  }
});

test('the mirrored layout folds the image about the middle of its wall', () => {
  assert.deepEqual(uvAt('per-wall', 0.25, 0.5, 0.1, 0.2), [0.25, 0.5]);
  assert.deepEqual(uvAt('per-window', 0.25, 0.5, 0.1, 0.2), [0.1, 0.2]);
  // The two halves meet at the far edge of the image and walk back: a fold, not a jump.
  assert.deepEqual(uvAt('mirrored', 0.25, 0.5, 0, 0), [0.5, 0.5]);
  assert.deepEqual(uvAt('mirrored', 0.5, 0.5, 0, 0), [1, 0.5]);
  assert.deepEqual(uvAt('mirrored', 0.75, 0.5, 0, 0), [0.5, 0.5]);
});

test('the glTF names every wall as its own primitive over one checker material', () => {
  const plan = facadePlan(7);
  const walls = facadeWalls(plan, baySubdivision(plan, 20_000));
  const { gltf, binary } = facadeGltf(walls);
  assert.equal(gltf.meshes[0].primitives.length, walls.length);
  assert.equal(gltf.materials.length, 1);
  assert.equal(gltf.images[0].uri, 'facade-checker.png');
  assert.equal(gltf.buffers[0].byteLength, binary.length);
  for (const primitive of gltf.meshes[0].primitives) {
    const attributes = primitive.attributes as Record<string, number>;
    assert.deepEqual(Object.keys(attributes), ['POSITION', 'NORMAL', 'TEXCOORD_0']);
    const position = gltf.accessors[attributes.POSITION] as { min: number[]; max: number[] };
    assert.ok(position.max.every((value, axis) => value >= position.min[axis]));
  }
});

test('the checker names each of its cells in digits', () => {
  assert.deepEqual([...facadeTexture().subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'not a PNG');
  const texels = facadeTexels(),
    cell = TEXTURE_SIZE / TEXTURE_CELLS;
  const inked = (cellX: number, cellY: number, ink: number[]) => {
    let count = 0;
    for (let y = cellY * cell; y < (cellY + 1) * cell; y++)
      for (let x = cellX * cell; x < (cellX + 1) * cell; x++) {
        const at = (y * TEXTURE_SIZE + x) * 4;
        if (ink.every((channel, c) => texels[at + c] === channel)) count++;
      }
    return count;
  };
  const { light, dark } = CHECKER_GREYS;
  // Squares alternate, and each carries digits drawn in its neighbour's grey: without them a cell
  // would hold one colour and nothing else.
  assert.ok(inked(0, 0, light) > inked(0, 0, dark), 'the first cell is not the light square');
  assert.ok(inked(1, 0, dark) > inked(1, 0, light), 'the checker does not alternate');
  assert.ok(inked(0, 0, dark) > 0, 'the light cell carries no digits');
  assert.ok(inked(1, 0, light) > 0, 'the dark cell carries no digits');
  // `15` is two glyphs where `0` is one: the cells are named, not merely marked.
  assert.ok(inked(15, 0, dark) > inked(0, 0, dark), 'every cell carries the same mark');
});
