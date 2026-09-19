import { FULLSCREEN_VERTEX } from './deferredLightingShaders.ts';
import { PAGE_INFO_STRUCT_WGSL } from './visibilityPageWgsl.ts';

/** Pass label; its timestamp duration absorbs that of the passes that precede it on
 *  some devices (apple metal-3), and is only read safely by envelope difference. */
export const TAA_PASS = 'WG temporal antialiasing';

/** Pass bindings, in the order of its layout entries. */
export const TAA_BINDINGS = {
  current: 0,
  history: 1,
  historySampler: 2,
  depth: 3,
  ids: 4,
  pages: 5,
  motion: 6,
  view: 7,
} as const;

/** Uniform bytes: two matrices, three quadruplets, then the nine weights in three. */
export const TAA_VIEW_BYTES = 208;

/**
 * Pass uniform. `prevViewProj` and `invViewProj` are REPORTED TO THIS FRAME'S EYE and
 * both WITHOUT jitter: the inverse yields, for the unshifted pixel centre and the depth read at
 * the sample, a position relative to the eye; the previous one takes it as-is — the same
 * anchoring as the partition, so five-digit world coordinates of an urban model do not eat
 * the single-precision of the reprojection. `viewport` = (width, height, 1/width,
 * 1/height); `params` = (current-frame share, history valid, a placement moved, 0);
 * `weights` = the nine weights of the current-frame filter, neighbour by neighbour (`taaWeights.ts`).
 */
const VIEW_WGSL = `struct TaaView{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,weights:array<vec4f,3>,}`;

const BINDINGS_WGSL = `
@group(0) @binding(${TAA_BINDINGS.current}) var current:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.history}) var history:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.historySampler}) var historySampler:sampler;
@group(0) @binding(${TAA_BINDINGS.depth}) var depth:texture_depth_2d;
@group(0) @binding(${TAA_BINDINGS.ids}) var ids:texture_2d<u32>;
@group(0) @binding(${TAA_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${TAA_BINDINGS.motion}) var<storage,read> motion:array<mat4x4f>;
@group(0) @binding(${TAA_BINDINGS.view}) var<uniform> view:TaaView;`;

/** YCoCg, the space where the neighbour box tightens best around the colour. */
export const YCOCG_WGSL = `
fn toYcocg(c:vec3f)->vec3f{return vec3f(0.25*c.r+0.5*c.g+0.25*c.b,0.5*c.r-0.5*c.b,-0.25*c.r+0.5*c.g-0.25*c.b);}
fn fromYcocg(c:vec3f)->vec3f{return vec3f(c.x+c.y-c.z,c.x+c.z,c.x-c.y-c.z);}`;

/**
 * Where this pixel was on the previous frame, in history texture coordinates, and whether that
 * position is readable. The pixel is rebuilt in homogeneous from its depth — the background, at
 * zero depth (reversed, infinite far plane), is a direction and reprojects too, which
 * keeps the silhouette stable when the camera turns. When a placement has moved, a geometry
 * pixel first goes through its own motion matrix — `previous·current⁻¹`, identity
 * for those that have not moved; otherwise nothing is read, neither identifier, nor record, nor matrix.
 */
export const TAA_REPROJECT_WGSL = `
fn previousUv(coord:vec2i,depthValue:f32)->vec3f{
 let ndc=vec2f((f32(coord.x)+0.5)*view.viewport.z*2.0-1.0,1.0-(f32(coord.y)+0.5)*view.viewport.w*2.0);
 var position=view.invViewProj*vec4f(ndc,depthValue,1.0);
 if(view.params.z!=0.0){
  let id=textureLoad(ids,coord,0).r;
  if(id!=0u){position=motion[pages[(id>>8u)-1u].placement]*position;}
 }
 let previous=view.prevViewProj*position;
 if(previous.w<=0.0){return vec3f(0.0,0.0,0.0);}
 let uv=vec2f(previous.x/previous.w*0.5+0.5,0.5-previous.y/previous.w*0.5);
 let inside=all(uv>=vec2f(0.0))&&all(uv<=vec2f(1.0));
 return vec3f(uv,select(0.0,1.0,inside));
}`;

/**
 * Temporal resolve. The current image is refiltered on its 3×3 neighbours with the uniform
 * weights (Blackman-Harris centred on the unshifted centre); history is read at the
 * reprojected point, clamped to the YCoCg box of those
 * same neighbours — which removes ghosts of a moving object or a discovery — then the
 * two are mixed, each weighted by the inverse of its luminance so a spark does not settle.
 * All four channels are accumulated: alpha carries the coverage that composition divides.
 */
export const TAA_SHADER = `
${PAGE_INFO_STRUCT_WGSL}
${VIEW_WGSL}
${BINDINGS_WGSL}
${FULLSCREEN_VERTEX}
${YCOCG_WGSL}
${TAA_REPROJECT_WGSL}
@fragment fn resolve(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);
 let last=vec2i(view.viewport.xy)-vec2i(1);
 var filtered=vec4f(0.0);
 var lo=vec4f(1e9);var hi=vec4f(-1e9);
 var k=0u;
 for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let sample=textureLoad(current,clamp(coord+vec2i(dx,dy),vec2i(0),last),0);
  filtered+=sample*view.weights[k>>2u][k&3u];k++;
  let y=vec4f(toYcocg(sample.rgb),sample.a);
  lo=min(lo,y);hi=max(hi,y);
 }}
 if(view.params.y==0.0){return filtered;}
 let previous=previousUv(coord,textureLoad(depth,coord,0));
 if(previous.z==0.0){return filtered;}
 let read=textureSampleLevel(history,historySampler,previous.xy,0.0);
 let clamped=clamp(vec4f(toYcocg(read.rgb),read.a),lo,hi);
 let kept=vec4f(fromYcocg(clamped.xyz),clamped.w);
 let alpha=view.params.x;
 let wc=alpha/(1.0+toYcocg(filtered.rgb).x);
 let wh=(1.0-alpha)/(1.0+clamped.x);
 return (filtered*wc+kept*wh)/(wc+wh);
}`;
