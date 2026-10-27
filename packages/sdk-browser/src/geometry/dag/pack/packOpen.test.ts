// Packing a world at open costs the primitives, not the placements: a page array placed again on the
// records it already has writes no record and counts no root cluster again; the residency bits with
// nothing resident come from the shared blank state; the pages read and the records packed are the
// same words an unshared packing of every placement gives.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4 } from '../../../../../sdk-core/src/world/math/matrix4.ts'
import { packDagSelection } from './pack.ts'
import { scenePages, sceneRoots } from '../cut/cutFrontierScene.fixture.ts'
import { createDagReadiness } from '../readiness.ts'
import { boxInto, dagRecords } from '../records.fixture.ts'
import { DAG_NODE_FLOATS } from '../types.ts'
import { NODE_MAX, NODE_MIN, NODE_SPHERE } from '../nodeLayout.ts'
import type { Texture } from '../../../../../sdk-core/src/texture/contract.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { boxGrownByDisplacement } from '../../../visibility/tessellation/patchWgsl.ts'

type Reads = { sphere: number; url: number; parentError: number }

/** `pages` with every read of the fields a packing walks counted. */
function counted(pages: ReturnType<typeof scenePages>, reads: Reads) {
  return pages.map((page) => {
    const rec = { ...page }
    for (const field of ['sphere', 'url', 'parentError'] as const) {
      const value = page[field]
      Object.defineProperty(rec, field, {
        get() {
          reads[field]++
          return value
        },
      })
    }
    return rec
  })
}

/** `placements` poses over `primitives` page arrays, each array its own pyramid. */
function world(placements: number, primitives: number, reads: Reads) {
  const arrays = Array.from({ length: primitives }, (_, u) =>
    counted(scenePages(64 + 16 * u, 4), reads),
  )
  // The placements of a primitive share its pages and its hierarchy, as a manifest gives them.
  const templates = arrays.map((pages) => sceneRoots(pages, [new Matrix4()])[0])
  return Array.from({ length: placements }, (_, w) => ({
    ...templates[w % primitives],
    world: new Matrix4().makeTranslation(w, 0, 0),
  }))
}

test('the page reads of a packing follow the primitives, not the placements', () => {
  const few: Reads = { sphere: 0, url: 0, parentError: 0 },
    many: Reads = { sphere: 0, url: 0, parentError: 0 }
  packDagSelection(world(12, 3, few))
  packDagSelection(world(600, 3, many))
  assert.ok(few.sphere > 0 && few.parentError > 0)
  // The url is no word of the packing: `pageUrlReader` reads it on demand (the content keys that
  // walked every page's url are gone).
  assert.equal(few.url, 0)
  assert.deepEqual(many, few)
})

test('a placement of a page array packed before shares its records and root clusters', () => {
  const reads: Reads = { sphere: 0, url: 0, parentError: 0 }
  const roots = world(30, 3, reads)
  const packed = packDagSelection(roots)
  const [first] = [0, 1, 2].map((u) => packDagSelection([roots[u]]))
  assert.ok(first.recordCount > 0)
  assert.equal(
    packed.recordCount,
    [0, 1, 2].reduce((n, u) => n + packDagSelection([roots[u]]).recordCount, 0),
  )
  const per = [0, 1, 2].map((u) => packDagSelection([roots[u]]).rootCount)
  assert.equal(
    packed.rootCount,
    roots.reduce((n, _, w) => n + per[w % 3], 0),
  )
})

test('the blank residency of a placement is the pages its shared state reads ready', () => {
  const roots = world(9, 3, { sphere: 0, url: 0, parentError: 0 })
  const packed = packDagSelection(roots)
  const readiness = createDagReadiness(packed)
  packed.cutLinks.forEach(({ pageBase, pageCount }, w) => {
    const { ready, child } = readiness.blankPages(w)
    const expected = (test: (page: number) => boolean) =>
      Array.from({ length: pageCount }, (_, p) => p).filter((p) => test(pageBase + p))
    assert.deepEqual(ready, expected(readiness.isReady))
    assert.deepEqual(child, expected(readiness.isChildReady))
  })
})

