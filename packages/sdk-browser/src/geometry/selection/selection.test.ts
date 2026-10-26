import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { collectClusterPages } from './collect.ts'
import { rootCoverage } from './selection.ts'
import { selectVisiblePages } from '../cut/cut.fixture.ts'
import { blendFixture, camera } from './blend.fixture.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { createHeldResidency } from '../cut/held.fixture.ts'
import { graphDraws } from './drawSource.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { NO_VIEW_SET, type ViewSet } from '../../../../sdk-core/src/world/camera/viewSet.ts'
import { appendRootsUnder } from '../../frame/render/movedNode.ts'
import { createViewFilter } from './viewFilter.ts'

test('clustered blend pages retain their source and only select the intersecting part of a mesh', () => {
  const fixture = blendFixture()
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    graphDraws(fixture.source, fixture.associations),
    fixture.metadata,
    fixture.indices,
  )
  assert.equal(allPages.length, 2)
  for (const page of allPages) {
    assert.equal(page.transparent, true)
    assert.equal(page.drawSource?.node, fixture.mesh)
  }
  const selected = selectVisiblePages(roots, engineCamera(camera()), {
    pixelError: 100,
    viewport: [960, 540],
    held: createHeldResidency(),
  })
  assert.deepEqual(
    selected.shown.map((page) => page.url),
    ['near'],
  )
  assert.equal(selected.displayedTriangles, 1)
  assert.equal(selected.complete, true)
  assert.deepEqual(
    rootCoverage(roots).map((page) => page.url),
    ['near', 'far'],
  )
  fixture.geometry.dispose()
  fixture.material.dispose()
})

test('clustered blend never reports missing exact coverage as resident', () => {
  const fixture = blendFixture()
  fixture.indices.delete('near')
  const { roots } = collectClusterPages(
    fixture.source,
    graphDraws(fixture.source, fixture.associations),
    fixture.metadata,
    fixture.indices,
    { allowMissing: true },
  )
  const selected = selectVisiblePages(roots, engineCamera(camera()), {
    held: createHeldResidency(),
  })
  assert.equal(selected.complete, false)
  assert.deepEqual(
    selected.wanted.map((page) => page.url),
    ['near'],
  )
  assert.deepEqual(selected.shown, [])
  fixture.geometry.dispose()
  fixture.material.dispose()
})

test('clustered blend classification remains explicit if material transparency was disabled', () => {
  const fixture = blendFixture(G.basicSurface())
  const collected = collectClusterPages(
    fixture.source,
    graphDraws(fixture.source, fixture.associations),
    fixture.metadata,
    fixture.indices,
  )
  assert.equal(collected.allPages[0].transparent, true)
  fixture.geometry.dispose()
  fixture.material.dispose()
})

test('a transparent material on `exact-clusters` pages is collected as transparent', () => {
  const fixture = blendFixture()
  fixture.metadata.primitives[0].pass = 'exact-clusters'
  const collected = collectClusterPages(
    fixture.source,
    graphDraws(fixture.source, fixture.associations),
    fixture.metadata,
    fixture.indices,
  )
  assert.equal(collected.allPages[0].transparent, true)
  fixture.geometry.dispose()
  fixture.material.dispose()
})

/** Four meshes: `a` and `b` under the group `g`, `c` alone, `d` under the group `h`; one root each, by rank. */
function scene() {
  const [g, h, a, b, c, d] = Array.from({ length: 6 }, () => new Object3D())
  g.add(a, b)
  h.add(d)
  const nodes = [a, b, c, d]
  const layout = {
    selectionRoots: nodes.map((node) => ({ pages: [{ drawSource: { node } }] })),
    rootIndex: { revision: 0 },
  }
  const under = (node: Object3D, out: number[], at: number) =>
    appendRootsUnder(layout as never, node, out, at)
  const set = (hidden: Object3D[], showOnly: Object3D[] | null = null): ViewSet => ({
    ...NO_VIEW_SET,
    hidden,
    showOnly,
  })
  return { g, h, a, b, c, d, under, set, roots: nodes.length }
}
/** The ranks whose bit is set in `bits`. */
const setBits = (bits: Uint32Array | undefined, count: number) =>
  Array.from({ length: count }, (_, k) => k).filter((k) => bits && bits[k >> 5] & (1 << (k & 31)))

test('a view hides the roots under the objects it lists, an object standing for all under it', () => {
  const x = scene(),
    filter = createViewFilter()
  assert.equal(filter.update(x.set([]), x.roots, x.under, 1), undefined, 'no list: no bits at all')
  assert.equal(filter.update(undefined, x.roots, x.under, 1), undefined)
  assert.deepEqual(setBits(filter.update(x.set([x.g]), x.roots, x.under, 1), 4), [0, 1], 'a group')
  assert.deepEqual(setBits(filter.update(x.set([x.b]), x.roots, x.under, 1), 4), [1], 'a mesh')
  assert.deepEqual(setBits(filter.update(x.set([x.c, x.h]), x.roots, x.under, 1), 4), [2, 3])
})

test('a view with a showOnly list draws the roots under it alone, hidden winning, an empty list drawing none', () => {
  const x = scene(),
    filter = createViewFilter()
  const hiddenWith = (hidden: Object3D[], showOnly: Object3D[] | null) =>
    setBits(filter.update(x.set(hidden, showOnly), x.roots, x.under, 1), 4)
  assert.deepEqual(hiddenWith([], [x.c]), [0, 1, 3], 'only c drawn')
  assert.deepEqual(hiddenWith([], [x.g, x.h]), [2], 'two groups')
  assert.deepEqual(hiddenWith([], []), [0, 1, 2, 3], 'an empty list draws none')
  assert.equal(
    filter.update(x.set([], []), x.roots, x.under, 1)?.[0],
    0b1111,
    'no bit past the roots',
  )
  assert.deepEqual(hiddenWith([x.b], [x.g]), [1, 2, 3], 'hidden wins over a shown group')
})

test('the bits keep their identity while they do not change, and follow the scene where it moves', () => {
  const x = scene(),
    filter = createViewFilter()
  const first = filter.update(x.set([x.g]), x.roots, x.under, 1)
  assert.equal(filter.update(x.set([x.g]), x.roots, x.under, 1), first, 'an equal set, as before')
  assert.equal(
    filter.update(x.set([x.g]), x.roots, x.under, 2),
    first,
    'the scene moved, not these',
  )
  assert.notEqual(filter.update(x.set([x.g, x.c]), x.roots, x.under, 2), first, 'a longer list')
  // The object listed gains a mesh: the scene moved, so its roots are read again.
  const again = filter.update(x.set([x.g]), x.roots, x.under, 3)
  x.g.add(x.c)
  const moved = filter.update(x.set([x.g]), x.roots, x.under, 4)
  assert.notEqual(moved, again)
  assert.deepEqual(setBits(moved, 4), [0, 1, 2])
  // Cleared, the filter costs nothing again.
  assert.equal(filter.update(x.set([]), x.roots, x.under, 4), undefined)
})
