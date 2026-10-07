// The world DAG and the placements it stands in for, in the one cut: a placement draws
// where its object's world group is ready and projects past the threshold, the group's super-roots
// draw everywhere else — every object covered exactly once, whatever the threshold and whatever is
// placed, resident or streaming. On a generated world: three cells of four objects, each object one
// placement of a unit-wide cluster, continued into its cell's super-root and one world top.
import test from 'node:test'
import assert from 'node:assert/strict'
import { objectCovers, worldScene, type WorldScene } from './worldScene.fixture.ts'
import { ruleResidency } from './readiness.fixture.ts'
import { evaluateDagSelectionKernel } from './oracle/oracle.fixture.ts'
import { oracleWorldCovers, oracleWorldPixels } from './oracle/worldGate.fixture.ts'
import { dagViewFrames } from './oracle/math.fixture.ts'
import { cameraSelectionUniforms, SELECTION_NONE as NONE } from '../core/selection.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { DAG_SELECTION_SHADER } from './shader/shader.ts'
import { worldFadeScale } from './worldFade.ts'

/** A frame's residency: the objects `placed` (each its cluster, its world object with it), the
 *  super-roots `held`, the world top always. */
function residency(s: WorldScene, placed: boolean[], held: boolean[]) {
  const resident = new Uint8Array(s.packed.pageCount)
  placed.forEach((on, u) => on && (resident[u] = resident[s.base + u] = 1))
  for (let rank = s.world.leaves; rank < s.world.pages.length; rank++)
    resident[s.base + rank] = rank === s.world.pages.length - 1 || held[rank] ? 1 : 0
  return ruleResidency(s.packed, resident)
}

test('every object is drawn exactly once, by its placement or its world group', () => {
  const s = worldScene(),
    next = random(1473)
  let byPlacement = 0,
    byWorld = 0
  for (let frame = 0; frame < 400; frame++) {
    const threshold = 0.05 * 2 ** (next() * 12)
    const placed = Array.from({ length: s.world.leaves }, () => next() < 0.8)
    const held = s.world.pages.map(() => next() < 0.7)
    const uniforms = cameraSelectionUniforms(s.cam, threshold, [1280, 720])
    const cut = evaluateDagSelectionKernel(s.packed, uniforms, residency(s, placed, held))
    const drawn = cut.drawablePageIds ?? []
    assert.deepEqual(objectCovers(s, drawn), new Array(s.world.leaves).fill(1), `frame ${frame}`)
    byPlacement += drawn.filter((page) => page < s.base).length
    byWorld += drawn.filter((page) => page >= s.base).length
  }
  assert.ok(byPlacement > 0 && byWorld > 0, 'both draw, by turns')
})

test('a placement the world draws is never descended', () => {
  const s = worldScene()
  // Far enough for the world top: no placement opens a node.
  const uniforms = cameraSelectionUniforms(s.cam, 1e3, [1280, 720])
  const placed = new Array<boolean>(s.world.leaves).fill(true)
  const frames = dagViewFrames(s.packed, uniforms)
  const ready = residency(
    s,
    placed,
    s.world.pages.map(() => true),
  ).ready
  const covers = oracleWorldCovers(s.packed, frames, ready)
  for (let u = 0; u < s.world.leaves; u++) assert.ok(covers(u), `placement ${u}`)
  // Near enough for every object: no placement is covered once all are ready.
  const near = oracleWorldCovers(
    s.packed,
    dagViewFrames(s.packed, cameraSelectionUniforms(s.cam, 1e-3, [1280, 720])),
    ready,
  )
  for (let u = 0; u < s.world.leaves; u++) assert.ok(!near(u), `placement ${u}`)
})

