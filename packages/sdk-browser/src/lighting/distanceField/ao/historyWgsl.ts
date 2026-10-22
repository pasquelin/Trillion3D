import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { unprojectPoint } from '../../../../../math/src/wgsl/projection.ts'
import { VECTOR_CODEC_WGSL } from '../../../post/taa/velocityWgsl.ts'
import { DFAO_COMMON_WGSL } from './commonWgsl.ts'
import { TILE_SIZE } from './cones.ts'
import { DFAO_BENT_FORMAT, DFAO_BINDING as B, DFAO_FLAG } from './layout.ts'
import { DFAO_UPSAMPLE_WGSL } from './upsampleWgsl.ts'

/** The side of the group of the upsample and the history passes. */
export const HISTORY_GROUP = TILE_SIZE

const OUTPUT = `@group(0) @binding(${B.output}) var bentOut:texture_storage_2d<${DFAO_BENT_FORMAT},write>;`

/**
 * THE UPSAMPLE ALONE (`dfaoUpsampleOnly`), a thread a cell of the grid's view: the geometry-aware upsample
 * (`dfaoUpsample`) written as it is. It builds the history where there is none (the first image, a camera cut) and the
 * image of a frame whose history is off.
 */
export const DFAO_UPSAMPLE_ONLY_WGSL = wgslProgram(
  `${OUTPUT}
@compute @workgroup_size(${HISTORY_GROUP},${HISTORY_GROUP})
fn dfaoUpsampleOnly(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=dfao.grid.zw/2u)){return;}
 textureStore(bentOut,vec2i(id.xy),dfaoUpsample(id.xy));
}`,
  [DFAO_UPSAMPLE_WGSL],
)

/**
 * WHERE THE LAST IMAGE'S VALUE IS: `dfaoHistoryWeight`, the share of the last image kept at a cell, 0 where the
 * history is another surface's — the point the last image's depth there puts in the world (`previousUnproject`)
 * further from this cell's point than `dfao.history.y / 1000` of its depth —, and the cell's place in the last
 * image, from the motion of its surface: the vector the velocity stage drew, else the camera's alone (`clipToPreviousClip`).
 */
const HISTORY_PLACE = wgslBlock(
  'DFAO_HISTORY_PLACE_WGSL',
  [DFAO_COMMON_WGSL, VECTOR_CODEC_WGSL, unprojectPoint],
  `@group(0) @binding(${B.vectors}) var surfaceVectors:texture_2d<u32>;
fn dfaoMotion(texel:vec2u,ndc:vec2f,depth:f32)->vec2f{
 if((dfao.counts.w&${DFAO_FLAG.velocity}u)!=0u){
  let last=vec2i(dfao.grid.zw)-vec2i(1);
  return decodeVector(textureLoad(surfaceVectors,min(vec2i(texel)*2,last),0).r);
 }
 let before=dfao.clipToPreviousClip*vec4f(ndc,dfaoDeviceDepth(depth),1.0);
 return ndc-before.xy/before.w;
}
fn dfaoHistoryWeight(ndc:vec2f,depth:f32,oldNdc:vec2f,oldDepth:f32)->f32{
 let now=dfaoWorldAt(ndc,depth);
 let before=unprojectPoint(dfao.previousUnproject,vec3f(oldNdc,dfaoDeviceDepth(oldDepth)));
 return select(1.0,0.0,length(before-now)/depth>dfao.history.y/1000.0);
}`,
)

/**
 * THE HISTORY'S UPDATE (`dfaoUpdateHistory`), a thread a cell of the grid's view: the upsample of the cones
 * (`dfaoUpsample`) mixed with the last image's value where this cell's surface was, by the share `weight · position
 * weight` (`dfaoHistoryWeight`), the last image's read bilinearly; 0 where that falls outside the last view. The
 * result is held finite. With the stability pass on, the alpha — the cell's depth — carries the sign of whether the
 * history was kept: negative where it was dropped, for the pass that follows to fill (`dfaoFilterHistory`).
 */
