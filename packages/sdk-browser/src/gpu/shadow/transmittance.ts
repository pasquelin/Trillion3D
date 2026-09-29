import { FLAG_HAS_MAP, FLAG_HAS_UV, FLAG_SAMPLED } from '../../visibility/types.ts';
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts';
import type { PageSurface } from '../../page/surface.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { arrayView, layerPasses, layerViews } from './layers.ts';
import type { ShadowTransmittanceDraws } from './transmittanceDraws.ts';

/**
 * THE TRANSMITTANCE LAYER of the shadow pool: what the translucent casters let through, at half
 * the pool's resolution — one texel for each 2 × 2 depth texels, at the same place, so the same
 * pages and the same page table address it (texel / 2). Two textures:
 * - the transmittance, `rgba8unorm`: RGB is `Π(1 − coverage)`, grey today, laid out for a tinted
 *   transmission (#33) to colour it;
 * - the nearest translucent depth, `depth32float`, like the pool's.
 *
 * The shading multiplies the PCF's result by the transmittance, filtered once at the footprint's
 * centre, where the receiver lies behind the translucent depth (`../../lighting/direct/shadowWgsl.ts`):
 * a constant opacity gives a constant shadow, with no pattern to average away.
 *
 * It is filled by a pass of its own after the pool's (`../../webgpu/pages/render/
 * encodeShadowPass.ts`): each drawn page is cleared, then the blended casters' rows
 * (`../../webgpu/row/blendCasters.ts`) are drawn twice from the same list and the same entry —
 * once depth only, depth-tested, for the nearest depth; once colour only, blended
 * multiplicatively, without depth. Both discard what the opaque depth of the pool hides.
 *
 * It is made with the pool for a scene whose blended surfaces cast, else once a blended caster
 * first draws, and read from the first blended caster on: a scene that blends nothing pays neither
 * its bytes nor its pass, and its shading reads no texel of it (one-texel stand-ins are bound
 * instead).
 */
/** Label of the layer's pass: timed with the Shadows stage. */
export const SHADOW_TRANSMITTANCE_PASS = 'Trillion3D shadow transmittance pass v1';
/** Label of the pass that clears the layer: shadow work, timed with the Shadows stage too. */
export const SHADOW_TRANSMITTANCE_CLEAR_PASS = 'Trillion3D shadow transmittance clear v1';
export const SHADOW_TRANSMITTANCE_FORMAT: GPUTextureFormat = 'rgba8unorm';
export const SHADOW_TRANSLUCENT_DEPTH_FORMAT: GPUTextureFormat = 'depth32float';
/** Bytes for a pool of `layers` of `poolSide` pages a side: a quarter of the pool's texels, 4
 *  bytes of transmittance and 4 of depth each. */
export const shadowTransmittanceBytes = (poolSide: number, layers = 1) =>
  ((poolSide * SHADOW_PAGE) / 2) ** 2 * 8 * layers;
/** What a texel holds where no translucent caster is: all the light. Its depth is `DEPTH_CLEAR`. */
export const TRANSMITTANCE_CLEAR = { r: 1, g: 1, b: 1, a: 1 };
export const TRANSMITTANCE_CLEAR_WGSL = `vec4f(${Object.values(TRANSMITTANCE_CLEAR).join(',')})`;
/** Two translucent casters on one texel: their transmittances multiply. */
const MULTIPLY: GPUBlendComponent = { operation: 'add', srcFactor: 'zero', dstFactor: 'src' };
export const TRANSMITTANCE_BLEND: GPUBlendState = { color: MULTIPLY, alpha: MULTIPLY };

/**
 * True when a blended surface casts at all: asked to (`transparentShadow`; unasked, see-through
 * casts nothing, as the reference solution leaves translucent materials), drawn over what is behind
 * it (normal blending), not transmissive, and stopping some light. Additive stops none; transmissive
 * tints what crosses it (#33, on this same layer); fully transparent stops nothing: no caster row.
 */
export const castsBlendShadow = (s: PageSurface) =>
  s.transparentShadow && s.blending === 'normal' && !(s.transmission > 0) && s.opacity > 0;

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
 * The layer's read, bound at \`binding\` and the number after it: \`shadowThroughLit\`, which the PCF
 * of \`../../lighting/direct/shadowWgsl.ts\` calls once per pixel. Requires \`SHADOW_PAGE\` there.
 */
export const shadowThroughWgsl = (
  binding: number,
) => `@group(0) @binding(${binding}) var shadowTransmittance:texture_2d_array<f32>;
@group(0) @binding(${binding + 1}) var shadowTranslucentDepth:texture_depth_2d_array;
/**
 * Light the translucent casters let through at texel \`local\` of the page whose first texel is
 * \`page\` in the pool, to a receiver at \`reference\`: the layer's four texels around
 * \`local / 2\` — kept within the page —, each its transmittance where the receiver's reference
 * lies behind its translucent depth and 1 elsewhere, filtered bilinearly. Integer page origin plus
 * page-local texels: the page's content alone decides, wherever the pool puts it (#831). Where
 * the receiver is in front of all four, no transmittance is read.
 */
