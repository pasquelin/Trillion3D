import { FLAG_HAS_MAP, FLAG_HAS_UV, FLAG_SAMPLED } from '../../visibility/types.ts';
import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import type { PageSurface } from '../../page/surface.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/**
 * THE TRANSMITTANCE LAYER of the shadow pool: one texel beside each depth texel, at the same place
 * in the pool, so the same pages and the same page table address it. RGB is the share of the light
 * the translucent casters let through, `Π(1 − coverage)`; A is the nearest of their depths. The
 * shading multiplies its opaque visibility by RGB where the receiver lies behind A
 * (`../../lighting/direct/shadowWgsl.ts`), tap by tap of the same PCF: a constant opacity gives a
 * constant shadow, with no pattern to average away.
 *
 * It is filled in the shadow depth pass itself, as its colour target: a blended caster's row
 * (`../../webgpu/row/blendCasters.ts`) is drawn a second time in each region, by a pipeline that
 * writes no depth and blends multiplicatively; an opaque caster leaves it untouched. The layer is
 * RGB so that a tinted transmission (#33) can colour it; blended casters write grey today.
 *
 * It exists from the first blended caster on: a scene that blends nothing pays neither its bytes
 * nor its draw, and its shading reads no texel of it (a one-texel stand-in is bound instead).
 */
export const SHADOW_TRANSMITTANCE_FORMAT: GPUTextureFormat = 'rgba16float';
/** Bytes of a layer of `poolSide` pages a side: four half floats per texel. */
export const shadowTransmittanceBytes = (poolSide: number) => (poolSide * SHADOW_PAGE) ** 2 * 8;
/** What a texel holds where no translucent caster is: all the light, behind the far plane. */
export const TRANSMITTANCE_CLEAR = { r: 1, g: 1, b: 1, a: 0 };
export const TRANSMITTANCE_CLEAR_WGSL = `vec4f(${Object.values(TRANSMITTANCE_CLEAR).join(',')})`;
/**
 * Two translucent casters on one texel: their transmittances multiply, the nearest depth stays —
 * reversed like the camera's, so the nearest is the greater.
 */
export const TRANSMITTANCE_BLEND: GPUBlendState = {
  color: { operation: 'add', srcFactor: 'zero', dstFactor: 'src' },
  alpha: { operation: 'max', srcFactor: 'one', dstFactor: 'one' },
};
/**
 * Scale of the depth a caster writes: a half float rounds to within `2^-11` of the value, so the
 * depth is lowered by that much first and never lands in front of its own surface — the pane
 * never shadows itself. A receiver closer behind it than that step takes no attenuation.
 */
export const TRANSMITTANCE_DEPTH_KEEP = 1 - 2 ** -11;

/**
 * True when a blended surface casts at all: drawn over what is behind it (normal blending), not
 * transmissive, and stopping some light. An additive surface adds light and stops none; a
 * transmissive one tints what crosses it — its coloured shadow is #33's, on this same layer. A
 * fully transparent one stops nothing: none of them takes a caster row.
 */
export const castsBlendShadow = (surface: PageSurface) =>
  surface.blending === 'normal' && !(surface.transmission > 0) && surface.opacity > 0;

/** Share of the light a blended surface stops, before its colour map's alpha: its opacity. */
export const blendCoverage = (surface: PageSurface) => Math.min(1, Math.max(0, surface.opacity));

/**
 * The texel a blended caster writes: `1 − coverage`, the coverage being its opacity times its
 * colour map's alpha, read like the cutout's (`maskAlpha`, `../../webgpu/tile/wgsl.ts`), and its
 * depth. Requires `PageInfo` and `maskAlpha`.
 */
export const BLEND_TRANSMITTANCE_WGSL = `fn blendTransmittance(page:PageInfo,uv:vec2f,ddx:vec2f,ddy:vec2f,depth:f32)->vec4f{
 var coverage=page.blendCoverage;
 if((page.flags&${FLAG_HAS_UV | FLAG_HAS_MAP}u)==${FLAG_HAS_UV | FLAG_HAS_MAP}u){coverage*=maskAlpha(page.mapIndex,uv,ddx,ddy,(page.flags&${FLAG_SAMPLED}u)!=0u);}
 return vec4f(vec3f(1.0-coverage),depth*${TRANSMITTANCE_DEPTH_KEEP});
}`;

/**
 * Creates the layer, `poolSide` pages a side, cleared to `TRANSMITTANCE_CLEAR` by `encoder`, and the
 * three pipelines the depth pass switches to while it is attached: the opaque casters' (depth as
 * before, no colour), the blended casters' (colour only) and the page clear (both).
 */
export function createShadowTransmittance(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUPipelineLayout,
  poolSide: number,
  encoder: GPUCommandEncoder,
) {
  const size = poolSide * SHADOW_PAGE;
  const texture = device.createTexture({
    label: 'Trillion3D shadow transmittance v1',
    size: [size, size, 1],
    format: SHADOW_TRANSMITTANCE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = texture.createView();
  encoder
    .beginRenderPass({
      label: 'Trillion3D shadow transmittance clear v1',
      colorAttachments: [
        { view, loadOp: 'clear', storeOp: 'store', clearValue: TRANSMITTANCE_CLEAR },
      ],
    })
    .end();
  const pipeline = (
    label: string,
    vertex: string,
    fragment: string,
    target: GPUColorTargetState,
    depthWriteEnabled: boolean,
    depthCompare: GPUCompareFunction,
  ) =>
    device.createRenderPipeline({
      label,
      layout,
      vertex: { module, entryPoint: vertex },
      fragment: { module, entryPoint: fragment, targets: [target] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled, depthCompare },
    });
  const format = SHADOW_TRANSMITTANCE_FORMAT;
  return {
    view,
    bytes: shadowTransmittanceBytes(poolSide),
    depth: pipeline(
      'Trillion3D shadow depth v1',
      'shadow_vs',
      'shadow_fs',
      { format, writeMask: 0 },
      true,
      DEPTH_COMPARE,
    ),
    blend: pipeline(
      'Trillion3D shadow transmittance v1',
      'shadow_blend_vs',
      'shadow_blend_fs',
      { format, blend: TRANSMITTANCE_BLEND },
      false,
      DEPTH_COMPARE,
    ),
    clear: pipeline(
      'Trillion3D shadow page clear v1',
      'shadow_clear_vs',
      'shadow_clear_fs',
      { format },
      true,
      'always',
    ),
    dispose() {
      texture.destroy();
    },
  };
}

export type ShadowTransmittance = ReturnType<typeof createShadowTransmittance>;
