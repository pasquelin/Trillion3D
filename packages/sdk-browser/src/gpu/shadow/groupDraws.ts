import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts';
import { casterPrimitive } from './casterPrimitive.ts';

/** Group 2's bindings of the moving groups' draws (`groupWgsl.ts`): the faces, read at the
 *  fragment too, the group table, the pairs, the lists they name. */
const BINDINGS = [4, 5, 6, 7];

/**
 * THE DRAWS OF THE MOVING GROUPS (#1345), entries of the shadow depth shader (`groupWgsl.ts`):
 * `opaque`, the casters no fragment cuts, whose fragment keeps its page's texels alone; `cutout`,
 * the cutout casters, with the fragment test besides. Group 0 is the page rows the GPU pages' draws
 * bind (`pageLayout`, `freshDraws.ts`), group 1 the faces', group 2 its own (`layout`). Compiled
 * off the frame by `prepare`, or at once by `made` (`preparedPipeline`).
 */
export function shadowGroupDraws(
  device: GPUDevice,
  module: GPUShaderModule,
  pageLayout: GPUBindGroupLayout,
  faceLayout: GPUBindGroupLayout,
) {
  const layout = device.createBindGroupLayout({
    entries: BINDINGS.map((binding) => ({
      binding,
      visibility: GPUShaderStage.VERTEX | (binding === 4 ? GPUShaderStage.FRAGMENT : 0),
      buffer: { type: 'read-only-storage' },
    })),
  });
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [pageLayout, faceLayout, layout],
  });
  const pipeline = (label: string, vertex: string, fragment: string) =>
    preparedPipeline(device, {
      label: `Trillion3D shadow moving group ${label} v1`,
      layout: pipelineLayout,
      vertex: { module, entryPoint: vertex },
      fragment: { module, entryPoint: fragment, targets: [] },
      primitive: casterPrimitive(device, { topology: 'triangle-list', cullMode: 'none' }),
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: DEPTH_COMPARE,
      },
    });
  const draws = {
    opaque: pipeline('opaque', 'shadow_group_vs', 'shadow_group_fs'),
    cutout: pipeline('cutout', 'shadow_group_cutout_vs', 'shadow_group_cutout_fs'),
  };
  let made: { opaque: GPURenderPipeline; cutout: GPURenderPipeline } | undefined;
  return {
    layout,
    prepare: () => Promise.all([draws.opaque.prepare(), draws.cutout.prepare()]),
    made: () => (made ??= { opaque: draws.opaque.get(), cutout: draws.cutout.get() }),
  };
}
