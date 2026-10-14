// The generated placed scene the row and streaming proofs cut on Dawn (`../row/rowClosureRun.ts`,
// `../row/rowCacheScene.ts`, `../streaming/evictionWorld.ts`): `copies` placements of the cut-rule
// DAG along x, packed, and the strip camera's uniforms at any x, the packing's worlds brought to its
// render frame. Each proof adds its own rows, residency or pages.
import { ruleDag } from '../../../packages/sdk-browser/src/page/cut/cutRule.fixture.ts'
import {
  placements,
  stripCamera,
} from '../../../packages/sdk-browser/src/page/cut/cutRuleBackends.fixture.ts'
import { postPackedBases } from '../../../packages/sdk-browser/src/page/selection/placements.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/pack.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { writeEngineCamera } from '../../../packages/sdk-browser/src/camera/engineCamera.ts'

type Placed = ReturnType<typeof placements>

/**
 * `copies` placements of the cut-rule DAG of `leaves` leaves, each `spacing` further along -x (+x
 * when negative), `shape` making them what the proof places before they are packed; their packed
 * bases and packing, and `view(x)`: the strip camera slid `x` along x, the packing's worlds brought
 * to its render frame, the uniforms it cuts under.
 */
export function placedRuleDag(
  copies: number,
  spacing: number,
  leaves = 64,
  shape: (roots: Placed) => Placed = (roots) => roots,
) {
  const dag = ruleDag(leaves)
  const roots = shape(placements(dag, copies, spacing))
  const placement = postPackedBases(roots)
  const packed = packDagSelection(roots)
  const view = (x = 0) => {
    const cam = stripCamera(dag)
    cam.world[12] += x
    writeEngineCamera(cam, { fov: 70, aspect: 16 / 9, near: 0.1, far: 4000, zoom: 1 })
    packedWorldsToRenderOrigin(packed, roots, cam.eye)
    return cameraSelectionUniforms(cam, 1, [1280, 720])
  }
  return { dag, roots, placement, packed, view }
}
