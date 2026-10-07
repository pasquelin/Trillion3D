// A lone object's copies, roots of the world past its pinned top, in the one cut. Its cell's hold
// keeps them resident as the pinned top is kept (`../../webgpu/residency/sets.ts`, `holdCover`),
// so the cut's own rule decides. On a generated world — three cells of four objects under one
// pinned top, and a fourth cell whose one object stands alone, the outputs of its own group two
// copies of it — the CPU oracle, on the residency the mirror hands it: held far, the object is
// drawn by its copies; neither placed nor held, by nothing; placed, by its placement or both
// copies, never both, never neither; every other object exactly once.
import test from 'node:test'
import assert from 'node:assert/strict'
import { objectCovers, worldScene } from './worldScene.fixture.ts'
import { ruleResidency } from './readiness.fixture.ts'
import { evaluateDagSelectionKernel } from './oracle/oracle.fixture.ts'
import { cameraSelectionUniforms, SELECTION_NONE as NONE } from '../core/selection.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { createWorldResidencyMirror } from './worldMirror.ts'
import { objectClusters } from './worldLinks.ts'

/** The scene with one lone object, the last, its world cluster, its copies, and the mirror. */
function lone() {
  const s = worldScene(1),
    { structure } = s.world,
    world = s.packed.world!
  const object = s.world.leaves - 1,
    cluster = objectClusters(world.origins)[object],
    group = structure.owners[cluster]
  const { outputs, outputOffsets } = structure,
    copies = [...outputs.subarray(outputOffsets[group], outputOffsets[group + 1])]
  // The other super-roots: the cells' and the pinned top, held or not as a frame says.
  const superRoots = s.world.pages.flatMap((p, rank) =>
    p.level && !copies.includes(rank) ? [rank] : [],
  )
  const mirror = createWorldResidencyMirror({ ...s.packed, world })
  return {
    ...s,
    object,
    link: s.base + cluster,
    copies,
    superRoots,
    mirror,
    rows: new Uint32Array(s.packed.pageCount),
  }
}
type Lone = ReturnType<typeof lone>

/** The lone object's cell: placed or not, held (placed or far) or not; its cover resident or not. */
type Cell = { placed: boolean; held: boolean; cover: boolean }

/**
 * The pages drawn at `threshold` with the lone object's cell as `cell` says — its copies resident
 * while it is held — and every other object placed, its cover resident where `covers` says, the
 * other super-roots where `held` says, the pinned top always.
 */
function cut(s: Lone, cell: Cell, threshold: number, covers: boolean[], held: boolean[]) {
  const { packed, rows, base, object } = s,
    world = packed.world!,
    top = s.world.structure.roots
  for (let u = 0; u < object; u++) rows[u] = covers[u] ? 1 : 0
  s.superRoots.forEach((rank, at) => (rows[base + rank] = top.includes(rank) || held[at] ? 1 : 0))
  for (const rank of s.copies) rows[base + rank] = cell.held ? 1 : 0
  rows[object] = cell.placed && cell.cover ? 1 : 0
  // Placed or left as `placeObject` moves a link (`worldFollow.ts`).
  const c = cell.placed ? s.link : NONE
  if (world.links[object] !== c) {
    world.links[object] = c
    world.moved.add(object)
  }
  const { flags } = s.mirror.update(rows)
  const uniforms = cameraSelectionUniforms(s.cam, threshold, [1280, 720])
  return (
    evaluateDagSelectionKernel(packed, uniforms, ruleResidency(packed, flags)).drawablePageIds ?? []
  )
}

/** Per other object, how many drawn pages cover it; and whether the lone object's placement draws,
 *  and how many of its copies. */
function drawnBy(s: Lone, drawn: readonly number[]) {
  const others = objectCovers(s, drawn).slice(0, s.object)
  const copies = s.copies.filter((rank) => drawn.includes(s.base + rank)).length
  return { others, placement: drawn.includes(s.object), copies }
}

test("across its cell's hold and release, a lone object is drawn by its copies, its placement or nothing", () => {
  const s = lone(),
    [near, far] = [1e-3, 1e3],
    every = (on: boolean) => new Array<boolean>(s.world.pages.length).fill(on)
  const steps: [string, Cell, number, [boolean, number]][] = [
    ['neither placed nor held', { placed: false, held: false, cover: false }, far, [false, 0]],
    ['held far', { placed: false, held: true, cover: false }, far, [false, 2]],
    ['placed, its cover streaming', { placed: true, held: true, cover: false }, near, [false, 2]],
    ['placed and near', { placed: true, held: true, cover: true }, near, [true, 0]],
    ['placed and far', { placed: true, held: true, cover: true }, far, [false, 2]],
    ['held far again', { placed: false, held: true, cover: false }, near, [false, 2]],
    ['let go', { placed: false, held: false, cover: false }, near, [false, 0]],
  ]
  for (const [name, cell, threshold, expected] of steps) {
    const { others, placement, copies } = drawnBy(
      s,
      cut(s, cell, threshold, every(true), every(true)),
    )
    assert.deepEqual([placement, copies], expected, name)
    assert.deepEqual(others, new Array(s.object).fill(1), name)
  }
})

test('a placed lone object is drawn by its placement or both copies, never both, never neither', () => {
  const s = lone(),
    next = random(7919),
    seen = { placement: 0, copies: 0 }
  const draw = () => Array.from({ length: s.world.pages.length }, () => next() < 0.75)
  for (let frame = 0; frame < 400; frame++) {
    const threshold = 0.05 * 2 ** (next() * 12),
      placed = next() < 0.7
    const cell = { placed, held: placed || next() < 0.6, cover: next() < 0.8 }
    const { others, placement, copies } = drawnBy(s, cut(s, cell, threshold, draw(), draw()))
    assert.deepEqual(others, new Array(s.object).fill(1), `frame ${frame}`)
    if (placed) assert.ok(placement !== (copies === 2) && copies !== 1, `frame ${frame}`)
    else assert.deepEqual([placement, copies], [false, cell.held ? 2 : 0], `frame ${frame}`)
    if (placed) seen[placement ? 'placement' : 'copies']++
  }
  assert.ok(seen.placement > 0 && seen.copies > 0, 'both draw it, by turns')
})
