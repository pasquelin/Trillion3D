import { maxStretch, multiplyMatrix4 } from '../../../../sdk-core/src/index.ts'
import { projectedClusterError } from './math.ts'
import type { PageRec } from './types.ts'
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { type MatrixElements } from '../../host/matrixElements.ts'
import { pixelScaleOf } from '../../streaming/priority.ts'
import type { EngineCamera } from '../../camera/world.ts'

const diagnosticErrorView = new Float64Array(16)
/** Host pose copied: the core product only reads `Float64Array`. */
const diagnosticWorld = new Float64Array(16)
const diagnosticPixelScale = [1, 1]

/** Use the cut's screen-error projection for a displayed page. */
export function projectedPageError(
  rec: Pick<PageRec, 'lodError' | 'sphere'>,
  world: MatrixElements,
  cam: EngineCamera,
  viewport: readonly [number, number],
) {
  if ((rec.lodError ?? 0) === 0) return 0
  copyMatrix4(diagnosticWorld, world.elements)
  const view = multiplyMatrix4(diagnosticErrorView, cam.view, diagnosticWorld)
  const stretch = maxStretch(world.elements) * maxStretch(cam.view)
  const scale = pixelScaleOf(cam.projection, viewport, diagnosticPixelScale)
  const focal = Math.max(scale[0], scale[1])
  const { near, perspective } = cam
  return projectedClusterError(rec.lodError, rec.sphere, 0, view, stretch, focal, near, perspective)
}
