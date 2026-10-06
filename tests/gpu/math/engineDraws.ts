// What the engine draws of defect 6's cases: not a model of what it should draw, but the cases
// rasterised on Dawn with the engine's face state — `cullMode:'back'`, and the `frontFace` that
// `windingCw` flips under a mirror —, one fragment counter per case (`../pages/windingRaster.ts`).
//
// Why this truth and not `rawOrientation`: the transformed vertices' raw orientation ignores that
// the engine swaps the culled face when the determinant is negative, and under a mirror calls
// "facing" the face the engine does not draw. A cluster the cut drops is a DEFECT only when the
// engine draws fragments of it; otherwise the drop is right.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { windingCw } from '../../../packages/sdk-browser/src/webgpu/pages/render/winding.ts'
import { runWindingRaster } from '../pages/windingRaster.ts'
import { camera, type Case, type rawOrientation } from './inverseTransposeCases.ts'

/** A square view fine enough that each case covers thousands of pixels, small enough that the
 *  6 916 rasterisations, CPU and GPU, take a few seconds. */
export const RASTER_VIEWPORT: [number, number] = [128, 128]

/** The root a case's page is placed by: the case's world. */
export const rootsOf = (lit: Case) => [{ world: lit.world }]

/** The winding the engine draws a case with: its own `windingCw`, on a root carrying the world
 *  matrix — `windingCw` reads nothing else (and caches on it). */
const windingOf = (lit: Case): 'cw' | 'ccw' => (windingCw(rootsOf(lit), 0) ? 'cw' : 'ccw')

/** The raster's load for `cases`: vertices transformed in f64 — the question is orientation, not
 *  rounding —, grouped by winding, one counter slot per case. */
function rasterLoad(cases: Case[]) {
  const vertices: number[] = []
  const ranges: ['ccw' | 'cw', number, number][] = []
  for (const winding of ['ccw', 'cw'] as const) {
    const first = vertices.length / 4
    cases.forEach((lit, i) => {
      if (windingOf(lit) !== winding) return
      for (const vertex of lit.indices) {
        const p = new G.Vector3().fromArray(lit.positions, vertex * 3).applyMatrix4(lit.world)
        vertices.push(p.x, p.y, p.z, i)
      }
    })
    ranges.push([winding, first, vertices.length / 4 - first])
  }
  camera.updateWorldMatrix(true, false)
  const viewProj = [
    ...new G.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .elements,
  ]
  const [width, height] = RASTER_VIEWPORT
  return { vertices, ranges, viewProj, width, height, slots: cases.length }
}

/** For each case, whether the engine draws a fragment of it; the fragments; the adapter. */
export async function engineDraws(cases: Case[]) {
  const { adapter, fragments } = await runWindingRaster(rasterLoad(cases))
  return { adapter, fragments, drawn: cases.map((_, i) => fragments[i] > 0) }
}

/**
 * The cut's culls against what the engine draws. The raw count — "the raw orientation says facing
 * and the cut culls" — is not silently replaced: it is kept as `raw` and split in two, and what the
 * raw orientation did NOT see is counted beside it.
 *   — `wrong`: the cut culls a cluster the engine draws fragments of. THE defect.
 *   — `rawDrawn`: the part of the raw count that is a defect.
 *   — `rawUndrawn`: the part that was not — the engine draws nothing of it.
 *   — `missedByRaw`: defects the raw count never sees, the raw orientation calling them facing away
 *     while the engine draws them (the face swap under a mirror plays both ways).
 * Invariants: `raw = rawDrawn + rawUndrawn` and `wrong = rawDrawn + missedByRaw`.
 */
export function classifyCulls(
  raw: ReturnType<typeof rawOrientation>[],
  draws: Awaited<ReturnType<typeof engineDraws>>,
) {
  const index = raw.map((_, i) => i)
  const facing = (i: number) => raw[i].frontVisible
  const drawn = (i: number) => draws.drawn[i]
  const count = (culls: boolean[], holds: (i: number) => boolean) =>
    index.filter((i) => culls[i] && holds(i)).length
  const population = (culls: boolean[]) => ({
    raw: count(culls, facing),
    wrong: count(culls, drawn),
    rawDrawn: count(culls, (i) => facing(i) && drawn(i)),
    rawUndrawn: count(culls, (i) => facing(i) && !drawn(i)),
    missedByRaw: count(culls, (i) => !facing(i) && drawn(i)),
  })
  return { index, population }
}
