import test from 'node:test';
import assert from 'node:assert/strict';
import { primitiveMaterials } from './materialVariants.ts';
import { preparedMaterials } from './materials.ts';
import type { TablePrimitive } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import { GraphSurface } from '../graph/surface.ts';

const variant = { vertexColors: false, flatShading: false };

test('invalid variant bindings are refused before any surface or texture is prepared', () => {
  const cases = [
    {},
    [null],
    [{ variant: 1, material: 0 }],
    [{ variant: 0, material: -1 }],
    [{ variant: 0, material: 0.5 }],
    [
      { variant: 0, material: 0 },
      { variant: 0, material: 1 },
    ],
  ];
  let prepared = 0;
  for (const bindings of cases) {
    const primitive = { material: 0, variants: bindings } as unknown as TablePrimitive;
    assert.throws(
      () =>
        primitiveMaterials({ id: 'source', names: ['one'] }, primitive, variant, async () => {
          prepared++;
          return new GraphSurface('standard');
        }),
      { code: 'INVALID_SCENE_TABLES' },
    );
  }
  assert.equal(prepared, 0);
});

test('a material table cannot be indexed by missing, negative or fractional ranks', async () => {
  const materialOf = preparedMaterials([], async () => {
    throw new Error('must not load images');
  });
  for (const rank of [0, -1, 0.5, Infinity])
    await assert.rejects(materialOf(rank, variant), { code: 'INVALID_SCENE_TABLES' });
});
