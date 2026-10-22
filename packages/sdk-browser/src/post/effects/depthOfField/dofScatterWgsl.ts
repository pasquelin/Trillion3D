import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { DOF_COC_WGSL, DOF_PARAMS_WGSL } from './dofCommonWgsl.ts'
import {
  BOKEH_LUT_SIZE,
  DRAW_ARGUMENT_WORDS,
  SCATTER_GROUPS_PER_INSTANCE,
  SCATTER_GROUP_STRIDE,
  SCATTER_GROUP_VERTICES,
} from './dofLayout.ts'
import { DOF_VIGNETTE_WGSL } from './dofVignetteWgsl.ts'

/** The pack's bindings: the draw's arguments and the two sprite lists. */
export const PACK_BINDINGS = { arguments: 2, foregroundList: 3, backgroundList: 4 } as const
/** The draw's: the sprite list, the bokeh table, the occlusion, the sampler of both. */
export const SPRITE_BINDINGS = { list: 1, lut: 2, occlusion: 3, sampler: 4 } as const

/**
 * The scatter's draw arguments, made from the counts the reduction left: for each layer (a workgroup
 * of the dispatch of two), the sprite groups it holds — the counter held to the list's capacity —
 * give the vertices of an instance (`SCATTER_GROUPS_PER_INSTANCE` groups of 6) and the instances,
 * and the entries past the last group are zeroed, so the last instance's unused groups draw nothing.
 */
export const packShader = () =>
  wgslProgram(
    `override SCATTER_FG:bool=false;
override SCATTER_BG:bool=false;
@group(0) @binding(${PACK_BINDINGS.arguments}) var<storage,read_write> drawArguments:array<atomic<u32>>;
@group(0) @binding(${PACK_BINDINGS.foregroundList}) var<storage,read_write> foregroundList:array<vec4u>;
@group(0) @binding(${PACK_BINDINGS.backgroundList}) var<storage,read_write> backgroundList:array<vec4u>;
var<workgroup> groupCount:u32;
@compute @workgroup_size(1,${SCATTER_GROUPS_PER_INSTANCE},1)
fn packScatter(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 let slot=wg.x*${DRAW_ARGUMENT_WORDS}u;
 if(lane==0u){
  let count=min(atomicLoad(&drawArguments[slot+1u]),view.counts.x);
  groupCount=count;
  atomicStore(&drawArguments[slot],${SCATTER_GROUP_VERTICES * SCATTER_GROUPS_PER_INSTANCE}u);
  atomicStore(&drawArguments[slot+1u],(count+${SCATTER_GROUPS_PER_INSTANCE - 1}u)/${SCATTER_GROUPS_PER_INSTANCE}u);
 }
 workgroupBarrier();
 for(var i=0u;i<${SCATTER_GROUP_STRIDE}u;i++){
  let at=groupCount*${SCATTER_GROUP_STRIDE}u+lane+i*${SCATTER_GROUPS_PER_INSTANCE}u;
  if(SCATTER_FG&&wg.x==0u&&at<arrayLength(&foregroundList)){foregroundList[at]=vec4u(0u);}
  if(SCATTER_BG&&wg.x==1u&&at<arrayLength(&backgroundList)){backgroundList[at]=vec4u(0u);}
 }
}`,
    [DOF_PARAMS_WGSL],
  )

/**
 * The Petzval swirl's transform of a bokeh at clip position `centre`: a symmetric 2 × 2 matrix
 * `(m₀₀, m₀₁, m₁₁)`, the identity where the swirl is none or the bokeh is inside the exclusion box.
 * Past the box, along the direction `n` from the box to the bokeh, the bokeh is stretched by
 * `1 + |p| d^falloff` (`d` the distance past the box, `p` the strength) along the tangent where the
 * strength is positive, along `n` where it is not (`scatter`); the gather shrinks it by the
 * inverse instead (`inverse`).
 */
export const DOF_PETZVAL_WGSL = wgslBlock(
  'DOF_PETZVAL_WGSL',
  [DOF_PARAMS_WGSL],
  `
fn petzvalTransform(centre:vec2f,inverse:bool)->vec3f{
 let extents=view.petzval.zw;
 let radius=view.petzvalMore.x*min(extents.x,extents.y);
 let box=sign(centre)*max(abs(centre)-extents+vec2f(radius),vec2f(0.0));
 let outside=max(0.0,length(box));
 let normal=box/outside;
 let past=max(0.0,outside-radius);
 if(!(past>0.0)){return vec3f(1.0,0.0,1.0);}
 let stretch=1.0+abs(view.petzval.x)*pow(past,view.petzval.y);
 let factor=select(stretch,1.0/stretch,inverse);
 let sagittal=view.petzval.x>0.0;
 let x=select(1.0,factor,sagittal);
 let y=select(factor,1.0,sagittal);
 return vec3f(x*normal.x*normal.x+y*normal.y*normal.y,(x-y)*normal.x*normal.y,x*normal.y*normal.y+y*normal.x*normal.x);
}
fn petzvalApply(v:vec2f,m:vec3f)->vec2f{return vec2f(v.x*m.x+v.y*m.y,v.x*m.y+v.y*m.z);}`,
)

/** The scatter's draw: the layer's sign mirrors the table, the shape's table, the occlusion, the
 *  quality (the swirl and the barrel's vignette). */
