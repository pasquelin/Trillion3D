import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clusterSphereValid,
  pageCarriesClusterError,
  primitiveUsesClusterErrors,
  type Page,
} from './geometry.ts'

const page = { lodError: 0, sphere: [1, 2, 3, 0] } as Page

test('only finite four-component spheres with nonnegative radii can project an error band', () => {
  assert.equal(clusterSphereValid(page.sphere), true)
  // Each component in turn not a finite number.
  const unreadable = [0, 1, 2, 3].flatMap((axis) =>
    [NaN, Infinity, '1'].map((bad) => page.sphere!.map((v, i) => (i === axis ? bad : v))),
  )
  for (const sphere of [null, [], [0, 0, 0], [0, 0, 0, 1, 2], [0, 0, 0, -1], ...unreadable])
    assert.equal(clusterSphereValid(sphere), false)
  assert.equal(pageCarriesClusterError(page), true)
  for (const lodError of [-1, NaN, Infinity, '0', undefined])
    assert.equal(pageCarriesClusterError({ ...page, lodError } as Page), false)
  assert.equal(pageCarriesClusterError({ ...page, sphere: [] }), false)
})

test('a primitive needs pages, and all of them valid bands', () => {
  assert.equal(primitiveUsesClusterErrors({ pages: [] }), false)
  assert.equal(primitiveUsesClusterErrors({ pages: [page] }), true)
  assert.equal(primitiveUsesClusterErrors({ pages: [page, { ...page, lodError: NaN }] }), false)
})
