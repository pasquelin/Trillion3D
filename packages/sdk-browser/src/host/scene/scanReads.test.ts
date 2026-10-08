// A node's own flags are read once per scan, not twice: `parent` and `visible` are getters that
// check the node is alive on every read (`sdk-core/src/scene/core/node.ts:42-54`), and this walk
// runs on every watched node, twice in an image where the GPU cut walks back into the CPU one. The
// verdicts are unchanged — `scan.test.ts` enumerates every write and every verdict.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../graph/graph.fixture.ts'
import { scan, snapshot, verdictOf } from './scan.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

const CHAMPS = ['parent', 'visible', 'castShadow', 'matrixAutoUpdate'] as const

/** Where a flag is declared, up the prototype chain: an instance field, or the accessor that
 *  reads it. */
function descripteurDe(node: Object3D, champ: string) {
  for (let p: object | null = node; p; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, champ)
    if (d) return { sur: p, d }
  }
  return null
}

/** A node that counts what is read of it and still answers as the real one does: each flag keeps
 *  the descriptor it had, so a write through it reaches the real field and the next read sees it.
 *  The count is the only difference from the node the scan walks today. */
function counted(node: Object3D) {
  const reads: Record<string, number> = {}
  for (const champ of CHAMPS) {
    const found = descripteurDe(node, champ)
    if (!found) throw new Error(`SCAN_READS_SANS_CHAMP ${champ}`)
    const { sur, d } = found,
      lu = d.get ? () => d.get!.call(node) : () => (sur as Record<string, unknown>)[champ]
    Object.defineProperty(node, champ, {
      configurable: true,
      get() {
        reads[champ] = (reads[champ] ?? 0) + 1
        return lu()
      },
      set(valeur: unknown) {
        if (d.set) d.set.call(node, valeur)
        else (sur as Record<string, unknown>)[champ] = valeur
      },
    })
  }
  return { node, reads }
}

/** A mesh under a group: the shape `scan` walks, with its flags counted. */
function mesh() {
  const parent = new G.Group(),
    node = G.mesh()
  parent.add(node)
  return counted(node)
}

/** The reads of one scan of a node that has already been snapshotted. */
function scanCounts(node: Object3D, write: () => void = () => {}) {
  const { reads } = counted(node)
  const state = snapshot(node)
  write()
  for (const champ of CHAMPS) reads[champ] = 0
  const verdict = verdictOf(scan(state))
  return { verdict, reads: { ...reads } }
}

test('a still scene reads each flag exactly once', () => {
  const { verdict, reads } = scanCounts(mesh().node)
  assert.equal(verdict, 0, 'nothing was written since the snapshot')
  assert.deepEqual(reads, { parent: 1, visible: 1, castShadow: 1, matrixAutoUpdate: 1 })
})

test('a frozen node reads each flag once, and the matrix is what it compares', () => {
  const node = mesh().node
  const premier = scanCounts(node, () => void ((node as Object3D).matrixAutoUpdate = false))
  assert.equal(premier.verdict, 'moved', 'the matrix is compared, not the flag')
  const second = scanCounts(node)
  assert.equal(second.verdict, 0, 'the same matrix walked again moves nothing')
  assert.deepEqual(second.reads, { parent: 1, visible: 1, castShadow: 1, matrixAutoUpdate: 1 })
})

test('a reparented node is read once and still reshapes the watch', () => {
  const node = mesh().node
  const { verdict, reads } = scanCounts(node, () => void new G.Group().add(node))
  assert.equal(verdict, 'reshaped', 'the ancestor chain moved')
  assert.equal(reads.parent, 1, 'the parent read once, and it is what the verdict came from')
})

test('a hidden node is read once and still reports the write', () => {
  const node = mesh().node
  const { verdict, reads } = scanCounts(node, () => void ((node as Object3D).visible = false))
  assert.equal(verdict, 'moved', 'the host hid it')
  assert.equal(reads.visible, 1, 'and the read that saw it was the only one')
})

test('a shadow flag written alone is read once and still reports the write', () => {
  const node = mesh().node
  const { verdict, reads } = scanCounts(node, () => void ((node as Object3D).castShadow = false))
  assert.equal(verdict, 'moved', 'the host changed it')
  assert.equal(reads.castShadow, 1, 'read once')
  assert.equal(reads.visible, 1, 'and the flag beside it once')
})