fn shadowThrough(page:vec3f,local:vec2f,reference:f32)->f32{
 let h=clamp(0.5*local,vec2f(0.5),vec2f(0.5*SHADOW_PAGE-0.5))-0.5;
 let i=vec2i(page.xy)/2+vec2i(floor(h));let f=h-floor(h);let l=i32(page.z);
 let x=vec2i(1,0);let y=vec2i(0,1);
 let d=vec4f(textureLoad(shadowTranslucentDepth,i,l,0),textureLoad(shadowTranslucentDepth,i+x,l,0),textureLoad(shadowTranslucentDepth,i+y,l,0),textureLoad(shadowTranslucentDepth,i+x+y,l,0));
 let behind=vec4f(reference)<d;
 if(!any(behind)){return 1.0;}
 let t=vec4f(textureLoad(shadowTransmittance,i,l,0).r,textureLoad(shadowTransmittance,i+x,l,0).r,textureLoad(shadowTransmittance,i+y,l,0).r,textureLoad(shadowTransmittance,i+x+y,l,0).r);
 let s=select(vec4f(1.0),t,behind);
 return mix(mix(s.x,s.y,f.x),mix(s.z,s.w,f.x),f.y);
}
/** The PCF's \`lit\` at map texel \`t\` of the page whose first map texel is \`first\`, placed by
 *  \`offset\` (\`shadowOffset\`), times the layer there, read once per footprint (its taps lie within
 *  a texel of \`t\`); \`lit\` itself, no texel read, with no layer (a one-texel stand-in) or no light. */
fn shadowThroughLit(offset:vec3f,first:vec2f,t:vec2f,reference:f32,lit:f32)->f32{
 if(lit==0.0||textureDimensions(shadowTransmittance).x==1u){return lit;}
 return lit*shadowThrough(offset+vec3f(first,0.0),t-first,reference);
}`;

/**
 * Creates the layer for a pool of `poolSide` pages a side whose depth is `poolLayers`, drawn by
 * `made` (`shadowTransmittanceDraws`): made apart from any frame, so the device's answer to its
 * bytes can be awaited (`../../webgpu/shadow/transmittanceGrant.ts`); `clear` readies both
 * textures once, by the frame that first draws into them. Its pages are cleared by the page quads
 * (`pageQuads.ts`).
 */
export function createShadowTransmittance(
  device: GPUDevice,
  { opaqueLayout, draws }: ShadowTransmittanceDraws,
  poolLayers: GPUTextureView[],
  poolSide: number,
) {
  const size = (poolSide * SHADOW_PAGE) / 2;
  const texture = (label: string, format: GPUTextureFormat) =>
    device.createTexture({
      label,
      size: [size, size, poolLayers.length],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  const colour = texture('Trillion3D shadow transmittance v1', SHADOW_TRANSMITTANCE_FORMAT),
    nearest = texture('Trillion3D shadow translucent depth v1', SHADOW_TRANSLUCENT_DEPTH_FORMAT);
  const targets = layerViews(colour),
    depthTargets = layerViews(nearest);
  return {
    view: arrayView(colour),
    depthView: arrayView(nearest),
    /** Each layer's two views, drawn into by its pages. */
    passes: layerPasses(SHADOW_TRANSMITTANCE_PASS, depthTargets, targets),
    bytes: shadowTransmittanceBytes(poolSide, poolLayers.length),
    /** Each layer of the pool's depth, read by the blended fragments. */
    opaqueGroups: poolLayers.map((resource) =>
      device.createBindGroup({ layout: opaqueLayout, entries: [{ binding: 0, resource }] }),
    ),
    /** The depth-only draw, then the colour-only draw, of each region's list. */
    draws,
    /** Both textures cleared by `encoder`: all the light, and far. */
    clear(encoder: GPUCommandEncoder) {
      for (const [layer, view] of targets.entries())
        encoder
          .beginRenderPass({
            label: SHADOW_TRANSMITTANCE_CLEAR_PASS,
            colorAttachments: [
              { view, loadOp: 'clear', storeOp: 'store', clearValue: TRANSMITTANCE_CLEAR },
            ],
            depthStencilAttachment: {
              view: depthTargets[layer],
              depthLoadOp: 'clear',
              depthStoreOp: 'store',
              depthClearValue: DEPTH_CLEAR,
            },
          })
          .end();
    },
    destroy() {
      colour.destroy();
      nearest.destroy();
    },
  };
}

export type ShadowTransmittance = ReturnType<typeof createShadowTransmittance>;
