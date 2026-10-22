import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { QUEUED_PROBE_WGSL } from '../probes/probeQueueWgsl.ts'
import { CACHE_MIPS_BINDINGS as B } from './cacheBindings.ts'
import {
  CACHE_TILE_SIDE,
  RADIANCE_CACHE_FORMATS as F,
  RADIANCE_CACHE_PARAMS,
} from './cacheLayout.ts'
import { CACHE_WORDS_WGSL } from './cacheWordsWgsl.ts'

/**
 * THE LEVELS OF DETAIL of the final maps, made for every probe traced this frame: level `CACHE_MIP` (a pipeline constant, 1 or 2)
 * of a probe's map is its level above averaged by blocks of two by two texels, half the side, a workgroup a probe. A ray whose cone
 * is wider than a texel of the map reads the level its width asks for (`spCacheRadiance`), so that a map traced at its full side is
 * not aliased by the few rays that read it.
 */
export const CACHE_MIPS_PROGRAM = wgslProgram(
  `${RADIANCE_CACHE_PARAMS.wgsl}
@group(0) @binding(${B.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${B.params}) var<uniform> cache:RadianceCacheParams;
@group(0) @binding(${B.entries}) var<storage,read> cacheEntries:array<u32>;
@group(0) @binding(${B.above}) var mipAbove:texture_2d<u32>;
@group(0) @binding(${B.below}) var mipBelow:texture_storage_2d<${F.final},write>;
${wgslConsts({ CACHE_TILE_SIDE })}
override CACHE_MIP:u32=1u;
@compute @workgroup_size(CACHE_TILE_SIDE,CACHE_TILE_SIDE)
fn buildMip(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let entry=group.x;
 if(entry>=bounce.frame.y||bounce.counts.w==0u||cacheEntries[entry]==0u){return;}
 let queued=queuedProbe(entry);
 if(!queued.valid){return;}
 let res=cache.size.x>>CACHE_MIP;
 let aboveBase=cacheTileOf(queued.slot,res*2u);
 let belowBase=cacheTileOf(queued.slot,res);
 for(var t=lane;t<res*res;t+=CACHE_TILE_SIDE*CACHE_TILE_SIDE){
  let texel=vec2u(t%res,t/res);
  var sum=vec3f(0.0);
  for(var j=0u;j<2u;j++){
   for(var i=0u;i<2u;i++){sum+=unpackLight(textureLoad(mipAbove,vec2i(aboveBase+texel*2u+vec2u(i,j)),0).r);}
  }
  textureStore(mipBelow,vec2i(belowBase+texel),vec4u(packLight(sum*0.25),0u,0u,0u));
 }
}`,
  [
    bounceBindingsWgsl(0, B.grid, B.probes),
    QUEUED_PROBE_WGSL,
    CACHE_WORDS_WGSL,
    packLight,
    unpackLight,
  ],
)
