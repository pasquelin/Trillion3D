// bounds.ts: world bounds of a host subtree, empty boxes and an object's own box included.
import '../../../wasm/sdkWasm.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyWorldBox, hostWorldBounds } from './bounds.ts'
import { assertBits } from '../../../../../../tests/kit/assert/bits.ts'
import * as G from '../graph/graph.fixture.ts'
import { Group, Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import { Box3 } from '../../../../../sdk-core/src/world/math/box3.ts'
import { Vector3 } from '../../../../../sdk-core/src/world/math/vector3.ts'
import type { PageMesh } from '../../../geometry/pages/pageMesh.ts'

test('a subtree with no geometry at all returns an empty box', () => {
  const source = new Group()
  source.add(new Group(), new Object3D())
  assertBits(hostWorldBounds(source), [
    Infinity,
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    -Infinity,
  ])
})

test('emptyWorldBox returns an independent empty box on every call', () => {
  const a = emptyWorldBox(),
    b = emptyWorldBox()
  assert.notEqual(a, b, 'two distinct buffers')
  assertBits(a, [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
})

test("an object's own box (object.boundingBox) wins over its geometry's", () => {
  const source = new Group()
  const mesh: PageMesh & { boundingBox?: Box3 | null } = G.mesh(
    G.boxGeometry(100, 100, 100),
    G.basicSurface(),
  )
  // Object box much smaller than its 100×100×100 geometry box.
  mesh.boundingBox = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))
  source.add(mesh)
  // The mesh sits at the origin: its world box is its own box, not the geometry's.
  assertBits(hostWorldBounds(source), [-1, -1, -1, 1, 1, 1])
})

test('hostWorldBounds accumulates into an already started `into` instead of replacing it', () => {
  const into = new Float64Array(6)
  into.set([-1, -1, -1, 1, 1, 1])
  const mesh = G.mesh(G.boxGeometry(1, 1, 1), G.basicSurface())
  mesh.position.set(50, 0, 0)
  const actual = hostWorldBounds(mesh, into)
  assert.equal(actual, into, 'the same buffer is returned')
  assert.ok(actual[3] > 40, 'the starting box is extended, not overwritten')
  assert.equal(actual[0], -1, 'the starting low bound is kept on x')
})
