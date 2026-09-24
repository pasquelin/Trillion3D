import { LIGHT_SETTINGS, SHADOW_SLICE_FLOATS } from '../../../../sdk-core/src/index.ts';
import type { WebgpuLightState } from '../../webgpu/pages/state/lights.ts';

/**
 * What an opaque pixel asks of virtual textures: ONE tile rank, placed in the frame's
 * feedback target that transparents complete, under the common `TILE_REQUEST_WGSL` rule
 * (phase, map chosen by position, fallback on the base). The pixel increments nothing: why,
 * and what that cost, is said in `../../webgpu/tile/reduce.ts`.
 *
 * The sun shadow thus asks for its tiles from the screen: the depth pass reads the cutout
 * at its shadow texel but cannot ask for anything (`../../webgpu/blend/earlyRejection.test.ts`).
 * To the six maps are therefore added, for a masked-material pixel, as many choices as
 * cascades: the triangle is projected into the cascade, the coordinate derivative per shadow
 * texel comes out — the affine `dpdx` of the shadow pass — and the requested rank is that of
 * this level — the isotropic one, as the shadow pass's cutout reads it (`maskAlpha`); the camera
 * cutout of a masked material shares the base map's pixels with its shading (`mapRequest`).
 * Cascades are the sun slice as lighting reads it
 * (`../../lighting/direct/shadowWgsl.ts`), copied into the pass uniform: binding the slice buffer would give
 * it one more lifetime on the bind group — rebuilt when a shadow is born or dies —
 * for five hundred bytes copied per frame. The host shader declares `uni.sun`, `uni.feedback`,
 * `PageInfo`, `vertUv`, `TILE_REQUEST_WGSL` and the class overrides — `HAS_UV`,
 * `HAS_MASK` and one per map (`materialClass.ts`) — before this block.
 */
const HEADER_WORDS = 24;
/** Words of the resolve uniform: the header, then the sun slice. */
export const SHADE_UNIFORM_WORDS = HEADER_WORDS + SHADOW_SLICE_FLOATS;
export const SHADE_UNIFORM_BYTES = SHADE_UNIFORM_WORDS * 4;

export const SHADE_REQUEST_WGSL = `const SUN_CASCADES:u32=${LIGHT_SETTINGS.sunCascades}u;
/** A class reading any map asks for its tiles: a normal map alone is still a texture to stream. */
override ANY_MAP:bool=HAS_MAP||HAS_ROUGH||HAS_METAL||HAS_NORMAL_MAP||HAS_AO||HAS_EMISSIVE;
/** Derivative of the shadow-texel coordinate of cascade c (xy, zw), or zero if the cascade
 *  does not draw this point. */
fn cascadeGradient(c:u32,w0:vec4f,w1:vec4f,w2:vec4f,dUds:vec2f,dUdt:vec2f,wp:vec4f)->vec4f{
 if(c>=min(SUN_CASCADES,u32(uni.sun.info.x))){return vec4f(0.0);}
 let entry=uni.sun.faces[c];
 if(entry.rect.w<0.5){return vec4f(0.0);}
 let m=entry.viewProjection;
 // Orthographic: w is one, the projected position is already normalised.
 let p=m*wp;
 if(abs(p.x)>1.0||abs(p.y)>1.0||p.z<0.0||p.z>1.0){return vec4f(0.0);}
 let side=0.5*max(uni.sun.info.z,1.0);
 let s0=(m*w0).xy*side;let s1=(m*w1).xy*side;let s2=(m*w2).xy*side;
 let dxb=s1.x-s0.x;let dyb=s1.y-s0.y;let dxc=s2.x-s0.x;let dyc=s2.y-s0.y;let det=dxb*dyc-dxc*dyb;
 if(det==0.0){return vec4f(0.0);}
 let inv=1.0/det;
 return vec4f(dUds*(dyc*inv)+dUdt*(-dyb*inv),dUds*(-dxc*inv)+dUdt*(dxb*inv));
}
/** Tile rank this pixel asks for, plus one, or zero. */
fn shadeRequest(page:PageInfo,h:ClusterHeader,pos:vec2f,uv:vec2f,ddx:vec2f,ddy:vec2f,w0:vec4f,w1:vec4f,w2:vec4f,i0:u32,i1:u32,i2:u32,wp:vec4f)->u32{
 if(!(HAS_UV&&ANY_MAP)||!feedbackPhase(pos,uni.feedback)){return 0u;}
 let p=requestPick(pos,MAP_CHOICES+SUN_CASCADES);
 if(p.sel>=MAP_CHOICES&&HAS_MASK){
  let uva=pageUv(page,h,i0);
  let g=cascadeGradient(p.sel-MAP_CHOICES,w0,w1,w2,pageUv(page,h,i1)-uva,pageUv(page,h,i2)-uva,wp);
  if(any(g!=vec4f(0.0))){return colorRequestIndex(page.mapIndex,uv,g.xy,g.zw,p.next,1u,false);}
 }
 return mapRequest(p,vec2u(page.mapIndex,page.emissiveIndex),vec4u(page.roughnessIndex,page.metalnessIndex,page.normalIndex,page.aoIndex),uv,ddx,ddy,HAS_MASK);
}`;

/**
 * Copy into the uniform the shadow slice of the first directional light that holds one,
 * as the slice buffer carries it; without it, a slice with no face.
 */
export function writeSunSlice(lights: WebgpuLightState, words: Float32Array) {
  const { store, shadows } = lights;
  const sun = words.subarray(HEADER_WORDS, HEADER_WORDS + SHADOW_SLICE_FLOATS);
  if (shadows)
    for (let slot = 0; slot < store.count; slot++) {
      const slice = store.sliceOf(slot);
      if (slice < 0 || store.light(store.ids[slot])?.kind !== 'directional') continue;
      const start = slice * SHADOW_SLICE_FLOATS;
      sun.set(shadows.sliceMirror.subarray(start, start + SHADOW_SLICE_FLOATS));
      return;
    }
  sun.fill(0);
}
