// A model placed twice is one world DAG placed twice (`worldLinks.ts`): each placement of the model
// links its objects to its own instance, each instance's HLOD 0 cells switched by their own states.
// On a generated world — three HLOD 0 cells of one object each — placed near the strip camera and
// 1 000 units past it: the near instance's cells draw their placements, the far one's their HLOD 1,
// each object of each drawn exactly once, and one instance's states never switch the other's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldDag } from '../../hlod/worldHlod.fixture.ts'
import { packDagSelection } from '../pack/pack.ts'
import { stripCamera } from '../../cut/cutRuleBackends.fixture.ts'
import { packedWorldsToRenderOrigin } from '../pack/pack.fixture.ts'
import { objectPlacements, translated, worldScene } from './worldScene.fixture.ts'
import type { DagRoot } from '../types.ts'
import { CELL_DRAW, setLink } from './worldLinks.ts'
import { CELL_TOLD, createLinkFollower } from './worldFollow.ts'
import { ruleResidency } from '../readiness.fixture.ts'
import { evaluateDagSelectionKernel } from '../oracle/oracle.fixture.ts'
import { cameraSelectionUniforms } from '../../../gpu/core/selection.ts'
import { createPlacementRows } from '../../../placement/rows/rows.ts'

/** The world placed at `offsets` along the strip: per instance one placement per object, then the
 *  instances of the world DAG, each its placement's row; links as `placeInCell` writes them. */
function placedTwice(offsets: readonly number[]) {
  const world = worldDag()
  const placements = objectPlacements(world.leaves, offsets)
  const pose = createPlacementRows(offsets.length)
  const instances = offsets.map(
    (offset, index) =>
      ({
        ...world,
        world: { elements: translated(offset) },
        placement: { rows: pose, index },
      }) as unknown as DagRoot,
  )
  const roots = [...placements, ...instances]
  const packed = packDagSelection(roots)
  const placed = packed.world!,
    cold = new Uint32Array(packed.coldWords.buffer)
  offsets.forEach((_, k) => {
    for (let u = 0; u < world.leaves; u++) setLink(placed, k * world.leaves + u, u, k)
  })
  cold.set(placed.links, placed.linkBase)
  const cam = stripCamera(world)
  packedWorldsToRenderOrigin(packed, roots, cam.eye)
  const bases = placed.roots.map((w) => packed.cutLinks[w].pageBase)
  /** Every cell of instance `k` in `state`, written where the kernel reads it. */
  const switchTo = (k: number, state: number) => {
    placed.states.fill(state, k * placed.cells, (k + 1) * placed.cells)
    cold.set(placed.states, placed.stateBase)
  }
  return { world, packed, cam, bases, switchTo }
}

/** Per instance of `s`, how many times each of its objects is drawn: by its placement, or by the
 *  share of its unit a world page spans. */
function covers(s: ReturnType<typeof placedTwice>, drawn: readonly number[]) {
  const leaves = s.world.leaves,
    pages = s.world.pages.length
  return s.bases.map((base, k) => {
    const covered = new Array<number>(leaves).fill(0)
    for (const p of drawn) {
      if (p >= k * leaves && p < (k + 1) * leaves) covered[p - k * leaves]++
      if (p < base || p >= base + pages) continue
      const { units, min, max } = s.world.pages[p - base]
      for (let u = units[0]; u < units[1]; u++)
        covered[u] += Math.min(max[0], u + 1) - Math.max(min[0], u)
    }
    return covered
  })
}

/** The pages `s` draws, every page resident. */
function cut(s: ReturnType<typeof placedTwice>) {
  const resident = new Uint8Array(s.packed.pageCount).fill(1)
  const uniforms = cameraSelectionUniforms(s.cam, 1, [1280, 720])
  return evaluateDagSelectionKernel(s.packed, uniforms, ruleResidency(s.packed, resident))
    .drawablePageIds!
}

