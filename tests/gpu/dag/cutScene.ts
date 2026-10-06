// The scene the cut's whole-frame proofs mount (`cut-dispatches`, `cut-snapshot`, `frame-ranges`):
// a pyramid of levels placed once per pose, seen from the front, and the command count an encode
// opens.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/pack.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { engineCamera } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts'
import { frontCamera } from '../../../packages/sdk-browser/src/page/selection/dag.fixture.ts'
import { ruleResidency } from '../../../packages/sdk-browser/src/gpu/dag/readiness.fixture.ts'
import {
  scenePages,
  sceneRoots,
} from '../../../packages/sdk-browser/src/gpu/dag/cutFrontierScene.fixture.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts'

/** The dispatch proof's scene size, shared with its Node guard (`cut-dispatches-scene.test.ts`). */
export const DISPATCH_SCENE = { leaves: 12000, levels: 8 } as const

/**
 * The scene, one placement per pose, its camera, and the worlds brought back to that camera's
 * render origin. The hierarchy is the compiler's, one node per detail tier under the root. Every
 * page is resident, through the engine's own upload — both bit sets of the cut rule and each
 * node's open count (#486): ready bits alone would make the drawn cut depend on the descent.
 */
export function sceneView(leaves: number, levels: number, poses = [new G.Matrix4()]) {
  const roots = sceneRoots(scenePages(leaves, levels), poses, true)
  const packed = packDagSelection(roots)
  const resident = ruleResidency(packed, new Uint8Array(packed.pageCount).fill(1))
  const uniforms = cameraSelectionUniforms(engineCamera(frontCamera(16, 200)), 1, [1280, 720])
  packedWorldsToRenderOrigin(packed, roots, uniforms.cameraWorld)
  return { packed, uniforms, resident }
}

const nothing = () => {}

/**
 * The commands an encode opens, counted on an encoder that only notes them: compute passes, and
 * copies outside a pass. Published, never asserted here: `gpu/dag/encode.test.ts` holds the
 * command-count contract on the same kind of encoder, without a device.
 */
export function countCommands(encode: (encoder: GPUCommandEncoder) => void) {
  let passes = 0,
    copies = 0
  const pass = {
    setBindGroup: nothing,
    setPipeline: nothing,
    end: nothing,
    dispatchWorkgroups: nothing,
    dispatchWorkgroupsIndirect: nothing,
  }
  // The only methods the two encodes call: the rest of `GPUCommandEncoder` is never reached.
  const encoder = {
    beginComputePass: () => (passes++, pass),
    copyBufferToBuffer: () => copies++,
  } as unknown as GPUCommandEncoder
  encode(encoder)
  return { passes, copies }
}
