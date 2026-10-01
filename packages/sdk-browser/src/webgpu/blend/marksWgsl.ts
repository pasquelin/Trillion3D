import { SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shadowRequestWgsl } from '../../lighting/direct/shadowRequestWgsl.ts';
import { FLAG_UNLIT_VIEW } from '../../visibility/buffer.ts';
import { SHADOW_DEMAND_LIGHT_WGSL } from '../shadow/demandWgsl.ts';
import { blendShader } from './shader.ts';

/** The marks' own group, after the blend pass's material and reflection groups, and its request
 *  buffer and opaque depth: past the display mask's binding, which the module declares there. */
export const BLEND_MARKS_GROUP = 2;
export const BLEND_MARKS_BINDINGS = { requests: 8, depth: 9 };
/** The item flag of a lit surface, and the debug view's, as `blendFragment` reads them. */
const LIT_FLAG = 1;
const DEBUG_VIEW_FLAG = 0x40000000;

/**
 * THE SHADOW PAGES A TRANSPARENT SURFACE READS, MARKED BEFORE THEY ARE MAPPED (#1411). Unreal's
 * virtual shadow maps mark the pages every receiver samples, translucent ones included; here the
 * blend runs are drawn once more, before the allocation, by a fragment stage that writes neither
 * colour nor depth: each fragment the blend pass lights marks, through the demand's own
 * `demandLight` (`SHADOW_DEMAND_LIGHT_WGSL`), the pages its read takes at its point, normal and
 * footprint. Its vertex stage, material and rejects are the blend module's (`blendShader`): the
 * same fragments, the same normal. The module's request is bound (`shadowRequestWgsl`), in the
 * marks' own group, where the blend pass's reads ask nothing and keep their early depth reject.
 */
export function blendShadowMarksWgsl(pages = SUN_WINDOW) {
  const shader = blendShader(pages),
    reads = shadowRequestWgsl(null, pages),
    asks = shadowRequestWgsl(BLEND_MARKS_BINDINGS.requests, pages, BLEND_MARKS_GROUP);
  if (!shader.includes(reads)) throw new Error('SHADOW_REQUESTS_ABSENT');
  return `${shader.replace(reads, () => asks)}
${SHADOW_DEMAND_LIGHT_WGSL}
@group(${BLEND_MARKS_GROUP}) @binding(${BLEND_MARKS_BINDINGS.depth}) var markDepth:texture_depth_2d;
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
 for(var index=0u;index<slice.y;index++){
  var light=index;
  if(slice.x!=TILE_NO_SLICE){light=tileLights[slice.x+index];}
  demandLight(directLights.items[light],P,P,N,thin,footprint);
 }
}
/** A blend fragment the pass lights marks its pages: past the material's rejects, lit, outside
 *  the debug views, and in front of the opaque — the pass's depth test, made here before any
 *  write, as a stage that writes memory may run its depth test late. */
@fragment fn markShadows(in:VSOut,@builtin(front_facing) front:bool){
 let s=blendSurface(in,front);
 if(!lineDash(in.uv.x,in.alphaAo.zw)){discard;}
 let flags=in.ids.y;
 if((flags&${LIT_FLAG}u)==0u||(flags&${FLAG_UNLIT_VIEW | DEBUG_VIEW_FLAG}u)!=0u){return;}
 if(in.position.z<=textureLoad(markDepth,vec2i(in.position.xy),0)){return;}
 markBlendShadows(in.position.xy,in.position.z,in.view,s.N,any(s.subsurface>vec3f(0.0)),blendShadowFootprint(in.view));
}`;
}
