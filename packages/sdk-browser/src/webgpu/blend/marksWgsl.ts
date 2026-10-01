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
import { VIEW_WGSL, WORLD_AT_WGSL } from '../../lighting/deferred/shaders.ts';
import { WATER_SHADOW_READ_WGSL } from '../water/shadowReadWgsl.ts';

/** The marks' own group, after the blend pass's material and reflection groups, and its request
 *  buffer, opaque depth and the deferred view the water composite rebuilds its points through. */
export const BLEND_MARKS_GROUP = 2;
export const BLEND_MARKS_BINDINGS = { requests: 8, depth: 9, view: 10 };

/**
 * THE SHADOW PAGES A TRANSPARENT SURFACE READS, MARKED BEFORE THEY ARE MAPPED (#1411). the reference engine's
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
 *
 * The water surfaces mark through the same module (#1412), by `markWaterShadows`: the composite
 * lights the nearest of them per pixel, at the point and footprint it rebuilds from the depth
 * through the deferred view, its normal turned to the eye (`WATER_SHADOW_READ_WGSL`); the marks
 * take those, at each water fragment in front of the opaque: the nearest among them, and any
 * water behind it, whose few pages the composite does not read.
 */
export function blendShadowMarksWgsl(pages = SUN_WINDOW) {
  return `${BLEND_VERTEX_WGSL}
${tileDeclarations(BLEND_BINDINGS.color, 'color')}
@group(0) @binding(${BLEND_BINDINGS.sampler}) var mapsSampler:sampler;
@group(0) @binding(${BLEND_BINDINGS.directLights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${BLEND_BINDINGS.tileLights}) var<storage,read> tileLights:array<u32>;
${SHADOW_DATA_WGSL}
@group(0) @binding(${BLEND_BINDINGS.shadowData}) var<storage,read> shadows:ShadowData;
${shadowRequestWgsl(BLEND_MARKS_BINDINGS.requests, pages, BLEND_MARKS_GROUP)}
@group(${BLEND_MARKS_GROUP}) @binding(${BLEND_MARKS_BINDINGS.depth}) var markDepth:texture_depth_2d;
${VIEW_WGSL}
@group(${BLEND_MARKS_GROUP}) @binding(${BLEND_MARKS_BINDINGS.view}) var<uniform> view:View;
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
${WORLD_AT_WGSL}
${WATER_SHADOW_READ_WGSL}
/** Marks the pages a lit transparent point's lights read (\`declaredLighting\`): those of the cell
 *  its own depth \`z\` falls in, or every declared light past the grid, each at the point, normal
 *  and footprint its read takes, and, \`bothSides\`, at its normal unturned too. A cell that lists
 *  no shadowed light marks nothing. */
fn markBlendShadows(pixel:vec2f,z:f32,P:vec3f,N:vec3f,thin:bool,bothSides:bool,footprint:f32){
 let cell=gridCell(pixel,z,vec2u(uni.lightTiles));
 var slice=vec2u(TILE_NO_SLICE,directLights.count);
 if(cell!=TILE_NO_SLICE){
  if((tileLights[cell]&TILE_SHADOWED)==0u){return;}
  slice=cellSlice(cell);
 }
 demandSlice(slice,P,P,N,thin,footprint);
 if(bothSides){demandSlice(slice,P,P,N,false,footprint);}
}
/** Marks the pages the water composite reads at a water pixel of depth \`z\` (\`waterColor\`): its
 *  point and footprint rebuilt through the deferred view, normal \`N\` turned to the eye, never thin. */
fn markWaterAt(pixel:vec2f,z:f32,N:vec3f){
 let P=worldAt(pixel,z);
 markBlendShadows(pixel,z,P,waterFacing(N,waterViewDirection(P)),false,false,waterShadowFootprint(pixel,z,P));
}
/** Whether a fragment of the runs is one its pass keeps: in front of the opaque — the pass's depth
 *  test, made here before any write, as a stage that writes memory may run its depth test late —
 *  and past the material's rejects (\`blendSurface\`: the dash, the side, the opacity test), the
 *  cheap tests before the one fetch. The opacity read takes explicit levels (\`textureSampleLevel\`),
 *  valid past any branch, on derivatives \`gradX\`, \`gradY\` taken in uniform control flow. */
fn marksKept(in:VSOut,front:bool,gradX:vec2f,gradY:vec2f)->bool{
 if(in.position.z<=textureLoad(markDepth,vec2i(in.position.xy),0)){return false;}
 if(!lineDash(in.uv.x,in.alphaAo.zw)||facingDiscarded(in.water>>${FACING_SHIFT}u,front)){return false;}
 return maskAlpha(in.ids.x,in.uv,gradX,gradY,(in.ids.y&${FLAG_SAMPLED}u)!=0u)*in.color.w>=in.alphaAo.x;
}
/** A blend fragment the pass lights marks its pages: lit, outside the debug views, kept
 *  (\`marksKept\`). The derivatives come first, in uniform control flow, the normal past the
 *  rejects. A thin surface whose factor a map scales marks its pages on both sides: the map, which
 *  may zero it, is not fetched. */
@fragment fn markShadows(in:VSOut,@builtin(front_facing) front:bool){
 let gradX=dpdx(in.uv);let gradY=dpdy(in.uv);let viewX=dpdx(in.view);let viewY=dpdy(in.view);
 let flags=in.ids.y;
 if((flags&${FLAG_LIT}u)==0u||(flags&${FLAG_UNLIT_VIEW | FLAG_DIAGNOSTIC_VIEW}u)!=0u){return;}
 if(!marksKept(in,front,gradX,gradY)){return;}
 let N=blendGeometricNormal(in,front,viewX,viewY);
 let thin=any(vec3f(in.normal.w,in.tangent.w,in.bitangent.w)>vec3f(0.0));
 markBlendShadows(in.position.xy,in.position.z,in.view,N,thin,thin&&in.emissive.w!=0.0,blendShadowFootprint(in.view));
}
/** A water fragment the surface stage keeps (\`fsWater\`: the side, the opacity test) marks the
 *  pages the composite reads there (\`markWaterAt\`); the composite lights any water outside the
 *  unlit view, which encodes no marks. */
@fragment fn markWaterShadows(in:VSOut,@builtin(front_facing) front:bool){
 let gradX=dpdx(in.uv);let gradY=dpdy(in.uv);let viewX=dpdx(in.view);let viewY=dpdy(in.view);
 if(!marksKept(in,front,gradX,gradY)){return;}
 markWaterAt(in.position.xy,in.position.z,blendGeometricNormal(in,front,viewX,viewY));
}`;
}
