import { viewProj } from '../../frame/backend/helpers.ts'

/** The bytes of the view's uniform: two matrices and eleven vectors. */
export const HV_VIEW_BYTES = (16 + 4 * 9 + 16 + 8) * 4

/** The view's uniform: the unprojection, the eye, the forward and the depth's numbers, the rectangle, the pre-exposure
 *  and the lights' exposure, the clocks, the switches (whether this is the first volume, the downsample, the frame, the node
 *  the sparse volume belongs to) and the sparse volume's two packed words. */
export function packView(
  camera: {
    inverseViewProj: ArrayLike<number>
    eye: ArrayLike<number>
    forward: ArrayLike<number>
    depthMap: readonly [number, number]
    perspective: boolean
    /** The camera's view-projection and the translucency volume's grid and law, none where the image made none. */
    viewProj?: ArrayLike<number>
    giGrid?: ArrayLike<number>
    giZ?: ArrayLike<number>
  },
  rect: readonly [number, number, number, number],
  exposure: readonly [number, number],
  clocks: readonly [number, number],
  flags: readonly [number, number, number, number],
  words: ArrayLike<number>,
) {
  const out = new ArrayBuffer(HV_VIEW_BYTES)
  const floats = new Float32Array(out)
  const unsigned = new Uint32Array(out)
  floats.set(camera.inverseViewProj, 0)
  floats.set([camera.eye[0], camera.eye[1], camera.eye[2], 1], 16)
  floats.set([camera.forward[0], camera.forward[1], camera.forward[2], 0], 20)
  floats.set([camera.depthMap[0], camera.depthMap[1], camera.perspective ? 0 : 1, 0], 24)
  unsigned.set(rect, 28)
  floats.set([exposure[0], 0, 0, exposure[1]], 32)
  floats.set([clocks[0], clocks[1], 0, 0], 36)
  unsigned.set(flags, 40)
  for (let i = 0; i < 8; i++) unsigned[44 + i] = words[i]
  if (camera.viewProj) floats.set(camera.viewProj, 52)
  if (camera.giGrid) floats.set(camera.giGrid, 68)
  if (camera.giZ) floats.set(camera.giZ, 72)
  return out
}