test("the kernel's own gate decides as its model does, its threshold faded", () => {
  const s = worldScene(),
    next = random(1335)
  const cold = new Uint32Array(s.packed.pageCones.buffer),
    link = s.packed.world!,
    shift = cold[link.linkBase - 1]
  // The kernel's text, its projection the model's own: a record is read back at its page here.
  const views = [{ ...{ worldLinks: link.linkBase, worldScale: 1, worldCount: s.roots.length } }]
  Object.assign(views[0], { pixelError: 0 })
  let ready: ArrayLike<number> = [],
    pixels = (c: number) => c
  const kernel = shaderRun<{ worldCovers(w: number): boolean }>(
    DAG_SELECTION_SHADER,
    ['worldLinkOf', 'worldCovers', 'thresholdOf'],
    {
      ...{ views, vi: 0, deformReach: 0, worldViewOf: () => undefined, focalPixels: () => 0 },
      coldAt: (at: number) => cold[at],
      isResident: (c: number) => !!ready[c],
      clusterAt: (r: number) => (r - shift) >>> 0,
      clusterPixels: (c: number) => ({ x: Math.fround(pixels(c)), y: 0 }),
    },
  )
  for (let frame = 0; frame < 200; frame++) {
    const threshold = Math.fround(0.05 * 2 ** (next() * 12))
    const placed = Array.from({ length: s.world.leaves }, () => next() < 0.8)
    ready = residency(
      s,
      placed,
      s.world.pages.map(() => true),
    ).ready
    link.scale = views[0].worldScale = Math.fround(worldFadeScale(frame))
    const uniforms = cameraSelectionUniforms(s.cam, threshold, [1280, 720])
    const frames = dagViewFrames(s.packed, uniforms),
      held = Math.fround(threshold * link.scale)
    const model = oracleWorldCovers(s.packed, frames, ready),
      projected = oracleWorldPixels(s.packed, frames)
    pixels = (c) => Math.fround(projected(c))
    Object.assign(views[0], { pixelError: threshold })
    for (let w = 0; w < s.roots.length; w++) {
      const c = link.links[w]
      const expected = c !== NONE && (!ready[c] || !(Math.fround(projected(c)) > held))
      assert.equal(kernel.worldCovers(w), expected, `placement ${w}, ${held} px`)
      if (c !== NONE) assert.equal(model(w), !ready[c] || !(projected(c) > held))
    }
  }
  assert.equal(link.links[s.world.leaves], NONE, 'the world DAG itself is linked to nothing')
})

test('a hand-over is dithered in time: within the band, by turns, never both', () => {
  const s = worldScene()
  const all = new Array<boolean>(s.world.leaves).fill(true)
  const residentAll = residency(
    s,
    all,
    s.world.pages.map(() => true),
  )
  // Object 5's group projects to `p`: held three quarters of the way, half its cuts draw it.
  const frames = dagViewFrames(s.packed, cameraSelectionUniforms(s.cam, 1, [1280, 720]))
  const p = oracleWorldPixels(s.packed, frames)(link(s, 5)),
    threshold = p / 0.75
  let byPlacement = 0
  const cuts = 64
  for (let cut = 0; cut < cuts; cut++) {
    s.packed.world!.scale = worldFadeScale(cut)
    const uniforms = cameraSelectionUniforms(s.cam, threshold, [1280, 720])
    const drawn = evaluateDagSelectionKernel(s.packed, uniforms, residentAll).drawablePageIds ?? []
    assert.deepEqual(objectCovers(s, drawn), new Array(s.world.leaves).fill(1), `cut ${cut}`)
    if (drawn.includes(5)) byPlacement++
  }
  // The band's width, read from the scales themselves: their lowest is one minus it.
  const band = 1 - Math.min(...Array.from({ length: 4096 }, (_, cut) => worldFadeScale(cut)))
  const share = (0.75 - (1 - band)) / band
  assert.ok(Math.abs(byPlacement / cuts - share) < 0.05, `${byPlacement} of ${cuts} cuts`)
})

/** The world cluster object `u`'s placement links to. */
const link = (s: WorldScene, u: number) => s.packed.world!.links[u]
