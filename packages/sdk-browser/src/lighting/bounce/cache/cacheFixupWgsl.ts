import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { octWrapBorder } from '../../../../../math/src/wgsl/octahedral.ts'
import { ditherLight, packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { QUEUED_PROBE_WGSL } from '../probes/probeQueueWgsl.ts'
import { CACHE_FIXUP_BINDINGS as B } from './cacheBindings.ts'
import {
  CACHE_TILE_SIDE,
  RADIANCE_CACHE_FLAGS,
  RADIANCE_CACHE_FORMATS as F,
  RADIANCE_CACHE_PARAMS,
} from './cacheLayout.ts'
import { CACHE_WORDS_WGSL } from './cacheWordsWgsl.ts'

/**
 * THE FINAL MAPS: the map of every probe the frame queued, copied to the final atlas with the border all round it and the levels of
 * detail, a workgroup a probe. The map is the filter's (`filterMaps`, at the probe's rank in the queue) where the filter runs
 * (`RADIANCE_CACHE_FLAGS.filter`), else the raw atlas's, at the probe's slot. A texel of the final map is the input at the texel it wraps
 * to (`octWrapBorder`, over the map and a border of `cacheBorder` texels: the map's edge wrapped as an octahedron's), dithered by a hash of
 * the input's place in its atlas and the image's turn; the probe is walked in blocks of 8 × 8 texels. Each block makes the levels of detail
 * it covers from the light it read, not from what was stored: the mean of 2 × 2 texels of the level before, held in the workgroup's memory,
 * each level dithered by a hash of the texel it is written to — the border of a level is the mean of the border of the one before. The share
 * of a ray that left the scene, where the sky is kept apart, is copied to the sky's atlas, the first level alone.
 */
export const CACHE_FIXUP_PROGRAM = wgslProgram(
  `${RADIANCE_CACHE_PARAMS.wgsl}
@group(0) @binding(${B.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${B.params}) var<uniform> cache:RadianceCacheParams;
@group(0) @binding(${B.raw}) var cacheRaw:texture_2d<u32>;
@group(0) @binding(${B.filtered}) var filteredIn:texture_2d<u32>;
@group(0) @binding(${B.filteredSky}) var filteredSkyIn:texture_2d<f32>;
@group(0) @binding(${B.final0}) var finalOut0:texture_storage_2d<${F.final},write>;
@group(0) @binding(${B.final1}) var finalOut1:texture_storage_2d<${F.final},write>;
@group(0) @binding(${B.final2}) var finalOut2:texture_storage_2d<${F.final},write>;
@group(0) @binding(${B.sky}) var skyOut:texture_storage_2d<${F.sky},write>;
${wgslConsts({
  CACHE_TILE_SIDE,
  CACHE_FLAG_FILTER: RADIANCE_CACHE_FLAGS.filter,
  CACHE_FLAG_SKY: RADIANCE_CACHE_FLAGS.sky,
})}
var<workgroup> mipLight0:array<vec3f,${CACHE_TILE_SIDE * CACHE_TILE_SIDE}>;
var<workgroup> mipLight1:array<vec3f,${(CACHE_TILE_SIDE / 2) * (CACHE_TILE_SIDE / 2)}>;
/** The word of a final texel at \`at\` of an atlas: the light, dithered by a hash of the place and the image's turn. */
fn fixupWord(light:vec3f,at:vec2u)->vec4u{return vec4u(packLight(ditherLight(light,cacheDither(at))),0u,0u,0u);}
/** The border of the final maps: one texel doubled for each level of detail past the first. */
fn fixupBorder()->u32{return 1u<<(cache.mipmaps-1u);}
/** First phase of a block of 8 × 8 texels of the probe in slot \`slot\`, queued at \`entry\`: the thread at \`local\` of the block at \`block\`
 *  writes its texel of the first level and of the sky's share, and keeps the light it read in the workgroup's memory. */
fn fixupLoad(entry:u32,slot:u32,block:vec2u,local:vec2u,lane:u32){
 let res=cache.resolution;
 let border=fixupBorder();
 let side=res+2u*border;
 let filtered=(cache.flags&CACHE_FLAG_FILTER)!=0u;
 let slotBase=cacheTileOf(slot,res);
 let inputBase=select(slotBase,cacheTempTileOf(entry,res,cache.tempRow),filtered);
 let texel=block*CACHE_TILE_SIDE+local;
 var light=vec3f(0.0);
 if(all(texel<vec2u(side))){
  let source=inputBase+octWrapBorder(texel,side,border);
  var share=0.0;
  if(filtered){
   light=unpackLight(textureLoad(filteredIn,vec2i(source),0).r);
   if((cache.flags&CACHE_FLAG_SKY)!=0u){share=textureLoad(filteredSkyIn,vec2i(source),0).r;}
  }else{
   let own=textureLoad(cacheRaw,vec2i(source),0);
   light=unpackLight(own.r);
   share=cacheSkyOf(own.g);
  }
  let into=cacheTileOf(slot,side)+texel;
  textureStore(finalOut0,vec2i(into),fixupWord(light,source));
  if((cache.flags&CACHE_FLAG_SKY)!=0u){textureStore(skyOut,vec2i(into),vec4f(share,0.0,0.0,0.0));}
 }
 mipLight0[lane]=light;
}
/** Second phase: the thread at \`local\` of the block at \`block\`, one of the first quarter, writes the texel of the second level that is the mean of
 *  the 2 × 2 texels of the first the block holds, and keeps it in the workgroup's memory. */
fn fixupMipOne(slot:u32,block:vec2u,local:vec2u){
 let side=(cache.resolution+2u*fixupBorder())>>1u;
 let at=local+block*(CACHE_TILE_SIDE>>1u);
 if(all(local<vec2u(CACHE_TILE_SIDE>>1u))&&all(at<vec2u(side))){
  let b=local*2u;
  let mean=(mipLight0[b.y*CACHE_TILE_SIDE+b.x]+mipLight0[b.y*CACHE_TILE_SIDE+b.x+1u]+mipLight0[(b.y+1u)*CACHE_TILE_SIDE+b.x]+mipLight0[(b.y+1u)*CACHE_TILE_SIDE+b.x+1u])/4.0;
  mipLight1[local.y*(CACHE_TILE_SIDE>>1u)+local.x]=mean;
  let into=cacheTileOf(slot,side)+at;
  textureStore(finalOut1,vec2i(into),fixupWord(mean,into));
 }
}
/** Third phase: the same for the third level, from the second level's means. */
fn fixupMipTwo(slot:u32,block:vec2u,local:vec2u){
 let side=(cache.resolution+2u*fixupBorder())>>2u;
 let at=local+block*(CACHE_TILE_SIDE>>2u);
 if(all(local<vec2u(CACHE_TILE_SIDE>>2u))&&all(at<vec2u(side))){
  let b=local*2u;
  let stride=CACHE_TILE_SIDE>>1u;
  let mean=(mipLight1[b.y*stride+b.x]+mipLight1[b.y*stride+b.x+1u]+mipLight1[(b.y+1u)*stride+b.x]+mipLight1[(b.y+1u)*stride+b.x+1u])/4.0;
  let into=cacheTileOf(slot,side)+at;
  textureStore(finalOut2,vec2i(into),fixupWord(mean,into));
 }
}
@compute @workgroup_size(CACHE_TILE_SIDE,CACHE_TILE_SIDE)
fn fixupMaps(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let entry=group.x;
 if(entry>=bounce.frame.y||bounce.counts.w==0u){return;}
 let queued=queuedProbe(entry);
 if(!queued.valid){return;}
 let top=cache.mipmaps-1u;
 let local=vec2u(lane%CACHE_TILE_SIDE,lane/CACHE_TILE_SIDE);
 let blocks=(cache.resolution+2u*fixupBorder()+CACHE_TILE_SIDE-1u)/CACHE_TILE_SIDE;
 for(var by=0u;by<blocks;by++){
  for(var bx=0u;bx<blocks;bx++){
   let block=vec2u(bx,by);
   fixupLoad(entry,queued.slot,block,local,lane);
   if(top>0u){
    workgroupBarrier();
    fixupMipOne(queued.slot,block,local);
   }
   if(top>1u){
    workgroupBarrier();
    fixupMipTwo(queued.slot,block,local);
   }
   workgroupBarrier();
  }
 }
}`,
  [
    bounceBindingsWgsl(0, B.grid, B.table),
    QUEUED_PROBE_WGSL,
    CACHE_WORDS_WGSL,
    octWrapBorder,
    packLight,
    unpackLight,
    ditherLight,
  ],
)
