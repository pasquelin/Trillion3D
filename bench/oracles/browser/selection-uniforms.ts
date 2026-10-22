// Selection-dispatch oracles, written from the contracts: what a camera's selection uniforms hold
// (`packages/sdk-browser/src/gpu/core/selection.ts`), and what the cut's uniform block holds, read
// back field by field by the names the kernels read it by
// (`packages/sdk-browser/src/geometry/dag/viewLayout.ts`, `uniforms.ts`).
import { matrixAtRenderOrigin } from '../../../packages/math/src/projection/renderOrigin.ts'
import { viewWord } from '../../../packages/sdk-browser/src/geometry/dag/viewLayout.ts'
import type { EngineCamera } from '../../../packages/sdk-browser/src/camera/engineCamera.ts'
import type { SelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'

/** A selection uniform block as plain numbers: what a reader compares, whoever wrote it. */
export const uniformsOf = (u: SelectionUniforms) => ({
  planes: Array.from(u.planes),
  view: Array.from(u.view),
  pixelScale: [...u.pixelScale],
  pixelError: u.pixelError,
  near: u.near,
  cameraWorld: [...u.cameraWorld],
  perspective: u.perspective,
  viewProj: Array.from(u.viewProj),
  depthMap: [...u.depthMap],
  viewSize: [...u.viewSize],
})

/** The uniforms of `cam`: its render frame's planes and view rounded to single precision, the
 *  projection's pixel scale over `viewport`, the eye as the frame's origin, the render matrix at
 *  the eye rounded to single precision, the projection's clip depth along its clip weight
 *  (`z = -P[10]·w + P[14]`) and the view's size. */
export function referenceCameraUniforms(
  cam: EngineCamera,
  pixelError: number,
  [width, height]: [number, number],
) {
  return uniformsOf({
    planes: Float32Array.from(cam.planesRelative),
    view: Float32Array.from(cam.viewRelative),
    pixelScale: [
      (width * Math.abs(cam.projection[0])) / 2,
      (height * Math.abs(cam.projection[5])) / 2,
    ],
    pixelError,
    near: cam.near,
    cameraWorld: [cam.eye[0], cam.eye[1], cam.eye[2]],
    perspective: cam.perspective,
    viewProj: Float32Array.from(
      matrixAtRenderOrigin(new Float64Array(16), cam.viewProjection, cam.eye),
    ),
    depthMap: [-cam.projection[10], cam.projection[14]],
    viewSize: [width, height],
    clipPlane: [0, 0, 0, 0],
  })
}

/** Each field of the block a camera's cut fills, its kind and its width: the table the kernels'
 *  struct declares. */
const FIELDS = [
  ['planes', 'f', 24],
  ['view', 'f', 16],
  ['viewProj', 'f', 16],
  ['pixelScale', 'f', 2],
  ['pixelError', 'f', 1],
  ['near', 'f', 1],
  ['depthMap', 'f', 2],
  ['viewSize', 'u', 2],
  ['clusterCount', 'u', 1],
  ['nodeCount', 'u', 1],
  ['worldCount', 'u', 1],
  ['occlusion', 'u', 1],
  ['cullOff', 'u', 1],
  ['cameraWorld', 'f', 3],
  ['listCap', 'u', 1],
  ['perspective', 'f', 1],
  ['queueCap', 'u', 1],
  ['treeTop', 'u', 1],
  ['cellBase', 'u', 1],
] as const
type Block = Record<(typeof FIELDS)[number][0], number[]>

/** The cut's uniform block, read back by field name. */
export function readViewBlock(target: Float32Array): Block {
  const ints = new Uint32Array(target.buffer, target.byteOffset, target.length)
  const block = {} as Block
  for (const [name, kind, words] of FIELDS) {
    const at = viewWord(name)
    block[name] = Array.from((kind === 'f' ? target : ints).subarray(at, at + words))
  }
  return block
}

/** The block a camera's uniforms must leave, from the contract: every field it does not name
 *  stays zero — no occlusion, no cull turned off, no placement tree. */
export function referenceViewBlock(
  packed: { pageCount: number; nodeCount: number; worldCount: number },
  u: SelectionUniforms,
  listCap: number,
): Block {
  const zero = Object.fromEntries(FIELDS.map(([n, , w]) => [n, new Array(w).fill(0)])) as Block
  return {
    ...zero,
    planes: Array.from(u.planes),
    view: Array.from(u.view),
    viewProj: Array.from(u.viewProj),
    pixelScale: u.pixelScale.map(Math.fround),
    pixelError: [Math.fround(u.pixelError)],
    near: [Math.fround(u.near)],
    depthMap: u.depthMap.map(Math.fround),
    viewSize: [...u.viewSize],
    clusterCount: [packed.pageCount],
    nodeCount: [packed.nodeCount],
    worldCount: [packed.worldCount],
    cameraWorld: u.cameraWorld.map(Math.fround),
    listCap: [listCap],
    perspective: [Math.fround(u.perspective ?? 1)],
    // Two words a descent entry: an entry for each node of a packing that names no other bound,
    // beside queue 0's root slot of each placement.
    queueCap: [2 * (Math.max(1, packed.nodeCount) + Math.max(1, packed.worldCount))],
  }
}
