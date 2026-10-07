// The witness scene (`displayObjects.ts`): the source graph as Three's WebGPU renderer draws it —
// each drawn mesh copied once, in source order, posed from the source's world matrices at each
// `update()`, its lights copied, its clear colour shown.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { witnessScene } from './displayObjects.ts'

const CLEAR = 0x2a303c

/** A source of two drawn squares, the first under a moved and stretched parent. */
function source() {
  const root = new G.Group(),
    parent = new G.Group()
  parent.position.set(2, 0, 0)
  parent.scale.set(1, 3, 1)
  const first = G.mesh(G.planeGeometry(1, 1), G.basicSurface()),
    second = G.mesh(G.planeGeometry(1, 1), G.basicSurface())
  first.position.set(0, 1, 0)
  parent.add(first)
  root.add(parent, second)
  return { root, first }
}

const meshesOf = (scene: THREE.Scene) =>
  scene.children.filter((node) => (node as THREE.Mesh).isMesh) as THREE.Mesh[]

test('the witness scene copies each drawn mesh once, in source order, posed at each update', () => {
  const { root, first } = source()
  const witness = witnessScene(root, CLEAR)
  const copies = meshesOf(witness.scene)
  assert.deepEqual(
    copies.map((copy) => copy.renderOrder),
    [0, 1],
  )
  assert.equal((witness.scene.background as THREE.Color).getHex(), CLEAR)
  witness.update()
  assert.deepEqual(Array.from(copies[0].matrix.elements), Array.from(first.matrixWorld.elements))
  first.position.set(0, 4, 0)
  witness.update()
  assert.equal(copies[0].matrix.elements[13], 12, 'the parent stretch applies to the new pose')
  witness.dispose()
  assert.equal(witness.scene.children.length, 0)
})

test('the witness scene is lit only by a light of the source', () => {
  const { root } = source()
  assert.equal(witnessScene(root, CLEAR).lit(), false)
  root.add(G.directionalLight(0xffffff, 2))
  const witness = witnessScene(root, CLEAR)
  assert.equal(witness.lit(), true)
  assert.equal(witness.scene.children.filter((node) => node instanceof THREE.Light).length, 1)
})