const SCATTER_SPRITES_WGSL = wgslBlock(
  'SCATTER_SPRITES_WGSL',
  [DOF_PARAMS_WGSL, DOF_COC_WGSL, DOF_VIGNETTE_WGSL, DOF_PETZVAL_WGSL],
  `
override BACKGROUND:bool=false;
override BOKEH:bool=false;
override OCCLUSION:bool=false;
override HIGH:bool=false;
@group(0) @binding(${SPRITE_BINDINGS.list}) var<storage,read> spriteList:array<vec4u>;
@group(0) @binding(${SPRITE_BINDINGS.lut}) var bokehLut:texture_2d<f32>;
@group(0) @binding(${SPRITE_BINDINGS.occlusion}) var occlusionTexture:texture_2d<f32>;
@group(0) @binding(${SPRITE_BINDINGS.sampler}) var spriteSampler:sampler;
struct SpriteOut{
 @builtin(position) position:vec4f,
 @location(0) @interpolate(flat) sprite:u32,
 @location(1) @interpolate(flat) centre:vec2f,
 @location(2) @interpolate(flat) swirl:vec3f,
}
fn corner(slot:u32)->vec2f{
 return vec2f(select(-1.0,1.0,slot==1u||slot==2u||slot==4u),select(-1.0,1.0,slot==0u||slot==1u||slot==5u));
}
@vertex
fn scatterVertex(@builtin(vertex_index) vertexId:u32,@builtin(instance_index) instanceId:u32)->SpriteOut{
 let local=vertexId/${SCATTER_GROUP_VERTICES}u;
 let sprite=${SCATTER_GROUPS_PER_INSTANCE}u*instanceId+local;
 let base=sprite*${SCATTER_GROUP_STRIDE}u;
 let centre=bitcast<vec4f>(spriteList[base]).xy;
 var largest=0.0;
 for(var i=0u;i<4u;i++){largest=max(largest,bitcast<f32>(spriteList[base+1u+i*3u].w));}
 var out:SpriteOut;
 let gather=vec2f(view.gather.xy);
 out.swirl=vec3f(1.0,0.0,1.0);
 if(HIGH&&view.petzval.x!=0.0){out.swirl=petzvalTransform((centre/gather)*2.0-1.0,false);}
 let reach=largest*view.bokeh.z*vec2f(view.lens.y,1.0)+1.0;
 let uv=(reach*corner(vertexId%${SCATTER_GROUP_VERTICES}u)+centre+0.5)/gather;
 out.position=vec4f(uv.x*2.0-1.0,1.0-uv.y*2.0,0.0,1.0);
 out.sprite=sprite;
 out.centre=centre;
 return out;
}`,
)

/**
 * The scatter's draw, vertex shader and pixel. The vertex shader draws a quad of 6 vertices for each group of
 * 2 × 2 samples, as big as the largest of the group's sprites, `SCATTER_GROUPS_PER_INSTANCE` groups an
 * instance. The pixel: a group of 2 × 2 samples, each a sprite of its colour and radius `r`, centred
 * on its own texel; this pixel's offset from each — squeezed, and swirled at the top quality —
 * gives the sprite's coverage of it: `saturate(r f − d + ½)` where `d` is the offset's length and `f`
 * the shape's edge factor in that direction (the table, read mirrored for the foreground, `BOKEH`),
 * else `saturate(½ + ½ r − d² / 2r)`, the circle's first-order expansion. The coverage is weighed by
 * the visibility the gather's occlusion leaves it (`OCCLUSION`: the variance over the variance plus
 * the square of how much larger the sprite's radius is than the gathered average) and the barrel's
 * and the matte box's; the colour adds into the layer (one-one blend).
 */
export const spriteShader = () =>
  wgslProgram(
    `@fragment
fn scatterFragment(
 @builtin(position) position:vec4f,
 @location(0) @interpolate(flat) sprite:u32,
 @location(1) @interpolate(flat) centre:vec2f,
 @location(2) @interpolate(flat) swirl:vec3f,
)->@location(0) vec4f{
 let base=sprite*${SCATTER_GROUP_STRIDE}u;
 let mirror=select(-1.0,1.0,BACKGROUND);
 var occlusion=vec2f(0.0);
 if(OCCLUSION){
  occlusion=textureSampleLevel(occlusionTexture,spriteSampler,position.xy/vec2f(view.gather.zw),0.0).xy;
 }
 var sum=vec3f(0.0);
 for(var i=0u;i<4u;i++){
  let entry=spriteList[base+1u+i*3u];
  let radius=bitcast<f32>(entry.w);
  var offset=position.xy-centre-vec2f(f32(i&1u),f32(i>>1u));
  if(HIGH&&view.petzval.x!=0.0){offset=petzvalApply(offset,swirl);}
  offset.x*=view.lens.x;
  let away=length(offset);
  var coverage=0.0;
  if(BOKEH){
   let uv=offset*(mirror*(0.5-1.0/${BOKEH_LUT_SIZE}.0))*safeRcp(away);
   coverage=saturate(radius*textureSampleLevel(bokehLut,spriteSampler,uv,0.0).x-away+0.5);
  }else{
   coverage=saturate(dot(offset,offset)*(-0.5*safeRcp(radius))+0.5*radius+0.5);
  }
  if(coverage>0.0){
   var visibility=1.0;
   if(OCCLUSION){
    let excess=max(radius*0.95-occlusion.x,0.0);
    visibility=occlusion.y/(occlusion.y+excess*excess);
   }
   if(HIGH&&view.barrel.y>=0.0){
    let d0=spriteList[base+2u+i*3u];
    let d1=spriteList[base+3u+i*3u];
    let hit=hitCylinder(offset,d0.xy);
    visibility*=hit.visible*hitFlag(hit.at,d0.zw)*hitFlag(hit.at,d1.xy)*hitFlag(hit.at,d1.zw);
   }
   sum+=bitcast<vec3f>(entry.xyz)*(coverage*visibility);
  }
 }
 return vec4f(sum,0.0);
}`,
    [SCATTER_SPRITES_WGSL],
  )
