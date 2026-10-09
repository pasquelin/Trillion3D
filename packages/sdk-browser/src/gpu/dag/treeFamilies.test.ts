// The placement tree adds savings and loses nothing, on generated scene families: grids, scatters
// and clumps of several sizes, placements of their own height, seen from above at 0.72 of the span
// looking at the centre, low along a row and away from it, still and moving (the view ahead). A
// group that straddles the frustum hands each member its own root test: a root outside every view
// asks nothing, whatever group it sits in. Its cut — drawn, asked, asked ahead — is the flat
// descent's, pose by pose, and no more placements reach their own test than the flat descent's,
// which tests them all.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldCamera, placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import { packedWorldsToRenderOrigin } from './pack.fixture.ts'
import { evaluateDagSelectionKernel } from './oracle/oracle.fixture.ts'
import { dagOracleDescent } from './oracle/descent.fixture.ts'
import { dagViewFrames } from './oracle/math.fixture.ts'
import { cameraSelectionUniforms } from '../core/selection.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import type { CameraMotion } from '../../camera/motion.ts'
import type { DagRoot } from './types.ts'

const VIEWPORT: [number, number] = [1280, 720]

/** `count` placements of the field's primitive laid out by `at`, each of its own height. */
function family(count: number, at: (k: number) => [number, number]) {
  const next = random(count),
    template = placementField(1, 1)[0]
  return Array.from({ length: count }, (_, k): DagRoot => {
    const [x, z] = at(k),
      elements = new Float64Array([1, 0, 0, 0, 0, 0.5 + 2 * next(), 0, 0, 0, 0, 1, 0, x, 0, z, 1])
    return { ...template, world: { elements } }
  })
}

const FAMILIES: Array<[string, DagRoot[], number]> = [
  ['a grid of 900', placementField(30, 6), 180],
  ['a grid of 4900', placementField(70, 3), 210],
  ['a scatter of 3000', family(3000, ((n) => () => [n() * 300, -n() * 300])(random(7))), 300],
  [
    'clumps of 2500',
    family(2500, (k) => {
      const c = k % 5,
        a = k * 2.399,
        r = Math.sqrt(k / 5) * 1.5
      return [60 * c + r * Math.cos(a), -60 * (c % 2) + r * Math.sin(a)]
    }),
    300,
  ],
]

/** The poses over a field of side `span` from its corner: above at 0.72 of the span looking at the
 *  centre, from four sides; low along a row; away from the field. */
function poses(span: number): Array<[number[], number[]]> {
  const c = [span / 2, 0, -span / 2],
    around = [0, 1, 2, 3].map((q): [number[], number[]] => {
      const a = (q * Math.PI) / 2
      return [[c[0] + span * Math.sin(a), 0.72 * span, c[2] + span * Math.cos(a)], c]
    })
  return [
    ...around,
    [
      [c[0], 2, 4],
      [c[0], 0, -span],
    ],
    [
      [-20, 3, 20],
      [-200, 0, 200],
    ],
  ]
}

test('on every family the tree cuts as the flat descent and tests no more placements', () => {
  for (const [name, roots, span] of FAMILIES) {
    const dag = packDagSelection(roots)
    assert.ok(dag.placementTree, `${name}: a tree`)
    for (const [eye, at] of poses(span))
      for (const moving of [false, true]) {
        const cam = engineCamera(fieldCamera(eye, at, 2 * span))
        const motion: CameraMotion = moving
          ? { velocity: Float64Array.of(20, 0, -10), turn: 0.8, axis: Float64Array.of(0, 1, 0) }
          : {}
        const uniforms = cameraSelectionUniforms(cam, 1, VIEWPORT, undefined, motion)
        packedWorldsToRenderOrigin(dag, roots, uniforms.cameraWorld)
        const cut = (tree: boolean) => {
          const packed = tree ? dag : { ...dag, placementTree: undefined }
          const result = evaluateDagSelectionKernel(packed, uniforms)
          const frames = dagViewFrames(packed, uniforms),
            ahead = uniforms.ahead
              ? dagViewFrames(packed, { ...uniforms, ...uniforms.ahead })
              : undefined
          const flags = dagOracleDescent(packed, frames, ahead)
          let reached = 0
          for (let w = 0; w < roots.length; w++) if (flags[packed.rootBases[w]] !== 1) reached++
          const lists = [result.drawablePageIds ?? [], result.pageIds, result.aheadPageIds ?? []]
          return { lists: lists.map((ids) => [...ids].sort((a, b) => a - b)), reached }
        }
        const grouped = cut(true),
          flat = cut(false),
          label = `${name}, eye ${eye.map(Math.round)}${moving ? ', moving' : ''}`
        assert.deepEqual(grouped.lists, flat.lists, `${label}: the flat cut`)
        assert.ok(grouped.reached <= flat.reached, `${label}: ${grouped.reached} > ${flat.reached}`)
      }
  }
})
