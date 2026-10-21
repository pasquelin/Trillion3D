// What the engine draws of defect 6's cases: not a model of what it should draw, but the cases
// rasterised on Dawn with the engine's face state — `cullMode:'back'`, and the `frontFace` that
// `windingCw` flips under a mirror —, one fragment counter per case (`../pages/windingRaster.ts`).
//
// Why this truth and not `rawOrientation`: the transformed vertices' raw orientation ignores that
// the engine swaps the culled face when the determinant is negative, and under a mirror calls
// "facing" the face the engine does not draw.
import { Vector3 } from '../../../packages/sdk-core/src/world/math/vector3.ts'
import { Matrix4 } from '../../../packages/sdk-core/src/world/math/matrix4.ts'
import { windingCw } from '../../../packages/sdk-browser/src/frame/render/winding.ts'
import { runWindingRaster } from '../pages/windingRaster.ts'
import { camera, type Case } from './inverseTransposeCases.ts'

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
        const p = new Vector3().fromArray(lit.positions, vertex * 3).applyMatrix4(lit.world)
        vertices.push(p.x, p.y, p.z, i)
      }
    })
    ranges.push([winding, first, vertices.length / 4 - first])
  }
  camera.updateWorldMatrix(true, false)
  const viewProj = [
    ...new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements,
  ]
  const [width, height] = RASTER_VIEWPORT
  return { vertices, ranges, viewProj, width, height, slots: cases.length }
}

/** For each case, whether the engine draws a fragment of it; the fragments; the adapter. */
export async function engineDraws(cases: Case[]) {
  const { adapter, fragments } = await runWindingRaster(rasterLoad(cases))
  return { adapter, fragments, drawn: cases.map((_, i) => fragments[i] > 0) }
}