export const DFAO_UPDATE_HISTORY_WGSL = wgslProgram(
  `@group(0) @binding(${B.history}) var lastBent:texture_2d<f32>;
@group(0) @binding(${B.sampler}) var lastSampler:sampler;
${OUTPUT}
fn dfaoFinite(v:vec3f)->vec3f{
 return select(vec3f(0.0),v,abs(v)<vec3f(3.4e38));
}
@compute @workgroup_size(${HISTORY_GROUP},${HISTORY_GROUP})
fn dfaoUpdateHistory(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=dfao.grid.zw/2u)){return;}
 let value=dfaoUpsample(id.xy);
 let ndc=dfaoViewNdc(vec2f(id.xy)+vec2f(0.5));
 let oldNdc=ndc-dfaoMotion(id.xy,ndc,value.w);
 let oldUv=oldNdc*dfao.historyScale.xy+dfao.historyScale.wz;
 var weight=dfao.history.x;
 if(any(oldUv>dfao.historyUv.zw)||any(oldUv<dfao.historyUv.xy)){weight=0.0;}
 let past=textureSampleLevel(lastBent,lastSampler,clamp(oldUv,dfao.historyUv.xy,dfao.historyUv.zw),0.0);
 weight*=dfaoHistoryWeight(ndc,value.w,oldNdc,past.w);
 var depth=value.w;
 if(dfao.history.z>0.0){depth*=select(-1.0,1.0,weight>0.0);}
 textureStore(bentOut,vec2i(id.xy),vec4f(dfaoFinite(mix(value.xyz,past.xyz,weight)),depth));
}`,
  [DFAO_UPSAMPLE_WGSL, HISTORY_PLACE],
)

/**
 * THE HISTORY'S STABILITY PASS (`dfaoFilterHistory`), a thread a cell of the grid's view: the cells that dropped
 * their history (a negative depth) are seeded with a spatial search of the stable ones round them — a 5 × 5 kernel, each
 * cell weighed by `2^-1000·|Δdepth|/depth` (so that no foreground is pulled into what lies behind it), by
 * `max(2^-|x·5|, 2^-|y·5|)` over the kernel's offsets, and kept only if its history was kept (a positive depth) —
 * as if that were the last image's value and this frame's the new one: `mix(value, search, history weight)`, where
 * the weights sum to more than 0.01. The depth comes out positive. Where the view is smaller than the grid, the cells
 * read are held to its first `dfao.uvMax.zw` of the grid.
 */
export const DFAO_FILTER_HISTORY_WGSL = wgslProgram(
  `@group(0) @binding(${B.bent}) var freshBent:texture_2d<f32>;
${OUTPUT}
fn dfaoFresh(texel:vec2i)->vec4f{
 var at=clamp(texel,vec2i(0),vec2i(dfao.grid.xy)-vec2i(1));
 if((dfao.counts.w&${DFAO_FLAG.clampView}u)!=0u){at=min(at,vec2i(floor(dfao.uvMax.zw*vec2f(dfao.grid.xy))));}
 return textureLoad(freshBent,at,0);
}
@compute @workgroup_size(${HISTORY_GROUP},${HISTORY_GROUP})
fn dfaoFilterHistory(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=dfao.grid.zw/2u)){return;}
 var value=dfaoFresh(vec2i(id.xy));
 if(value.w<0.0){
  let depth=abs(value.w);
  var sum=vec4f(0.0);
  for(var y=-2;y<=2;y++){
   for(var x=-2;x<=2;x++){
    let near=dfaoFresh(vec2i(id.xy)+vec2i(x,y));
    let valid=select(0.0,1.0,near.w>0.0);
    let depthWeight=exp2(-1000.0*abs(depth-abs(near.w))/depth);
    let spatial=exp2(-abs(vec2f(f32(x),f32(y))*5.0));
    let weight=valid*max(spatial.x,spatial.y)*depthWeight;
    sum+=vec4f(near.xyz*weight,weight);
   }
  }
  if(sum.w>0.01){
   value=vec4f(mix(value.xyz,sum.xyz/sum.w,dfao.history.x),value.w);
  }
 }
 textureStore(bentOut,vec2i(id.xy),vec4f(value.xyz,abs(value.w)));
}`,
  [DFAO_COMMON_WGSL],
)
