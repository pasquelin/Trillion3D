import { SHADOW_RECORD_FLOATS } from '../../../../sdk-core/src/index.ts';
import {
  SHADOW_RECORD_FRAME,
  SHADOW_RECORD_INFO,
} from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import type { WebgpuLightState } from '../../webgpu/pages/state/lights.ts';
import { quartet } from './maps.ts';

/**
 * What an opaque pixel asks of virtual textures: ONE tile rank, placed in the frame's
 * feedback target that transparents complete, under the common `TILE_REQUEST_WGSL` rule
 * (phase, map chosen by position, fallback on the base). The pixel increments nothing: why,
 * and what that cost, is said in `../../webgpu/tile/reduce.ts`.
 *
 * The sun shadow asks for its tiles from the screen: the depth pass reads the cutout at its
 * shadow texel but cannot ask for anything (`../../webgpu/blend/earlyRejection.test.ts`). To the
 * six maps is therefore added, for a masked-material pixel, one choice: the sun's clipmap level
 * this pixel's own footprint reads — the finest a receiver beside the caster reads its shadow at.
 * The triangle is projected on the light plane in texels of that level, the coordinate
 * derivative per shadow texel comes out — the affine `dpdx` of the shadow pass — and the
 * requested rank is that one. A coarser level reads a coarser mip, which a finer tile serves.
 * The sun is its record's frame and header, copied into the pass uniform with the camera's
 * pixel scale: binding the record buffer would give it one more lifetime on the bind group. The
 * host shader declares `uni.sun`, `uni.pixelScale`, `uni.feedback`, `PageInfo`, `vertUv`,
 * `wrapOf`, `TILE_REQUEST_WGSL` and the class overrides — `HAS_UV`, `HAS_MASK` and one per map
 * (`materialClass.ts`) — before this block.
 */
const HEADER_WORDS = 24;
/** Floats of the sun the uniform carries: the three frame rows, then the header. */
const SUN_WORDS = 16;
/** Words of the resolve uniform: the header, then the sun. */
export const SHADE_UNIFORM_WORDS = HEADER_WORDS + SUN_WORDS;
export const SHADE_UNIFORM_BYTES = SHADE_UNIFORM_WORDS * 4;
/** The sun as the resolve reads it: its record's frame rows and header. */
export const SHADE_SUN_WGSL = 'struct ShadeSun{frame:array<vec4f,3>,info:vec4f,}';

export const SHADE_REQUEST_WGSL = `
/** A class reading any map asks for its tiles: a normal map alone is still a texture to stream. */
override ANY_MAP:bool=HAS_MAP||HAS_ROUGH||HAS_METAL||HAS_NORMAL_MAP||HAS_AO||HAS_EMISSIVE;
/** Derivative of the shadow-texel coordinate of the sun level this pixel reads (xy, zw), or
 *  zero without a sun. */
fn sunLevelGradient(w0:vec4f,w1:vec4f,w2:vec4f,dUds:vec2f,dUdt:vec2f,wp:vec4f)->vec4f{
 let levels=i32(uni.sun.info.x);
 if(levels==0){return vec4f(0.0);}
 let finest=i32(uni.sun.info.y);
 let depth=abs((uni.viewProj*wp).w);
 let level=max(i32(floor(log2(max(uni.pixelScale*depth,1e-30)))),finest);
 if(level>=finest+levels){return vec4f(0.0);}
 let texel=exp2(f32(level));
 let right=uni.sun.frame[0].xyz;let up=uni.sun.frame[1].xyz;
 let s0=vec2f(dot(w0.xyz,right),-dot(w0.xyz,up))/texel;
 let s1=vec2f(dot(w1.xyz,right),-dot(w1.xyz,up))/texel;
 let s2=vec2f(dot(w2.xyz,right),-dot(w2.xyz,up))/texel;
 let dxb=s1.x-s0.x;let dyb=s1.y-s0.y;let dxc=s2.x-s0.x;let dyc=s2.y-s0.y;let det=dxb*dyc-dxc*dyb;
 if(det==0.0){return vec4f(0.0);}
 let inv=1.0/det;
 return vec4f(dUds*(dyc*inv)+dUdt*(-dyb*inv),dUds*(-dxc*inv)+dUdt*(dxb*inv));
}
/** Tile rank this pixel asks for, plus one, or zero. */
fn shadeRequest(page:PageInfo,h:ClusterHeader,pos:vec2f,uv:vec2f,ddx:vec2f,ddy:vec2f,w0:vec4f,w1:vec4f,w2:vec4f,i0:u32,i1:u32,i2:u32,wp:vec4f)->u32{
 if(!(HAS_UV&&ANY_MAP)||!feedbackPhase(pos,uni.feedback)){return 0u;}
 let p=requestPick(pos,MAP_CHOICES+1u);
 if(p.sel>=MAP_CHOICES&&HAS_MASK){
  let uva=pageUv(page,h,i0);
  let g=sunLevelGradient(w0,w1,w2,pageUv(page,h,i1)-uva,pageUv(page,h,i2)-uva,wp);
  if(any(g!=vec4f(0.0))){return colorRequestIndex(page.mapIndex,uv,${quartet('base')},g.xy,g.zw,p.next);}
 }
 return mapRequest(p.sel,vec2u(page.mapIndex,page.emissiveIndex),vec4u(page.roughnessIndex,page.metalnessIndex,page.normalIndex,page.aoIndex),uv,page.wrapModes,ddx,ddy,p.next);
}`;

/**
 * Copies into the uniform the frame rows and header of the first directional light that holds
 * a shadow record, as the record buffer carries them; without one, a header of zeros.
 */
export function writeSunSlice(lights: WebgpuLightState, words: Float32Array) {
  const { store, shadows } = lights;
  const sun = words.subarray(HEADER_WORDS, HEADER_WORDS + SUN_WORDS);
  if (shadows)
    for (let slot = 0; slot < store.count; slot++) {
      const slice = store.sliceOf(slot);
      if (slice < 0 || store.light(store.ids[slot])?.kind !== 'directional') continue;
      const start = slice * SHADOW_RECORD_FLOATS;
      sun.set(
        shadows.records.subarray(start + SHADOW_RECORD_FRAME, start + SHADOW_RECORD_FRAME + 12),
      );
      sun.set(
        shadows.records.subarray(start + SHADOW_RECORD_INFO, start + SHADOW_RECORD_INFO + 4),
        12,
      );
      return;
    }
  sun.fill(0);
}
