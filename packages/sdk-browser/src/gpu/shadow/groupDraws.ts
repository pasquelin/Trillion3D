import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts';
import { casterPrimitive } from './casterPrimitive.ts';
import {
  SHADOW_TRANSLUCENT_DEPTH_FORMAT,
  SHADOW_TRANSMITTANCE_FORMAT,
  TRANSMITTANCE_BLEND,
} from './transmittance.ts';

/** Group 2's bindings of the moving groups' draws (`groupWgsl.ts`): the faces, read at the
 *  fragment too, the group table, the pairs, the lists they name. */
const BINDINGS = [4, 5, 6, 7];

/**
 * THE DRAWS OF THE MOVING GROUPS (#1345), entries of the shadow depth shader (`groupWgsl.ts`):
 * `opaque`, the casters no fragment cuts, whose fragment keeps its page's texels alone and off its
 * emitter's envelope; `cutout`, the cutout casters, with the fragment test besides; `blend`, the
 * blended casters into the transmittance layer, depth only then colour only, as its own region
 * draws (`transmittanceDraws.ts`), against the pool's depth (binding 0 of `blendLayout`). Group 0
 * is the page rows the GPU pages' draws bind (`pageLayout`, `freshDraws.ts`), group 1 the faces',
 * group 2 its own (`layout`, `blendLayout`). A lamp group's draw the same from their clipped vertex
 * entries (`SHADOW_GROUP_LAMP_WGSL`), made when the device clips by distances (`lamps`). Compiled
 * off the frame by `prepare` and `prepareBlend`, or at their first use (`preparedPipeline`).
 */
export function shadowGroupDraws(
  device: GPUDevice,
  module: GPUShaderModule,
  pageLayout: GPUBindGroupLayout,
  faceLayout: GPUBindGroupLayout,
  lamps = false,
) {
  const entries = BINDINGS.map((binding) => ({
    binding,
    visibility: GPUShaderStage.VERTEX | (binding === 4 ? GPUShaderStage.FRAGMENT : 0),
    buffer: { type: 'read-only-storage' as const },
  }));
  const layout = device.createBindGroupLayout({ entries });
  const blendLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      ...entries,
    ],
  });
  const layoutOf = (own: GPUBindGroupLayout) =>
    device.createPipelineLayout({ bindGroupLayouts: [pageLayout, faceLayout, own] });
  const pool = layoutOf(layout),
    tint = layoutOf(blendLayout);
  const pipeline = (
    label: string,
    [vertex, fragment]: [string, string],
    targets: GPUColorTargetState[] = [],
    depthStencil: GPUDepthStencilState = {
      format: 'depth32float',
      depthWriteEnabled: true,
      depthCompare: DEPTH_COMPARE,
    },
  ) =>
    preparedPipeline(device, {
      label: `Trillion3D shadow moving group ${label} v1`,
      layout: targets.length ? tint : pool,
      vertex: { module, entryPoint: vertex },
      fragment: { module, entryPoint: fragment, targets },
      primitive: casterPrimitive(device, { topology: 'triangle-list', cullMode: 'none' }),
      depthStencil,
    });
  const format = SHADOW_TRANSMITTANCE_FORMAT,
    translucent = (depthWriteEnabled: boolean, depthCompare: GPUCompareFunction) => ({
      format: SHADOW_TRANSLUCENT_DEPTH_FORMAT,
      depthWriteEnabled,
      depthCompare,
    });
  /** The four draws of a group whose vertex entries are `shadow_<entry>_…vs`. */
  const kind = (entry: string) => {
    const blend: [string, string] = [`shadow_${entry}_blend_vs`, 'shadow_group_blend_fs'];
    return {
      opaque: pipeline(`${entry} opaque`, [`shadow_${entry}_vs`, 'shadow_group_fs']),
      cutout: pipeline(`${entry} cutout`, [`shadow_${entry}_cutout_vs`, 'shadow_group_cutout_fs']),
      depth: pipeline(
        `${entry} translucent depth`,
        blend,
        [{ format, writeMask: 0 }],
        translucent(true, DEPTH_COMPARE),
      ),
      colour: pipeline(
        `${entry} transmittance`,
        blend,
        [{ format, blend: TRANSMITTANCE_BLEND }],
        translucent(false, 'always'),
      ),
      made: undefined as { opaque: GPURenderPipeline; cutout: GPURenderPipeline } | undefined,
      blended: undefined as readonly [GPURenderPipeline, GPURenderPipeline] | undefined,
    };
  };
  // A sun group's draws; a lamp group's where the device clips each caster to its page.
  const kinds = [kind('group'), ...(lamps ? [kind('group_lamp')] : [])];
  return {
    layout,
    blendLayout,
    /** Whether lamp pages are grouped: the device clips their casters to their pages. */
    lamps,
    prepare: () => Promise.all(kinds.flatMap((k) => [k.opaque.prepare(), k.cutout.prepare()])),
    prepareBlend: () => Promise.all(kinds.flatMap((k) => [k.depth.prepare(), k.colour.prepare()])),
    /** The opaque and cutout draws of a sun's group, or a lamp's (`lamp`). */
    made: (lamp = false) => {
      const k = kinds[+lamp];
      return (k.made ??= { opaque: k.opaque.get(), cutout: k.cutout.get() });
    },
    /** The transmittance layer's two draws of a sun's group or a lamp's, depth then colour. */
    blended: (lamp = false) => {
      const k = kinds[+lamp];
      return (k.blended ??= [k.depth.get(), k.colour.get()] as const);
    },
  };
}
