// The row cache's demand follows the readbacks' differences, never their lists: on generated
// scene families — cooked DAG placements on a grid, host meshes of one page each scattered and in
// clumps — a still camera closes nothing over after its first readback, and a moving one closes
// over what its lists' differences name alone, where the demand closed over every drawn, asked and
// ahead id each readback before. What it wants is the closure of the requests, frame by frame: the
// rows asked for — and so the cut drawn and asked — are those of before.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldCamera, placementField } from '../../gpu/dag/placementTree.fixture.ts'
import { packDagSelection } from '../../gpu/dag/selection.ts'
import { packedWorldsToRenderOrigin } from '../../gpu/dag/pack.fixture.ts'
import { evaluateDagSelectionKernel } from '../../gpu/dag/oracle/oracle.fixture.ts'
import { flatHierarchy } from '../../gpu/dag/hierarchy.ts'
import { structureIndex } from '../../page/selection/structure.ts'
import { postPackedBases } from '../../page/selection/placements.ts'
import { createGroupClosure } from '../../page/cut/groupClosure.ts'
import { cameraSelectionUniforms } from '../../gpu/core/selection.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { createRowUse } from './rowUse.ts'
import { createRowDemand } from './rowDemand.ts'
import type { DagRoot } from '../../gpu/dag/types.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { IdDelta } from '../cut/delta.ts'

/** `count` host meshes of one page — a box, its cluster its own root —, laid out by `at`. */
function hostMeshes(count: number, at: (k: number) => [number, number]) {
  return Array.from({ length: count }, (_, k): DagRoot => {
    const [x, z] = at(k)
    const pages = [
      {
        ...{ url: `box${k}`, level: 0, lodError: 0, sphere: [0, 0.5, 0, 0.6], triangles: 12 },
        ...{ parentError: null, parentSphere: null, min: [-0.05, 0, -0.05], max: [0.05, 1, 0.05] },
      },
    ]
    const elements = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, z, 1)
    const structure = structureIndex({ version: 1, roots: [0], groups: [] }, 1)
    return { world: { elements }, pages, culling: flatHierarchy(pages), structure } as DagRoot
  })
}

const FAMILIES: Array<[string, DagRoot[], number]> = [
  ['cooked placements on a grid of 900', placementField(30, 6), 180],
  [
    'host boxes scattered, 3000',
    hostMeshes(3000, ((n) => () => [n() * 200, -n() * 200])(random(3))),
    200,
  ],
  [
    'host boxes in clumps, 2000',
    hostMeshes(2000, (k) => [40 * (k % 4) + (k % 23), -40 * (k % 3) - (k % 17)]),
    160,
  ],
]

test('a still camera closes nothing over; a moving one, its lists’ differences alone', () => {
  for (const [name, roots, span] of FAMILIES) {
    const pages = roots.flatMap((root) => root.pages) as unknown as PageRec[],
      placement = postPackedBases(roots as never),
      packed = packDagSelection(roots)
    let closed = 0
    const counted = () => {
      const closure = createGroupClosure(roots as never, placement, pages, true),
        apply = closure.apply
      closure.apply = (cut: IdDelta) => ((closed += cut.enteredCount + cut.exitedCount), apply(cut))
      return closure
    }
    const table = {
      rowOfPage: new Int32Array(pages.length).fill(-1),
      residentFlags: new Uint32Array(pages.length),
    }
    const demand = createRowDemand(table, createRowUse(pages.length), () => true, pages, counted)
    const centre = [span / 2, 0, -span / 2]
    let before = 0,
      after = 0
    for (let frame = 0; frame < 12; frame++) {
      const moving = frame >= 4,
        a = moving ? (frame - 4) * 0.2 : 0
      const eye = [centre[0] + span * Math.sin(a), 0.72 * span, centre[2] + span * Math.cos(a)]
      const motion = moving
        ? { velocity: Float64Array.of(span * 0.2, 0, 0), turn: 0.2, axis: Float64Array.of(0, 1, 0) }
        : {}
      const uniforms = cameraSelectionUniforms(
        engineCamera(fieldCamera(eye, centre, 3 * span)),
        1,
        [1280, 720],
        undefined,
        motion,
      )
      packedWorldsToRenderOrigin(packed, roots, uniforms.cameraWorld)
      const cut = evaluateDagSelectionKernel(packed, uniforms)
      closed = 0
      demand.follow(cut)
      const lists =
        (cut.drawablePageIds?.length ?? 0) + cut.pageIds.length + (cut.aheadPageIds?.length ?? 0)
      if (frame > 0 && !moving) assert.equal(closed, 0, `${name}: still, frame ${frame}`)
      if (frame > 0) {
        before += lists
        after += closed
      }
      // What it wants: the requests' closure, as a walk of every request would find it.
      const wanted = new Set<number>()
      createGroupClosure(roots as never, placement, pages).closeOver(
        [...cut.pageIds, ...(cut.aheadPageIds ?? [])],
        (id) => void wanted.add(id),
        undefined,
        true,
      )
      for (let page = 0; page < pages.length; page++)
        assert.equal(demand.wanted(page), wanted.has(page), `${name}, frame ${frame}, page ${page}`)
    }
    assert.ok(after < before, `${name}: ${after} ids closed over, ${before} before`)
    console.log(`${name}: ids closed over ${before} → ${after}`)
  }
})
