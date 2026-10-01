import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts';
import { casterPrimitive } from './casterPrimitive.ts';
import { clipsLampGroups } from './depthModule.ts';
import { shadowTransmittanceDraws, transmittanceGroupLayout } from './transmittanceDraws.ts';

/** Group 2's bindings of the moving groups' draws (`groupWgsl.ts`): the faces, read at the
 *  fragment too, the group table, the pairs, the lists they name. */
const BINDINGS = [4, 5, 6, 7];

/**
 * THE DRAWS OF THE MOVING GROUPS (#1345), entries of the shadow depth shader (`groupWgsl.ts`):
 * `opaque`, the casters no fragment cuts, whose fragment keeps its page's texels alone and off its
 * emitter's envelope; `cutout`, the cutout casters, with the fragment test besides; `blended`, the
 * blended casters into the transmittance layer, depth only then colour only, the layer's own draws
 * (`shadowTransmittanceDraws`) from the group's entries, against the pool's depth (binding 0 of
 * `blendLayout`). Group 0 is the page rows the GPU pages' draws bind (`pageLayout`,
 * `freshDraws.ts`), group 1 the faces', group 2 its own (`layout`, `blendLayout`). A lamp group's
 * draws are the sun's, or, where the device clips by distances (`clipsLampGroups`), their clipped vertex
 * entries (`SHADOW_GROUP_LAMP_WGSL`), which spare the overdraw past the page the fragment discards.
 * Compiled off the frame by `prepare` and `prepareBlend`, or at their first use
 * (`preparedPipeline`).
 */
export function shadowGroupDraws(
  device: GPUDevice,
  module: GPUShaderModule,
  pageLayout: GPUBindGroupLayout,
  faceLayout: GPUBindGroupLayout,
) {
  const entries = BINDINGS.map((binding) => ({
    binding,
    visibility: GPUShaderStage.VERTEX | (binding === 4 ? GPUShaderStage.FRAGMENT : 0),
    buffer: { type: 'read-only-storage' as const },
  }));
  const layout = device.createBindGroupLayout({ entries }),
    blendLayout = transmittanceGroupLayout(device, entries);
  const pool = device.createPipelineLayout({ bindGroupLayouts: [pageLayout, faceLayout, layout] });
  const pipeline = (label: string, vertex: string, fragment: string) =>
    preparedPipeline(device, {
      label: `Trillion3D shadow moving group ${label} v1`,
      layout: pool,
      vertex: { module, entryPoint: vertex },
      fragment: { module, entryPoint: fragment, targets: [] },
      primitive: casterPrimitive(device, { topology: 'triangle-list', cullMode: 'none' }),
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: DEPTH_COMPARE,
      },
    });
  /** The draws of a group whose vertex entries are `shadow_<entry>_…vs`. */
  const kind = (entry: string) => ({
    opaque: pipeline(`${entry} opaque`, `shadow_${entry}_vs`, 'shadow_group_fs'),
    cutout: pipeline(`${entry} cutout`, `shadow_${entry}_cutout_vs`, 'shadow_group_cutout_fs'),
    blend: shadowTransmittanceDraws(device, module, [pageLayout, faceLayout], {
      vertex: `shadow_${entry}_blend_vs`,
      fragment: 'shadow_group_blend_fs',
      name: `shadow moving ${entry}`,
      own: blendLayout,
    }),
    made: undefined as { opaque: GPURenderPipeline; cutout: GPURenderPipeline } | undefined,
    blended: undefined as readonly [GPURenderPipeline, GPURenderPipeline] | undefined,
  });
  // A sun group's draws; a lamp group's own where the device clips each caster to its page.
  const sun = kind('group'),
    lamp = clipsLampGroups(device) ? kind('group_lamp') : sun,
    kinds = [...new Set([sun, lamp])];
  return {
    layout,
    blendLayout,
    prepare: () => Promise.all(kinds.flatMap((k) => [k.opaque.prepare(), k.cutout.prepare()])),
    prepareBlend: () => Promise.all(kinds.map((k) => k.blend.prepare())),
    /** The opaque and cutout draws of a sun's group, or a lamp's (`lamp`). */
    made: (lamps = false) => {
      const k = lamps ? lamp : sun;
      return (k.made ??= { opaque: k.opaque.get(), cutout: k.cutout.get() });
    },
    /** The transmittance layer's two draws of a sun's group or a lamp's, depth then colour. */
    blended: (lamps = false) => {
      const k = lamps ? lamp : sun;
      return (k.blended ??= k.blend.made().draws);
    },
  };
}
