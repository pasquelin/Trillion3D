// Selection-dispatch oracles, written from the contracts: what a camera's selection uniforms hold
// (`packages/sdk-browser/src/gpu/core/selection.ts`), and what one view's uniform block holds,
// read back field by field by the names the kernels read it by
// (`packages/sdk-browser/src/gpu/dag/viewLayout.ts`, `uniforms.ts`).
import { maxStretch } from '../../../packages/sdk-core/src/index.ts'
import { aheadViewOf } from '../../../packages/sdk-browser/src/gpu/core/aheadView.ts'
import { viewWord } from '../../../packages/sdk-browser/src/gpu/dag/viewLayout.ts'
import { AHEAD_VIEW } from '../../../packages/sdk-browser/src/gpu/dag/shader/aheadWgsl.ts'
import { VIEW_BLOCK_WORDS } from '../../../packages/sdk-browser/src/gpu/dag/viewLayout.ts'
import type { EngineCamera } from '../../../packages/sdk-browser/src/camera/engineCamera.ts'
import type { CameraMotion } from '../../../packages/sdk-browser/src/camera/motion.ts'
import type { SelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import type { DagViewUniforms } from '../../../packages/sdk-browser/src/gpu/dag/types.ts'

const f32 = Math.fround

/** A selection uniform block as plain numbers: what a reader compares, whoever wrote it. */
export const uniformsOf = (u: SelectionUniforms) => ({
  planes: Array.from(u.planes),
  view: Array.from(u.view),
  pixelScale: [...u.pixelScale],
  pixelError: u.pixelError,
  near: u.near,
  cameraWorld: [...u.cameraWorld],
  cameraStretch: u.cameraStretch,
  perspective: u.perspective,
  ahead: u.ahead ? { planes: Array.from(u.ahead.planes), view: Array.from(u.ahead.view) } : null,
})

/** The uniforms of `cam`: its render frame's planes and view rounded to single precision, the
 *  projection's pixel scale over `viewport`, the eye as the frame's origin, the view's stretch,
 *  and the view ahead of `motion` computed afresh. */
export function referenceCameraUniforms(
  cam: EngineCamera,
  pixelError: number,
  [width, height]: [number, number],
  motion: CameraMotion,
) {
  const ahead = aheadViewOf(cam, motion)
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
    cameraStretch: maxStretch(cam.viewRelative),
    perspective: cam.perspective,
    ahead,
  })
}

/** Each field of the block, its kind and its width: the table the kernels' struct declares. */
const FIELDS = [
  ['planes', 'f', 24],
  ['view', 'f', 16],
  ['pixelScale', 'f', 2],
  ['pixelError', 'f', 1],
  ['near', 'f', 1],
  ['clusterCount', 'u', 1],
  ['nodeCount', 'u', 1],
  ['worldCount', 'u', 1],
  ['cameraWorld', 'f', 3],
  ['cameraStretch', 'f', 1],
  ['listCap', 'u', 1],
  ['perspective', 'f', 1],
  ['viewCount', 'u', 1],
  ['viewCapacity', 'u', 1],
  ['queueCap', 'u', 1],
  ['ahead', 'u', 1],
  ['lightOriginHigh', 'f', 4],
  ['lightOriginLow', 'f', 4],
  ['lightPlanes', 'f', 24],
] as const
type Block = Record<(typeof FIELDS)[number][0], number[]>

/** Block `index` of a uniform array, read back by field name. */
export function readViewBlock(target: Float32Array, index: number): Block {
  const ints = new Uint32Array(target.buffer, target.byteOffset, target.length),
    base = index * VIEW_BLOCK_WORDS
  const block = {} as Block
  for (const [name, kind, words] of FIELDS) {
    const at = base + viewWord(name)
    block[name] = Array.from((kind === 'f' ? target : ints).subarray(at, at + words))
  }
  return block
}

/** The blocks a camera's uniforms must leave, from the contract: every field it does not name
 *  stays zero. */
export function referenceViewBlocks(
  packed: { pageCount: number; nodeCount: number; worldCount: number },
  u: DagViewUniforms,
  listCap: number,
  blocks: number,
) {
  const zero = Object.fromEntries(FIELDS.map(([n, , w]) => [n, new Array(w).fill(0)])) as Block
  const first: Block = {
    ...zero,
    planes: Array.from(u.planes),
    view: Array.from(u.view),
    pixelScale: u.pixelScale.map(f32),
    pixelError: [f32(u.pixelError)],
    near: [f32(u.near)],
    clusterCount: [packed.pageCount],
    nodeCount: [packed.nodeCount],
    worldCount: [packed.worldCount],
    cameraWorld: u.cameraWorld.map(f32),
    cameraStretch: [f32(u.cameraStretch ?? 1)],
    listCap: [listCap],
    perspective: [f32(u.perspective ?? 1)],
    viewCount: [1],
    viewCapacity: [1],
    queueCap: [packed.nodeCount],
  }
  const out = Array.from({ length: blocks }, () => zero)
  out[0] = first
  // A moving camera's view ahead: block 1 repeats block 0 with the planes and view ahead, and
  // block 0 says it is there.
  if (u.ahead && blocks > AHEAD_VIEW) {
    out[AHEAD_VIEW] = {
      ...first,
      planes: Array.from(u.ahead.planes),
      view: Array.from(u.ahead.view),
    }
    out[0] = { ...first, ahead: [1] }
  }
  return out
}
