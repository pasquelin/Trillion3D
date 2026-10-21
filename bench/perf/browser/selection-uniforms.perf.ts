// What the selection dispatch writes on the CPU every view of every image (`selectionDispatchMs`):
// the camera's selection uniforms, as `renderGpuCut` rewrites them in place
// (`packages/sdk-browser/src/gpu/core/selection.ts`), and the cut's uniform block, as the dispatch
// writes it for the camera (`geometry/dag/uniforms.ts`).
import {
  cameraSelectionUniforms,
  createSelectionUniforms,
  type SelectionUniforms,
} from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { writeDagUniforms } from '../../../packages/sdk-browser/src/geometry/dag/uniforms.ts'
import { VIEW_BLOCK_WORDS } from '../../../packages/sdk-browser/src/geometry/dag/viewLayout.ts'
import {
  createEngineCamera,
  writeEngineCamera,
} from '../../../packages/sdk-browser/src/camera/engineCamera.ts'
import type { PackedDag } from '../../../packages/sdk-browser/src/geometry/dag/types.ts'
import { measure } from '../../core/measure.ts'
import { rapport } from '../../core/report.ts'
import {
  readViewBlock,
  referenceCameraUniforms,
  referenceViewBlock,
  uniformsOf,
} from '../../oracles/browser/selection-uniforms.ts'

const VIEWPORT: [number, number] = [1920, 1080],
  PIXEL_ERROR = 2

/** A camera walking and turning along a street, far from the world origin, `frames` poses. */
function street(frames: number) {
  return Array.from({ length: frames }, (_, i) => {
    const cam = createEngineCamera(),
      yaw = i * 0.01,
      [c, s] = [Math.cos(yaw), Math.sin(yaw)]
    cam.world.set([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 5e4 + i * 0.07, 1.7, -3e4 + i * 0.05, 1])
    return writeEngineCamera(cam, { fov: 60, aspect: 16 / 9, near: 0.1, far: 5000, zoom: 1 })
  })
}
type Walk = {
  cameras: ReturnType<typeof street>
  into: ReturnType<typeof createSelectionUniforms>
}
const walk = (frames: number): Walk => ({
  cameras: street(frames),
  into: createSelectionUniforms(),
})

const resCamera = await measure({
  name: 'camera selection uniforms',
  fichier: 'packages/sdk-browser/src/gpu/core/selection.ts',
  cas: [{ name: '400 frames, walking and turning', input: walk(400), size: 400 }],
  calculation: ({ cameras, into }: Walk) => {
    for (const cam of cameras) cameraSelectionUniforms(cam, PIXEL_ERROR, VIEWPORT, into)
    return into
  },
  // The block the last frame left, in place over the 399 before it, against that frame's contract.
  expected: ({ cameras }: Walk) =>
    referenceCameraUniforms(cameras[cameras.length - 1], PIXEL_ERROR, VIEWPORT),
  lecture: (e: Walk, u: unknown) => (u === e.into ? uniformsOf(e.into) : u),
  options: { tours: 200, budgetMs: 1000 },
})

// The cut's block, for the camera.
const camera = createSelectionUniforms()
cameraSelectionUniforms(street(1)[0], PIXEL_ERROR, VIEWPORT, camera)
const dag = { pageCount: 120000, nodeCount: 40000, worldCount: 2479 }
type BlockCase = {
  target: Float32Array
  packed: typeof dag
  uniforms: SelectionUniforms
}
const LIST_CAP = 65536

const resBlock = await measure({
  name: 'view uniform block',
  fichier: 'packages/sdk-browser/src/geometry/dag/uniforms.ts',
  cas: [
    {
      name: 'the camera',
      input: { target: new Float32Array(VIEW_BLOCK_WORDS), packed: dag, uniforms: camera },
      size: 1,
    },
  ],
  calculation: ({ target, packed, uniforms }: BlockCase) => {
    writeDagUniforms(target, packed as unknown as PackedDag, uniforms, LIST_CAP)
    return target
  },
  expected: ({ packed, uniforms }: BlockCase) => referenceViewBlock(packed, uniforms, LIST_CAP),
  lecture: (e: BlockCase, t: unknown) => (t === e.target ? readViewBlock(e.target) : t),
  options: { tours: 200, budgetMs: 1000 },
})

rapport(
  'uniformes-selection',
  [resCamera, resBlock],
  'the selection dispatch writes the uniforms its contract names',
)
