// A subtree's own-error floor certifies a rejection only with the sphere it is seen through:
// `cullingBounds` never leaves a finite strictly positive floor without one, whatever clusters
// the pages carry — those preparation produces, and those it leaves without an error band.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUND_STRIDE, cullingBounds, OWN_FLOOR, OWN_SPHERE } from './bounds.ts'
import type { PageRecord } from './state.fixture.ts'

const NEAR = [0, 0, 20, 2],
  LOIN = [-40, 5, 90, 30]

/** A finite strictly positive bound requires its sphere: that is what preparation guarantees. */
function coherente(bound: number, radius: number) {
  return !(bound > 0 && bound !== Infinity) || radius >= 0
}

/** Clusters preparation can produce, plus those it leaves without an error band. */
function pages(): PageRecord[] {
  const out: PageRecord[] = []
  for (const lodError of [0, 1e-6, 2, undefined])
    for (const parentError of [null, 0, 3, Infinity])
      for (const sphere of [NEAR, LOIN])
        out.push({
          triangles: 1,
          min: [-1, -1, -1],
          max: [1, 1, 1],
          lodError,
          sphere: lodError === undefined ? undefined : sphere,
          parentError: parentError === 0 && lodError !== 0 ? null : parentError,
          parentSphere: parentError === null ? null : sphere,
        })
  return out
}

test('a finite positive node floor always comes from a cluster that had its sphere', () => {
  const all = pages()
  // A two-level hierarchy: the root, then four leaves that share the clusters.
  const stride = 15,
    count = 5
  const nodes = new Float64Array(count * stride)
  const perLeaf = Math.ceil(all.length / 4)
  nodes[11] = 1
  nodes[12] = 4
  for (let leaf = 0; leaf < 4; leaf++) {
    const base = (leaf + 1) * stride
    nodes[base + 13] = leaf * perLeaf
    nodes[base + 14] = Math.min(perLeaf, Math.max(0, all.length - leaf * perLeaf))
  }
  const values = cullingBounds({ nodes, stride }, all)
  for (let node = 0; node < count; node++) {
    const at = node * BOUND_STRIDE
    assert.ok(
      coherente(values[at + OWN_FLOOR], values[at + OWN_SPHERE + 3]),
      `own floor of node ${node}`,
    )
  }
})