test('each instance draws the representation its own cells chose: near, its objects; far, its HLOD', () => {
  const s = placedTwice([0, 1000])
  s.switchTo(0, CELL_DRAW.placements)
  s.switchTo(1, CELL_DRAW.hlod)
  const drawn = cut(s),
    leaves = s.world.leaves
  assert.deepEqual(covers(s, drawn), [new Array(leaves).fill(1), new Array(leaves).fill(1)])
  assert.equal(drawn.filter((p) => p < leaves).length, leaves, 'the near instance, its objects')
  assert.ok(
    drawn.every((p) => p < s.bases[0] || p >= s.bases[0] + s.world.pages.length),
    'the near instance, none of its HLOD',
  )
  assert.equal(drawn.filter((p) => p >= leaves && p < 2 * leaves).length, 0, 'the far one, none')
})

test("one instance's states switch none of the other's: past its range, an instance draws nothing", () => {
  const s = placedTwice([0, 1000])
  s.switchTo(0, 0)
  s.switchTo(1, CELL_DRAW.hlod)
  const leaves = s.world.leaves,
    drawn = cut(s)
  assert.deepEqual(covers(s, drawn), [new Array(leaves).fill(0), new Array(leaves).fill(1)])
  assert.equal(drawn.filter((p) => p < 2 * leaves).length, 0, 'a returning placement draws none')
})

test('a world only loaded stays placed and switched as ever: its cells and files draw nothing, the actors always loaded draw over them', () => {
  const s = worldScene()
  const world = s.packed.world!
  // The links the fixture wrote are the follower's to make; the last cell's actor lies in the first.
  world.links.fill(0xffffffff)
  world.parent[2] = 0
  const follower = createLinkFollower({ packed: s.packed, cold: () => {} })!
  const leaves = s.world.leaves
  follower.residency({ length: s.packed.pageCount, flag: () => 1 })
  for (let u = 0; u < leaves; u++) follower.placeInCell(u, u, 0, u, true)
  // The first cell wished and placed; the others not wished, the second one's actor held by no
  // cell (always loaded), the last one's held by the first.
  follower.show(0, 0, CELL_TOLD.wished | CELL_TOLD.placed)
  follower.sync()
  const drawn = () => [[...world.states.slice(0, leaves)], [...world.files.slice(0, leaves)]]
  const { placements, hlod } = CELL_DRAW
  assert.deepEqual(drawn(), [
    [placements, hlod, hlod],
    [1, 1, 1],
  ])
  // `draws` reads the word: whether a cell's actor stands for it, as the distance fields follow it.
  const standing = () => [0, 1, 2].map((cell) => follower.draws(0, cell))
  assert.deepEqual(standing(), [false, true, true])
  assert.equal(follower.draws(0, 3), false, 'no such cell')
  assert.equal(follower.draws(1, 0), false, 'no such instance')
  // What `draws` answers is named by its revision: the same while no cell's actor starts or stops drawing.
  const revision = follower.drawRevision
  follower.sync()
  assert.equal(follower.drawRevision, revision, 'nothing moved')
  follower.activated(false)
  assert.equal(follower.sync(), true, 'the words moved')
  assert.ok(follower.drawRevision > revision, 'cells 0 and 2 changed whether their actor draws')
  // Cell 0 is wished and shown, and its actor, always loaded, still draws: no cell is shown while
  // the cells are only loaded, so nothing covers it. Cell 2's actor lies in cell 0, not shown.
  assert.deepEqual(
    drawn(),
    [
      [hlod, hlod, 0],
      [0, 0, 0],
    ],
    'the actors always loaded draw over every cell, wished or not',
  )
  assert.deepEqual(standing(), [true, true, false], 'the actors over the cells that are not shown')
  assert.equal(follower.visible(0, 0), true, 'the cell stays shown')
  assert.equal(follower.fileShown(0, 0), true, 'and the files')
  assert.equal(follower.shown, true, 'every cell and file wished is as shown as it was')
  follower.activated(true)
  follower.sync()
  assert.deepEqual(
    drawn(),
    [
      [placements, hlod, hlod],
      [1, 1, 1],
    ],
    'drawn again as they were',
  )
})
