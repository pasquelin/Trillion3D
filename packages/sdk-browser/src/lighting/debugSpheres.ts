// What the two debug sphere draws share (the lightmap's samples, the translucency volume's cells): the pipeline's descriptor, a uniform block rewritten only where it changed (`uniformBlock`), and the pass.
import { DEPTH_COMPARE_OR_EQUAL } from '../camera/depthConvention.ts'
import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import { preparedPipeline } from './deferred/fullscreen.ts'

/** What differs from one sphere draw to the other: its program, its layout and the targets it writes. */
export interface SpheresProgram {
  readonly label: string
  readonly module: GPUShaderModule
  readonly vertex: string
  readonly fragment: string
  readonly layout: GPUPipelineLayout | 'auto'
  readonly targets: readonly GPUColorTargetState[]
}

/** The spheres' pipeline, asked off the frame: drawn without culling, depth tested and written like any surface (the depth runs 1 at the near plane to 0 at infinity). */
export function askSpheresPipeline(device: GPUDevice, program: SpheresProgram) {
  const { module } = program
  return preparedPipeline(device, {
    label: program.label,
    layout: program.layout,
    vertex: { module, entryPoint: program.vertex },
    fragment: { module, entryPoint: program.fragment, targets: program.targets },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled: true,
      depthCompare: DEPTH_COMPARE_OR_EQUAL,
    },
  }).ask()
}

/** The pass of a sphere draw: its colours kept as they are, the scene's depth tested and written. */
export function beginSpheresPass(
  encoder: GPUCommandEncoder,
  label: string,
  colours: readonly GPUTextureView[],
  depth: GPUTextureView,
) {
  return encoder.beginRenderPass({
    label,
    colorAttachments: colours.map((view) => ({ view, loadOp: 'load', storeOp: 'store' })),
    depthStencilAttachment: { view: depth, depthLoadOp: 'load', depthStoreOp: 'store' },
  })
}
