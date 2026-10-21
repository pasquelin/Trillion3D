import { sameElements, sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import type { SelectionUniforms } from './selection.ts'

/** Same threshold, projection and pose: the view a readback describes. The occlusion's inputs —
 *  the render matrices, the pyramid's image — are not compared: whether a cut stands across frames
 *  is the swap's question (`../../geometry/dag/swap/swap.ts`, `stampMatches`). */
export function sameSelectionUniforms(a: SelectionUniforms, b: SelectionUniforms) {
  if (
    a.pixelError !== b.pixelError ||
    (a.cullOff ?? 0) !== (b.cullOff ?? 0) ||
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
  return sameElements(a.view, b.view) && sameValues(a.planes, b.planes)
}

export function copySelectionUniforms(source: SelectionUniforms): SelectionUniforms {
  return {
    planes: source.planes.slice(),
    view: source.view.slice(),
    pixelScale: [source.pixelScale[0], source.pixelScale[1]],
    pixelError: source.pixelError,
    near: source.near,
    cameraWorld: [source.cameraWorld[0], source.cameraWorld[1], source.cameraWorld[2]],
    perspective: source.perspective,
    viewProj: source.viewProj.slice(),
    depthMap: [source.depthMap[0], source.depthMap[1]],
    viewSize: [source.viewSize[0], source.viewSize[1]],
    occlusion: source.occlusion,
    cullOff: source.cullOff,
    prevViewProj: source.prevViewProj?.slice(),
    prevDepthMap: source.prevDepthMap && [source.prevDepthMap[0], source.prevDepthMap[1]],
    prevSize: source.prevSize && [source.prevSize[0], source.prevSize[1]],
    frame: source.frame,
  }
}
