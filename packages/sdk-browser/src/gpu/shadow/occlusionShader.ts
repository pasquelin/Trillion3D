import { HIZ_HIDES_WGSL, HIZ_LEVEL_WGSL } from '../hiz/rectWgsl.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { PAGE_HIZ_LEVELS, PAGE_HIZ_OFFSETS, PAGE_HIZ_WORDS } from './pageHiz.ts';
import {
  OCCLUSION_SLOT_WORDS as SLOT,
  OCCLUSION_UNIFORM_WORDS,
  SHADOW_FACE_STRIDE,
  wordStruct,
} from './batchBudget.ts';
import { KEPT_LISTS_WGSL } from './cullShader.ts';

/** A region whose casters are not tested: it draws what its cull kept. */
export const HIZ_UNTESTED = 0xffffffff;

/**
 * The occlusion test of a page's moving casters against its static layer. Each tested region names
 * the pyramid of its page (`slots[4·r]`, or `HIZ_UNTESTED`); each caster its cull kept is projected
 * by the page's own matrix — the region's face uniform, read as storage — through the eight corners
 * of its sphere's box, and its nearest depth compared with the farthest the pyramid holds under its
 * rectangle, with the camera's own level choice and read (`../hiz/rectWgsl.ts`). Reversed depth: a
 * caster is hidden when its NEAREST is SMALLER than that farthest. What is not hidden is appended
 * to the region's visible list of its kind — both of the cull's, laid out alike (`KEPT_LISTS_WGSL`,
 * #965); the count of what was hidden goes to `slots[4·r + 1]`.
 */
export const SHADOW_OCCLUSION_SHADER = `struct Sphere{center:vec3f,radius:f32,}
struct View{@size(${SHADOW_FACE_STRIDE}) viewProjection:mat4x4f,}
${wordStruct('Uni', ['regions:u32', 'capacity:u32'], OCCLUSION_UNIFORM_WORDS)}
@group(0) @binding(0) var<storage, read> spheres:array<Sphere>;
@group(0) @binding(1) var<storage, read> kept:array<u32>;
@group(0) @binding(2) var<storage, read> indirect:array<u32>;
@group(0) @binding(3) var<storage, read_write> visible:array<u32>;
@group(0) @binding(4) var<storage, read_write> visibleIndirect:array<atomic<u32>>;
@group(0) @binding(5) var<storage, read> views:array<View>;
@group(0) @binding(6) var<storage, read> pyramid:array<f32>;
@group(0) @binding(7) var<storage, read_write> slots:array<atomic<u32>>;
@group(0) @binding(8) var<uniform> uni:Uni;
const PAGE_TEXELS:f32=${SHADOW_PAGE}.0;
${KEPT_LISTS_WGSL}
const LEVEL_OFFSET:array<u32,${PAGE_HIZ_LEVELS}>=array<u32,${PAGE_HIZ_LEVELS}>(${PAGE_HIZ_OFFSETS.map((o) => `${o}u`).join(',')});
${HIZ_LEVEL_WGSL}${HIZ_HIDES_WGSL}
/** True when the page's pyramid in \`slot\` hides the box around \`s\`, projected by \`m\`. */
fn hiddenInPage(s:Sphere,m:mat4x4f,slot:u32)->bool{
 var lo=vec2f(1.0e30);var hi=vec2f(-1.0e30);var nearest=-1.0e30;
 for(var k=0u;k<8u;k++){
  let corner=s.center+s.radius*vec3f(select(-1.0,1.0,(k&1u)!=0u),select(-1.0,1.0,(k&2u)!=0u),select(-1.0,1.0,(k&4u)!=0u));
  let clip=m*vec4f(corner,1.0);
  if(clip.w<=0.0){return false;}
  let ndc=clip.xyz/clip.w;
  let texel=vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5)*PAGE_TEXELS;
  lo=min(lo,texel);hi=max(hi,texel);nearest=max(nearest,ndc.z);
 }
 let rect=vec4i(clamp(vec2i(floor(lo)),vec2i(0),vec2i(${SHADOW_PAGE - 1})),clamp(vec2i(floor(hi)),vec2i(0),vec2i(${SHADOW_PAGE - 1})));
 let pick=hizLevelFor(rect,${PAGE_HIZ_LEVELS}u);
 if(pick.y==0u){return false;}
 let l=pick.x;let c=pick.z;
 return pyramidHides(rect.x>>l,rect.y>>l,rect.z>>l,rect.w>>l,slot*${PAGE_HIZ_WORDS}u+LEVEL_OFFSET[l],${SHADOW_PAGE}u>>l,nearest,0.0,
  slot*${PAGE_HIZ_WORDS}u+LEVEL_OFFSET[c],${SHADOW_PAGE}u>>c,c-l);
}
@compute @workgroup_size(64)
fn shadowHizTest(@builtin(global_invocation_id) id:vec3u){
 let r=id.y;
 if(r>=uni.regions){return;}
 // A visible list draws the corners of the list it comes from: all its casters' triangles (#966).
 if(id.x==0u){for(var list=0u;list<2u;list++){atomicStore(&visibleIndirect[keptCorners(r,list==1u)],indirect[keptCorners(r,list==1u)]);}}
 let slot=atomicLoad(&slots[r*${SLOT}u]);
 let opaque=min(indirect[keptCount(r,false)],uni.capacity);
 let cutouts=min(indirect[keptCount(r,true)],uni.capacity-opaque);
 if(slot==${HIZ_UNTESTED}u||id.x>=opaque+cutouts){return;}
 let cutout=id.x>=opaque;
 let row=kept[keptAt(r,select(id.x,id.x-opaque,cutout),uni.capacity,cutout)];
 if(hiddenInPage(spheres[row],views[r].viewProjection,slot)){atomicAdd(&slots[r*${SLOT}u+1u],1u);return;}
 visible[keptAt(r,atomicAdd(&visibleIndirect[keptCount(r,cutout)],1u),uni.capacity,cutout)]=row;
}
`;
