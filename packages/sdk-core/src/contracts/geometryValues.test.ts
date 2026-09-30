import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clusterSphereValid,
  pageCarriesClusterError,
  primitiveIsDrawable,
  primitiveUsesClusterErrors,
  type Page,
} from './geometry.ts';
import { alphaModeOf } from './material.ts';

const page = { lodError: 0, sphere: [1, 2, 3, 0] } as Page;

test('only finite four-component spheres with nonnegative radii can project an error band', () => {
  assert.equal(clusterSphereValid(page.sphere), true);
  for (const sphere of [
    null,
    [],
    [0, 0, 0],
    [0, 0, 0, 1, 2],
    [0, 0, 0, -1],
    ...[0, 1, 2, 3].flatMap((axis) =>
      [NaN, Infinity, '1'].map((value) =>
        page.sphere!.map((component, i) => (i === axis ? value : component)),
      ),
    ),
  ])
    assert.equal(clusterSphereValid(sphere), false);
  assert.equal(pageCarriesClusterError(page), true);
  for (const lodError of [-1, NaN, Infinity, '0', undefined])
    assert.equal(pageCarriesClusterError({ ...page, lodError } as Page), false);
  assert.equal(pageCarriesClusterError({ ...page, sphere: [] }), false);
});

test('all pages need valid bands, while an unsplit transmitted surface must carry none', () => {
  assert.equal(primitiveUsesClusterErrors({ pages: [] }), false);
  assert.equal(primitiveUsesClusterErrors({ pages: [page] }), true);
  assert.equal(primitiveUsesClusterErrors({ pages: [page, { ...page, lodError: NaN }] }), false);
  assert.equal(primitiveIsDrawable({ pass: 'shared-blend', pages: [] }), true);
  assert.equal(primitiveIsDrawable({ pass: 'shared-blend', pages: [page] }), false);
  assert.equal(primitiveIsDrawable({ pass: 'exact-clusters', pages: [page] }), true);
  assert.equal(primitiveIsDrawable({ pass: 'exact-clusters', pages: [] }), false);
});

test('blending retains priority over alpha cutouts and a zero cutoff stays opaque', () => {
  for (const alphaTest of [0, 0.5, -1])
    assert.equal(alphaModeOf({ transparent: true, alphaTest }), 'blend');
  assert.equal(alphaModeOf({ transparent: false, alphaTest: 0.5 }), 'mask');
  assert.equal(alphaModeOf({ transparent: false, alphaTest: 0 }), 'opaque');
  assert.equal(alphaModeOf({ transparent: false, alphaTest: -1 }), 'opaque');
});
