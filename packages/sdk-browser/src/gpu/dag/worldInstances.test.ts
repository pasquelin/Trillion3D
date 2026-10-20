// A model placed twice is one world DAG placed twice (`worldLinks.ts`): each placement of the model
// links its objects to its own instance, each instance's HLOD 0 cells switched by their own states.
// On a generated world — three HLOD 0 cells of one object each — placed near the strip camera and
// 1 000 units past it: the near instance's cells draw their placements, the far one's their HLOD 1,
// each object of each drawn exactly once, and one instance's states never switch the other's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldDag } from '../../scene/worldHlod.fixture.ts'
import { packDagSelection } from './pack.ts'
import { stripCamera } from '../../page/cut/cutRuleBackends.fixture.ts'
import { packedWorldsToRenderOrigin } from './pack.fixture.ts'
import { objectPlacements, translated } from './worldScene.fixture.ts'
import type { DagRoot } from './types.ts'
import { CELL_DRAW, setLink } from './worldLinks.ts'
import { ruleResidency } from './readiness.fixture.ts'
import { evaluateDagSelectionKernel } from './oracle/oracle.fixture.ts'
import { cameraSelectionUniforms } from '../core/selection.ts'
import { createPlacementRows } from '../../placement/rows.ts'

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
    cold = new Uint32Array(packed.pageCones.buffer)
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
  s.switchTo(1, CELL_DRAW.hlod | CELL_DRAW.asking)
  const leaves = s.world.leaves,
    drawn = cut(s)
  assert.deepEqual(covers(s, drawn), [new Array(leaves).fill(0), new Array(leaves).fill(1)])
  assert.equal(drawn.filter((p) => p < 2 * leaves).length, 0, 'a returning placement draws none')
})
