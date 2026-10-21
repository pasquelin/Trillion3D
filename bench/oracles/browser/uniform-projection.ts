// Oracle of the projection uniform, rewritten from the contract: a double becomes a high f32
// plus a remainder f32; an anchored matrix keeps its three columns and sees its translation
// recomputed at the anchor. The layout comes from the contract's one table (`PROJECTION_UNI`), so
// the oracle does not drift in silence; the pyramid's mips are the Hi-Z levels uniform's.
import {
  PROJECTION_UNI,
  type ProjectionFrame,
} from '../../../packages/sdk-browser/src/gpu/core/projectionUniform.ts'

export function referenceSplitDouble(out: Float32Array, top: number, bas: number, value: number) {
  out[top] = value
  out[bas] = value - out[top]
}

function ancree(elements: ArrayLike<number>, anchor: readonly number[]) {
  const out = new Float32Array(16)
  for (let i = 0; i < 12; i++) out[i] = elements[i]
  for (let row = 0; row < 4; row++)
    out[12 + row] =
      elements[row] * anchor[0] +
      elements[4 + row] * anchor[1] +
      elements[8 + row] * anchor[2] +
      elements[12 + row]
  return out
}

export function referenceProjectionUniform(frame: ProjectionFrame) {
  const at = PROJECTION_UNI.at
  const f32 = new Float32Array(PROJECTION_UNI.words),
    u32 = new Uint32Array(f32.buffer)
  f32.set(ancree(frame.view, frame.anchor), at.view)
  f32.set(ancree(frame.viewProj, frame.anchor), at.viewProj)
  for (let i = 0; i < 3; i++)
    referenceSplitDouble(f32, at.anchorHigh + i, at.anchorLow + i, frame.anchor[i])
  f32[at.near] = frame.near
  u32[at.width] = frame.width
  u32[at.height] = frame.height
  u32[at.layerTop] = frame.layerTop
  return u32
}