test('a displaced surface grows the culling boxes of its primitive and of its clusters by its reach, the balls never', () => {
  const height = { channel: 0 } as Texture
  const surface = {
    displacement: { magnitude: 4, center: 0.25, fade: null },
    displacementMap: height,
  }
  const plain = packDagSelection(sceneRoots(scenePages(64, 4), [new Matrix4()]))
  const displaced = packDagSelection(
    sceneRoots(
      scenePages(64, 4).map((page) => ({ ...page, material: surface as never })),
      [new Matrix4()],
    ),
  )
  // The reach is the larger side of the displacement: 0.75 of the magnitude 4, three units.
  const nodes = plain.nodes.length / DAG_NODE_FLOATS
  assert.ok(nodes > 1)
  for (let n = 0; n < nodes; n++)
    for (let a = 0; a < 3; a++) {
      const at = n * DAG_NODE_FLOATS
      assert.equal(displaced.nodes[at + NODE_MIN + a], plain.nodes[at + NODE_MIN + a] - 3)
      assert.equal(displaced.nodes[at + NODE_MAX + a], plain.nodes[at + NODE_MAX + a] + 3)
    }
  for (let n = 0; n < nodes; n++)
    for (let a = 0; a < 4; a++) {
      const at = n * DAG_NODE_FLOATS + NODE_SPHERE + a
      assert.equal(displaced.nodes[at], plain.nodes[at])
    }
  // The clusters' boxes, which the cull of a shadow caster tests, grow as the nodes' do.
  const before = dagRecords(plain),
    after = dagRecords(displaced)
  const box = (records: typeof before, i: number) => {
    const min = [0, 0, 0],
      max = [0, 0, 0]
    boxInto(records, i, min, max)
    return { min, max }
  }
  assert.equal(plain.pageCount, displaced.pageCount)
  for (let i = 0; i < plain.pageCount; i++) {
    const was = box(before, i),
      now = box(after, i)
    for (let a = 0; a < 3; a++) {
      assert.equal(now.min[a], was.min[a] - 3, `cluster ${i} min ${a}`)
      assert.equal(now.max[a], was.max[a] + 3, `cluster ${i} max ${a}`)
    }
  }
})

/** The box a displacement grows, as the tessellation's splitting reads it (`boxGrownByDisplacement`). */
const run = shaderRun<{
  boxGrownByDisplacement(...args: unknown[]): { lo: number[]; hi: number[] }
}>(wgslBlock('bounds', [boxGrownByDisplacement], ''), ['boxGrownByDisplacement'], {})

test('the box a displacement grows holds every point a normal of the cone can push a corner to', () => {
  const box = { lo: [0, 0, 0], hi: [1, 2, 3] }
  const unit = (v: number[]) => v.map((x) => x / Math.hypot(...v))
  const perpendicular = (axis: number[]) => {
    const across = unit(Math.abs(axis[0]!) < 0.9 ? [1, 0, 0] : [0, 1, 0])
    const along = across.map(
      (x, i) =>
        x - axis[i]! * (across[0]! * axis[0]! + across[1]! * axis[1]! + across[2]! * axis[2]!),
    )
    const first = unit(along)
    const second = [
      axis[1]! * first[2]! - axis[2]! * first[1]!,
      axis[2]! * first[0]! - axis[0]! * first[2]!,
      axis[0]! * first[1]! - axis[1]! * first[0]!,
    ]
    return [first, second] as const
  }
  // A cone round `center` of the half angle whose cosine is `cos`, and displacements from -0.5 to 2.
  for (const [center, cos] of [
    [unit([0, 0, 1]), 1],
    [unit([1, 2, 2]), 0.9],
    [unit([-1, 0.3, 0.5]), 0.6],
    [unit([0, 1, 0]), -0.2],
  ] as const) {
    const grown = run.boxGrownByDisplacement(center, cos, -0.5, 2, box)
    let seed = 7
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
    // Two axes across the cone's: the normals are its axis turned by an angle within it, round it.
    const [u, v] = perpendicular(center)
    for (let i = 0; i < 4000; i++) {
      const theta = Math.acos(cos) * next(),
        phi = 2 * Math.PI * next()
      const n = [0, 1, 2].map(
        (a) =>
          center[a]! * Math.cos(theta) +
          (u[a]! * Math.cos(phi) + v[a]! * Math.sin(phi)) * Math.sin(theta),
      )
      const d = -0.5 + 2.5 * next()
      const corner = [0, 1, 2].map((a) => (next() < 0.5 ? box.lo[a]! : box.hi[a]!))
      for (let a = 0; a < 3; a++) {
        const point = corner[a]! + n[a]! * d
        assert.ok(
          point >= grown.lo[a]! - 1e-9 && point <= grown.hi[a]! + 1e-9,
          `axis ${a} of ${center} ${cos}`,
        )
      }
    }
    // And no larger than the whole the displacement reaches on every side.
    for (let a = 0; a < 3; a++) {
      assert.ok(grown.lo[a]! >= box.lo[a]! - 2 - 1e-9 && grown.hi[a]! <= box.hi[a]! + 2 + 1e-9)
    }
  }
})
