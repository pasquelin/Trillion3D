import { FLAG_HAS_MAP, FLAG_HAS_UV, FLAG_SAMPLED } from '../../visibility/types.ts';
import { DEPTH_CLEAR, DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import type { PageSurface } from '../../page/surface.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/**
 * THE TRANSMITTANCE LAYER of the shadow pool: what the translucent casters let through, at half
 * the pool's resolution — one texel for each 2 × 2 depth texels, at the same place, so the same
 * pages and the same page table address it (texel / 2). Two textures:
 * - the transmittance, `rgba8unorm`: RGB is `Π(1 − coverage)`, grey today, laid out for a tinted
 *   transmission (#33) to colour it;
 * - the nearest translucent depth, `depth32float`, like the pool's.
 *
 * The shading multiplies each PCF comparison by the transmittance, filtered at the same tap,
 * where the receiver lies behind the translucent depth (`../../lighting/direct/shadowWgsl.ts`):
 * a constant opacity gives a constant shadow, with no pattern to average away.
 *
 * It is filled by a pass of its own after the pool's (`../../webgpu/pages/render/
 * encodeShadowPass.ts`): each drawn page is cleared, then the blended casters' rows
 * (`../../webgpu/row/blendCasters.ts`) are drawn twice from the same list and the same entry —
 * once depth only, depth-tested, for the nearest depth; once colour only, blended
 * multiplicatively, without depth. Both discard what the opaque depth of the pool hides.
 *
 * It exists from the first blended caster on: a scene that blends nothing pays neither its bytes
 * nor its pass, and its shading reads no texel of it (one-texel stand-ins are bound instead).
 */
/** Label of the layer's pass: timed with the Shadows stage. */
export const SHADOW_TRANSMITTANCE_PASS = 'Trillion3D shadow transmittance pass v1';
export const SHADOW_TRANSMITTANCE_FORMAT: GPUTextureFormat = 'rgba8unorm';
export const SHADOW_TRANSLUCENT_DEPTH_FORMAT: GPUTextureFormat = 'depth32float';
/** Bytes of a layer of `poolSide` pages a side: a quarter of the pool's texels, 4 bytes of
 *  transmittance and 4 of depth each. */
export const shadowTransmittanceBytes = (poolSide: number) =>
  ((poolSide * SHADOW_PAGE) / 2) ** 2 * 8;
/** What a texel holds where no translucent caster is: all the light. Its depth is `DEPTH_CLEAR`. */
export const TRANSMITTANCE_CLEAR = { r: 1, g: 1, b: 1, a: 1 };
export const TRANSMITTANCE_CLEAR_WGSL = `vec4f(${Object.values(TRANSMITTANCE_CLEAR).join(',')})`;
/** Two translucent casters on one texel: their transmittances multiply. */
const MULTIPLY: GPUBlendComponent = { operation: 'add', srcFactor: 'zero', dstFactor: 'src' };
export const TRANSMITTANCE_BLEND: GPUBlendState = { color: MULTIPLY, alpha: MULTIPLY };

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
 * colour map's alpha, read like the cutout's (`maskAlpha`, `../../webgpu/tile/wgsl.ts`).
 * Requires `PageInfo` and `maskAlpha`.
 */
export const BLEND_TRANSMITTANCE_WGSL = `fn blendTransmittance(page:PageInfo,uv:vec2f,ddx:vec2f,ddy:vec2f)->vec4f{
 var coverage=page.blendCoverage;
 if((page.flags&${FLAG_HAS_UV | FLAG_HAS_MAP}u)==${FLAG_HAS_UV | FLAG_HAS_MAP}u){coverage*=maskAlpha(page.mapIndex,uv,ddx,ddy,(page.flags&${FLAG_SAMPLED}u)!=0u);}
 return vec4f(1.0-coverage);
}`;

/**
 * The layer's read, bound at \`binding\` and the number after it: \`shadowThrough\`, which the PCF
 * of \`../../lighting/direct/shadowWgsl.ts\` calls at each tap. Requires \`SHADOW_PAGE\` there.
 */
export const shadowThroughWgsl = (
  binding: number,
) => `@group(0) @binding(${binding}) var shadowTransmittance:texture_2d<f32>;
@group(0) @binding(${binding + 1}) var shadowTranslucentDepth:texture_depth_2d;
/**
 * Light the translucent casters let through at atlas texel \`a\`, to a receiver at \`reference\`:
 * the layer's four texels around \`a / 2\` — kept within \`a\`'s page —, each its transmittance
 * where the receiver's reference lies behind its translucent depth and 1 elsewhere, filtered
 * bilinearly. Where the receiver is in front of all four, no transmittance is read.
 */
fn shadowThrough(a:vec2f,reference:f32)->f32{
 let o=floor(a/SHADOW_PAGE)*(0.5*SHADOW_PAGE);
 let h=clamp(0.5*a,o+0.5,o+(0.5*SHADOW_PAGE-0.5))-0.5;
 let i=vec2i(floor(h));let f=h-floor(h);
 let x=vec2i(1,0);let y=vec2i(0,1);
 let d=vec4f(textureLoad(shadowTranslucentDepth,i,0),textureLoad(shadowTranslucentDepth,i+x,0),textureLoad(shadowTranslucentDepth,i+y,0),textureLoad(shadowTranslucentDepth,i+x+y,0));
 let behind=vec4f(reference)<d;
 if(!any(behind)){return 1.0;}
 let t=vec4f(textureLoad(shadowTransmittance,i,0).r,textureLoad(shadowTransmittance,i+x,0).r,textureLoad(shadowTransmittance,i+y,0).r,textureLoad(shadowTransmittance,i+x+y,0).r);
 let s=select(vec4f(1.0),t,behind);
 return mix(mix(s.x,s.y,f.x),mix(s.z,s.w,f.x),f.y);
}`;

/**
 * Creates the layer for a pool of `poolSide` pages a side whose depth is `poolView`, both
 * textures cleared by `encoder`, and the three pipelines of its pass: the page clear, the
 * depth-only draw and the colour-only draw. `layouts` are the shadow depth pass's groups 0 and 1;
 * group 2 is the pool's depth, which the blended fragments test against.
 */
export function createShadowTransmittance(
  device: GPUDevice,
  module: GPUShaderModule,
  layouts: GPUBindGroupLayout[],
  poolView: GPUTextureView,
  poolSide: number,
  encoder: GPUCommandEncoder,
) {
  const size = (poolSide * SHADOW_PAGE) / 2;
  const texture = (label: string, format: GPUTextureFormat) =>
    device.createTexture({
      label,
      size: [size, size, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  const colour = texture('Trillion3D shadow transmittance v1', SHADOW_TRANSMITTANCE_FORMAT);
  const nearest = texture(
    'Trillion3D shadow translucent depth v1',
    SHADOW_TRANSLUCENT_DEPTH_FORMAT,
  );
  const view = colour.createView(),
    depthView = nearest.createView();
  encoder
    .beginRenderPass({
      label: 'Trillion3D shadow transmittance clear v1',
      colorAttachments: [
        { view, loadOp: 'clear', storeOp: 'store', clearValue: TRANSMITTANCE_CLEAR },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        depthClearValue: DEPTH_CLEAR,
      },
    })
    .end();
  const opaqueLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [...layouts, opaqueLayout] });
  const pipeline = (
    label: string,
    [vertex, fragment]: [string, string],
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
      depthStencil: { format: SHADOW_TRANSLUCENT_DEPTH_FORMAT, depthWriteEnabled, depthCompare },
    });
  const format = SHADOW_TRANSMITTANCE_FORMAT,
    blended: [string, string] = ['shadow_blend_vs', 'shadow_blend_fs'];
  return {
    view,
    depthView,
    bytes: shadowTransmittanceBytes(poolSide),
    /** The pool's depth, read by the blended fragments. */
    opaqueGroup: device.createBindGroup({
      layout: opaqueLayout,
      entries: [{ binding: 0, resource: poolView }],
    }),
    clear: pipeline(
      'Trillion3D shadow transmittance page clear v1',
      ['shadow_clear_vs', 'shadow_clear_fs'],
      { format },
      true,
      'always',
    ),
    depth: pipeline(
      'Trillion3D shadow translucent depth v1',
      blended,
      { format, writeMask: 0 },
      true,
      DEPTH_COMPARE,
    ),
    blend: pipeline(
      'Trillion3D shadow transmittance v1',
      blended,
      { format, blend: TRANSMITTANCE_BLEND },
      false,
      'always',
    ),
    dispose() {
      colour.destroy();
      nearest.destroy();
    },
  };
}

export type ShadowTransmittance = ReturnType<typeof createShadowTransmittance>;
