import { sameElements } from '../../../../math/src/matrix/matrixElements.ts'
import { copyAheadView } from './aheadView.ts'
import type { SelectionUniforms } from './selection.ts'

/** Same threshold, projection and pose. The view ahead changes no page drawn nor visible request:
 *  uncompared, the last readback of a move is the stopped camera's cut, adopted with no other. */
export function sameSelectionUniforms(a: SelectionUniforms, b: SelectionUniforms) {
  if (
    a.pixelError !== b.pixelError ||
    !a.admitByLevel !== !b.admitByLevel ||
    a.near !== b.near ||
    (a.perspective ?? 1) !== (b.perspective ?? 1) ||
    a.pixelScale[0] !== b.pixelScale[0] ||
    a.pixelScale[1] !== b.pixelScale[1]
  )
    return false
  if (
    a.cameraWorld[0] !== b.cameraWorld[0] ||
    a.cameraWorld[1] !== b.cameraWorld[1] ||
    a.cameraWorld[2] !== b.cameraWorld[2]
  )
    return false
  if (!sameElements(a.view, b.view)) return false
  for (let i = 0; i < 24; i++) if (a.planes[i] !== b.planes[i]) return false
  return true
}

export function copySelectionUniforms(source: SelectionUniforms): SelectionUniforms {
  return {
    planes: source.planes.slice(),
    view: source.view.slice(),
    pixelScale: [source.pixelScale[0], source.pixelScale[1]],
    pixelError: source.pixelError,
    near: source.near,
    cameraWorld: [source.cameraWorld[0], source.cameraWorld[1], source.cameraWorld[2]],
    cameraStretch: source.cameraStretch,
    perspective: source.perspective,
    ahead: copyAheadView(source.ahead),
    admitByLevel: source.admitByLevel,
  }
}
