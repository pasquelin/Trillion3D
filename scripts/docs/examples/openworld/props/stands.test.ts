import test from 'node:test';
import assert from 'node:assert/strict';
import { REPOSE } from '../plan/rivers.ts';
import { sharedProps } from './catalog.ts';
import { partBounds, triangleCount } from './geometry.ts';
import { forestPatch, forestStands, STAND_SIDE, standExtent, standTriangles } from './stands.ts';
import { propProblems } from './validate.ts';
import { vehicleProps } from './vehicles.ts';

const bytes = (seed: number) =>
  Buffer.concat(
    forestStands(seed).meshes.flatMap((mesh) =>
      mesh.parts.flatMap((part) =>
        [part.positions, part.indices].map((a) =>
          Buffer.from(a.buffer, a.byteOffset, a.byteLength),
        ),
      ),
    ),
  );

test('a patch is deterministic: same seed, same bytes; another seed, another stand', () => {
  const a = forestPatch('a', 'alpine', 0, 7).mesh,
    b = forestPatch('a', 'alpine', 0, 7).mesh;
  assert.deepEqual(a, b);
  assert.ok(bytes(332).equals(bytes(332)));
  assert.ok(!bytes(332).equals(bytes(333)));
});

test('every variant is sound, and all of them fit the kit budget beside its other props', () => {
  const { meshes } = forestStands(332),
    others = [...sharedProps(332).filter((p) => !standExtent(p.id)), ...vehicleProps()];
  assert.deepEqual(meshes.flatMap(propProblems), []);
  // The kit's budget of unique triangles, shared props and vehicles together (`catalog.test.ts`).
  const kit = others.reduce((sum, p) => sum + triangleCount(p), 0) + standTriangles(332);
  assert.ok(kit <= 2_000_000, `${kit} triangles`);
});

test('stems stand at the density the references give', () => {
  const hectares = (STAND_SIDE * STAND_SIDE) / 1e4,
    density = { alpine: 500, broadleaf: 300, birch: 700, palm: 1e4 / 64 };
  for (const variant of forestStands(332).variants) {
    const asked = density[variant.biome] * hectares;
    assert.equal(variant.trees, Math.round(asked), variant.id);
  }
});

test('variants step from level ground to the angle of repose, one burial span apart', () => {
  const { variants, meshes } = forestStands(332);
  for (const biome of ['alpine', 'broadleaf', 'birch'] as const) {
    const own = variants.filter((v) => v.biome === biome),
      step = (2 * own[0].tolerance) / STAND_SIDE;
    assert.equal(own[0].gradient, 0);
    own.forEach((v, k) => assert.ok(Math.abs(v.gradient - k * step) < 1e-9, v.id));
    assert.ok(own.at(-1)!.gradient + step / 2 >= REPOSE, `${biome} reaches the repose`);
    assert.ok(own.at(-2)!.gradient + step / 2 < REPOSE, `${biome} has no variant to spare`);
  }
  assert.deepEqual(
    variants.filter((v) => v.biome === 'palm').map((v) => v.gradient),
    [0],
  );
  // A sloped patch's stems follow its plane: the downhill edge stands lower.
  const steep = meshes[variants.findIndex((v) => v.id === 'tree-stand-alpine-4')];
  const [min] = partBounds(steep.parts);
  assert.ok(min[1] < -variants[4].gradient * (STAND_SIDE / 2) * 0.9);
});

test('a patch claims its square, and no other prop claims one', () => {
  assert.deepEqual(standExtent('tree-stand-birch-2'), [-16, -16, 16, 16]);
  assert.equal(standExtent('tree-birch-small'), undefined);
});
