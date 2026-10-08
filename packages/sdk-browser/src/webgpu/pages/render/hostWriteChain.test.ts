// A chain of nested nodes written in one image moves each root once, in its topmost written
// ancestor's turn: a node under another written node moves with it, never again — the host's writes
// as an engine move of the whole chain. On generated scenes of 10³ and 10⁵ meshes beside a chain of
// a hundred nested meshes.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../host/graph/graph.fixture.ts'
import { selectionRoot } from '../../core/transformShear.fixture.ts'
import { hostScene as scene } from './hostWrite.fixture.ts'
import { setWebgpuTransforms } from './transform.ts'

const CHAIN = 100

/** A scene of `count` meshes and a chain of `CHAIN` nested meshes, each a root; the reads of the
 *  chain roots' boxes counted — a few a root moved once, `CHAIN`² / 2 walked once a written
 *  ancestor. */
function chained(count: number) {
  const s = scene(count)
  const links: G.Object3D[] = []
  let parent: G.Object3D = s.holder
  for (let k = 0; k < CHAIN; k++) {
    const link = G.mesh(s.meshes[0].geometry)
    parent.add(link)
    links.push(link)
    parent = link
  }
  let reads = 0
  for (const link of links) {
    const root = selectionRoot(link, [-1, -1, -1, 1, 1, 1], s.worlds),
      box = root.worldBox
    Object.defineProperty(root, 'worldBox', { get: () => (reads++, box) })
    s.roots.push(root)
  }
  Object.assign(s.rt.layout, { worldUpdates: new Float32Array(s.roots.length * 16) })
  s.run.gate.sceneChanged()
  s.image()
  return { ...s, links, reads: () => reads }
}

for (const count of [1e3, 1e5])
  test(`a chain the host wrote whole moves each root once, at ${count} meshes`, () => {
    const { links, motions, reads, image } = chained(count)
    const before = reads()
    motions.length = 0
    for (const link of links) link.position.x += 1
    image()
    assert.ok(reads() - before <= 10 * CHAIN, `${reads() - before} box reads for ${CHAIN} roots`)
    assert.ok(motions.length <= 2, `${motions.length} shadow boxes declared`)
  })

test('a chain moved whole through the engine moves each root once', () => {
  const { links, rt, motions, reads } = chained(1e3)
  const poses = new Float32Array(16 * CHAIN)
  for (let k = 0; k < CHAIN; k++)
    poses.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, k + 1, 0, 0, 1], 16 * k)
  const before = reads()
  motions.length = 0
  setWebgpuTransforms(rt, links, poses)
  assert.ok(reads() - before <= 10 * CHAIN, `${reads() - before} box reads for ${CHAIN} roots`)
  assert.ok(motions.length <= 2, `${motions.length} shadow boxes declared`)
})
