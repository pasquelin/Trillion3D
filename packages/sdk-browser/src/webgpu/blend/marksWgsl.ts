import { SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { DIRECT_LIGHT_WGSL } from '../../lighting/direct/lightWgsl.ts';
import { TILE_SLICE_WGSL } from '../../lighting/direct/lightingWgsl.ts';
import { LAMP_SOFT_DISK_WGSL } from '../../lighting/direct/lampSoftWgsl.ts';
import { SHADOW_READ_AT_WGSL } from '../../lighting/direct/shadowFactorWgsl.ts';
import { shadowRequestWgsl } from '../../lighting/direct/shadowRequestWgsl.ts';
import {
  PCF_TAPS_WGSL,
  SHADOW_DATA_WGSL,
  shadowPageReadWgsl,
} from '../../lighting/direct/shadowWgsl.ts';
import { FLAG_DIAGNOSTIC_VIEW, FLAG_LIT, FLAG_UNLIT_VIEW } from '../../visibility/buffer.ts';
import { FLAG_SAMPLED } from '../../visibility/types.ts';
import { BLEND_BINDINGS } from '../core/bindLayout.ts';
import { SHADOW_DEMAND_LIGHT_WGSL } from '../shadow/demandWgsl.ts';
import {
  COLOR_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  maskAlphaWgsl,
  tileDeclarations,
} from '../tile/wgsl.ts';
import { FACING_SHIFT } from './facing.ts';
import { BLEND_SHADOW_FOOTPRINT_WGSL, BLEND_SURFACE_NORMAL_WGSL } from './shaderSurface.ts';
import { BLEND_VERTEX_WGSL } from './vertexWgsl.ts';

/** The marks' own group, after the blend pass's material and reflection groups, and its request
 *  buffer and opaque depth. */
export const BLEND_MARKS_GROUP = 2;
export const BLEND_MARKS_BINDINGS = { requests: 8, depth: 9 };

/**
 * THE SHADOW PAGES A TRANSPARENT SURFACE READS, MARKED BEFORE THEY ARE MAPPED (#1411). Unreal's
 * virtual shadow maps mark the pages every receiver samples, translucent ones included, on a
 * cheap path that reads only the receiver's depth and opacity; here the blend runs are drawn once
 * more, before the allocation, by a fragment stage that writes neither colour nor depth: each
 * fragment the blend pass lights marks, through the demand's own `demandSlice` and `demandLight`
 * (`SHADOW_DEMAND_LIGHT_WGSL`), the pages its read takes at its point, normal and footprint.
 *
 * The module is the blend's vertex stage (`BLEND_VERTEX_WGSL`, the same fragments) and what the
 * demand reads, nothing else: no lighting, and of the material one read, the base colour's alpha
 * (`maskAlpha`) the opacity test discards on. Its normal is the one before the normal map
 * (`blendGeometricNormal`): a map is never fetched. The request is bound in the marks' own group,
 * where the blend pass's reads ask nothing and keep their early depth reject.
 */
export function blendShadowMarksWgsl(pages = SUN_WINDOW) {
  const request = { binding: BLEND_MARKS_BINDINGS.requests, group: BLEND_MARKS_GROUP };
  return `${BLEND_VERTEX_WGSL}
${tileDeclarations(BLEND_BINDINGS.color, 'color')}
@group(0) @binding(${BLEND_BINDINGS.sampler}) var mapsSampler:sampler;
@group(0) @binding(${BLEND_BINDINGS.directLights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${BLEND_BINDINGS.tileLights}) var<storage,read> tileLights:array<u32>;
${SHADOW_DATA_WGSL}
@group(0) @binding(${BLEND_BINDINGS.shadowData}) var<storage,read> shadows:ShadowData;
${shadowRequestWgsl(request, pages)}
@group(${BLEND_MARKS_GROUP}) @binding(${BLEND_MARKS_BINDINGS.depth}) var markDepth:texture_depth_2d;
${TILE_POOL_WGSL}
${COLOR_SAMPLE_WGSL}
${maskAlphaWgsl(false)}
${DIRECT_LIGHT_WGSL}
${TILE_SLICE_WGSL}
${shadowPageReadWgsl(pages)}
${SHADOW_READ_AT_WGSL}
${PCF_TAPS_WGSL}
${LAMP_SOFT_DISK_WGSL}
${SHADOW_DEMAND_LIGHT_WGSL}
${BLEND_SURFACE_NORMAL_WGSL}
${BLEND_SHADOW_FOOTPRINT_WGSL}
/** Marks the pages a lit transparent point's lights read (\`declaredLighting\`): those of the cell
 *  its own depth \`z\` falls in, or every declared light past the grid, each at the point, normal
 *  and footprint its read takes. A cell that lists no shadowed light marks nothing. */
fn markBlendShadows(pixel:vec2f,z:f32,P:vec3f,N:vec3f,thin:bool,footprint:f32){
 let cell=gridCell(pixel,z,vec2u(uni.lightTiles));
 var slice=vec2u(TILE_NO_SLICE,directLights.count);
 if(cell!=TILE_NO_SLICE){
  if((tileLights[cell]&TILE_SHADOWED)==0u){return;}
  slice=cellSlice(cell);
 }
 demandSlice(slice,P,P,N,thin,footprint);
}
/** A blend fragment the pass lights marks its pages: past the material's rejects (\`blendSurface\`:
 *  the dash, the opacity test, the side), lit, outside the debug views, and in front of the opaque
 *  — the pass's depth test, made here before any write, as a stage that writes memory may run its
 *  depth test late. The derivatives come first, in uniform control flow; the opacity read takes
 *  explicit levels (\`textureSampleLevel\`), valid past any branch. A thin surface whose factor a
 *  map scales marks its pages on both sides: the map, which may zero it, is not fetched. */
@fragment fn markShadows(in:VSOut,@builtin(front_facing) front:bool){
 let gradX=dpdx(in.uv);let gradY=dpdy(in.uv);
 let N=blendGeometricNormal(in,front,dpdx(in.view),dpdy(in.view));
 let flags=in.ids.y;
 if(!lineDash(in.uv.x,in.alphaAo.zw)){discard;}
 let alpha=maskAlpha(in.ids.x,in.uv,gradX,gradY,(flags&${FLAG_SAMPLED}u)!=0u)*in.color.w;
 if(alpha<in.alphaAo.x||facingDiscarded(in.water>>${FACING_SHIFT}u,front)){discard;}
 if((flags&${FLAG_LIT}u)==0u||(flags&${FLAG_UNLIT_VIEW | FLAG_DIAGNOSTIC_VIEW}u)!=0u){return;}
 if(in.position.z<=textureLoad(markDepth,vec2i(in.position.xy),0)){return;}
 let thin=any(vec3f(in.normal.w,in.tangent.w,in.bitangent.w)>vec3f(0.0));
 let footprint=blendShadowFootprint(in.view);
 markBlendShadows(in.position.xy,in.position.z,in.view,N,thin,footprint);
 if(thin&&in.emissive.w!=0.0){markBlendShadows(in.position.xy,in.position.z,in.view,N,false,footprint);}
}`;
}
