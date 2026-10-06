// matrices.ts: READ boundary of the host graph: refusal of a non-finite pose. Update of the HOST
// scene remains compared to the host's own full update: it still serves its own readers.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../graph/graph.fixture.ts'
import { EngineError } from '../../../../sdk-core/src/index.ts'
import { assertFiniteTransform, resolveHostSubtree } from './matrices.ts'
import { assertBits } from '../../../../../tests/kit/assert/bits.ts'

/** Parent → child → grandchild → great-grandchild chain, hostile transforms included. */
function hostileHierarchy() {
  const root = new G.Group()
  root.position.set(1, -2, 3)
  root.scale.set(-1, 2, 0.5) // negative and non-uniform scale
  const child = new G.Group()
  child.matrixAutoUpdate = false
  // Matrix set by hand, column-major: x shear along y, zero scale on z.
  child.matrix.set(1, 0.7, 0, 5, 0, 1, 0, -Infinity, 0, 0, 0, 0, 0, 0, 0, 1)
  root.add(child)
  const grandchild = new G.Group()
  grandchild.position.set(NaN, 0, -0)
  child.add(grandchild)
  const feuille = G.mesh(new G.Geometry(), G.basicSurface())
  feuille.position.set(2, 2, 2)
  grandchild.add(feuille)
  return { root, child, grandchild, feuille }
}

test('resolveHostSubtree yields the same world matrices as updateMatrixWorld(true), hostile subtree included', () => {
  const actual = hostileHierarchy()
  const expected = hostileHierarchy()
  resolveHostSubtree(actual.root)
  expected.root.updateMatrixWorld(true)
  for (const clef of ['root', 'child', 'grandchild', 'feuille'] as const)
    assertBits(actual[clef].matrixWorld.elements, expected[clef].matrixWorld.elements)
})

test('resolveHostSubtree is idempotent: a second call changes no bit', () => {
  const { root, feuille } = hostileHierarchy()
  resolveHostSubtree(root)
  const premier = feuille.matrixWorld.elements.slice()
  resolveHostSubtree(root)
  assertBits(feuille.matrixWorld.elements, premier)
})

test('resolveHostSubtree always forces recompute (force: true): a local matrix rewritten by hand, without updateMatrix, is still taken', () => {
  const parent = new G.Group()
  parent.matrixAutoUpdate = false // the host sets its own local matrix
  const child = new G.Group()
  parent.add(child)
  resolveHostSubtree(parent) // first resolution: matrixWorld = identity for both
  // The host rewrites the local matrix directly: nothing marks the node dirty.
  parent.matrix.elements[12] = 7
  resolveHostSubtree(parent)
  const expected = new G.Matrix4()
  expected.elements[12] = 7
  assertBits(parent.matrixWorld.elements, expected.elements)
  // The child inherits the recomputed parent.
  assertBits(child.matrixWorld.elements, expected.elements)
})

test('resolveHostSubtree does not walk parents: a stale ancestor is not recomputed, and the child inherits it as-is, like updateMatrixWorld(true) called directly on the child', () => {
  const { root, child } = hostileHierarchy()
  root.updateMatrixWorld(true) // root matrixWorld set a first time
  // The root becomes stale without being updated: its position changes, matrixWorld stays the
  // old value until something recomputes it.
  root.position.set(100, 100, 100)
  const perimee = root.matrixWorld.elements.slice()
  resolveHostSubtree(child)
  const ref = hostileHierarchy()
  ref.root.updateMatrixWorld(true)
  ref.root.position.set(100, 100, 100)
  ref.child.updateMatrixWorld(true)
  // The root must not be recomputed.
  assertBits(root.matrixWorld.elements, perimee)
  assertBits(root.matrixWorld.elements, ref.root.matrixWorld.elements)
  assertBits(child.matrixWorld.elements, ref.child.matrixWorld.elements)
})

// Case 4 of the singular-normal convention (singular-normals batch): a non-finite pose never
// enters the engine, it is refused right here, before any inversion or any normal read.
test('assertFiniteTransform: a fully finite matrix passes without throwing', () => {
  const m = new G.Matrix4().compose(
    new G.Vector3(1, -2, 3),
    new G.Quaternion().setFromEuler(new G.Euler(0.3, -0.5, 0.2)),
    new G.Vector3(-2, 3, 0.5),
  ).elements
  assert.doesNotThrow(() => assertFiniteTransform(m, 'node'))
})

test('assertFiniteTransform: NaN at any of the sixteen indices throws NON_FINITE_TRANSFORM with the node name and the faulty rank', () => {
  for (let index = 0; index < 16; index++) {
    const m = new G.Matrix4().identity().elements.slice()
    m[index] = NaN
    assert.throws(
      () => assertFiniteTransform(m, 'target'),
      (error: unknown) =>
        error instanceof EngineError &&
        error.code === 'NON_FINITE_TRANSFORM' &&
        error.details.nodeName === 'target' &&
        error.details.index === index &&
        Number.isNaN(error.details.value as number),
      `index ${index}: NaN not refused`,
    )
  }
})

test('assertFiniteTransform: an infinity, positive or negative, throws NON_FINITE_TRANSFORM', () => {
  for (const valeur of [Infinity, -Infinity]) {
    const m = new G.Matrix4().identity().elements.slice()
    m[5] = valeur
    assert.throws(
      () => assertFiniteTransform(m, 'light'),
      (error: unknown) =>
        error instanceof EngineError &&
        error.code === 'NON_FINITE_TRANSFORM' &&
        error.details.index === 5 &&
        error.details.value === valeur,
      `${valeur} not refused`,
    )
  }
})
