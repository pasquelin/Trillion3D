import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { fastAcos } from '../../../../../math/src/wgsl/geometry.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { ditherLight, packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { QUEUED_PROBE_WGSL } from '../probes/probeQueueWgsl.ts'
import { CACHE_FILTER_BINDINGS as B } from './cacheBindings.ts'
import {
  CACHE_TILE_SIDE,
  RADIANCE_CACHE_FLAGS,
  RADIANCE_CACHE_TEMP_FORMATS as T,
  RADIANCE_CACHE_PARAMS,
} from './cacheLayout.ts'
import { CACHE_WORDS_WGSL } from './cacheWordsWgsl.ts'

/** The six cells beside a probe, each along an axis, and the threads of a workgroup. */
const NEIGHBOURS = 6

/**
 * THE FILTER OF THE MAPS: the radiance of every texel of a probe's map the frame queued, averaged with the same
 * texel of its six neighbours' (the cells beside its own on each axis, one level, those the level holds that have a probe), as a
 * workgroup a probe. A neighbour's texel weighs `1 − angle / filterAngle`, the angle the neighbour's ray in that direction, taken from
 * the neighbour, makes with the probe's own ray as it is seen from the probe — the neighbour's distance held to the probe's where it met a
 * surface, so that a contact keeps its shadow —, and nothing where the neighbour's ray met the back of a one-sided surface or where a
 * surface stands between the two: the ray of each probe, started twice the nearest a ray starts at past the other, ends before it reaches
 * the other's point (the distance the other's map holds in that direction). The result, dithered by the blue noise of the texel and the
 * image's turn, is the texel of the filter's own atlas, at the probe's rank in the queue (`cacheTempTileOf`): `fixupMaps` copies it to the
 * final atlas (`cacheFixupWgsl.ts`). Without the filter (`RADIANCE_CACHE_FLAGS.filter`) this kernel does not run and the final map is
 * the raw one. The share of a ray that left the scene (`cacheSkyOf`), where the sky is kept apart, is filtered by the same weights into the
 * sky's atlas.
 */
export const CACHE_FILTER_PROGRAM = wgslProgram(
  `${RADIANCE_CACHE_PARAMS.wgsl}
@group(0) @binding(${B.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${B.params}) var<uniform> cache:RadianceCacheParams;
@group(0) @binding(${B.raw}) var cacheRaw:texture_2d<u32>;
@group(0) @binding(${B.filtered}) var filteredOut:texture_storage_2d<${T.filtered},write>;
@group(0) @binding(${B.filteredSky}) var filteredSkyOut:texture_storage_2d<${T.filteredSky},write>;
${wgslConsts({
  CACHE_TILE_SIDE,
  CACHE_NEIGHBOURS: NEIGHBOURS,
  CACHE_FLAG_SKY: RADIANCE_CACHE_FLAGS.sky,
})}
var<workgroup> neighbourSlot:array<u32,CACHE_NEIGHBOURS>;
var<workgroup> neighbourPosition:array<vec3f,CACHE_NEIGHBOURS>;
fn cacheAxis(n:u32)->vec3i{
 var axis=vec3i(0);
 axis[n>>1u]=select(-1,1,(n&1u)==1u);
 return axis;
}
/** The word of the raw texel \`texel\` of the map at \`base\`. */
fn cacheRawAt(base:vec2u,texel:vec2u)->vec2u{return textureLoad(cacheRaw,vec2i(base+texel),0).rg;}
/** The texel of a map of the direction \`d\`. */
fn cacheTexelOf(d:vec3f,res:u32)->vec2u{return min(vec2u(equalAreaEncode(d)*f32(res)),vec2u(res-1u));}
/** The neighbour \`n\` of the probe, if \`level\` holds its cell and a probe holds it in the table, which a probe enters once traced: a cell
 *  given a probe the frame's queue could not hold is none, as its map holds the light the slot's last probe traced at another place. */
fn cacheNeighbour(n:u32,cell:vec3i,level:u32,spacing:f32){
 let next=cell+cacheAxis(n);
 neighbourSlot[n]=select(0u,cacheSlotOf(level,next),levelHolds(level,next));
 neighbourPosition[n]=probePosition(next,spacing);
}
/** The weight of neighbour \`n\` for the texel \`texel\`: its angle's, zero where its ray met the back of a one-sided surface or a surface
 *  stands between the probes. */
fn cacheNeighbourWeight(n:u32,own:vec2u,centre:vec3f,texel:vec2u,res:u32,ownBase:vec2u,begin:f32)->f32{
 let d=equalAreaDecode((vec2f(texel)+vec2f(0.5))/f32(res));
 let there=neighbourPosition[n];
 let base=cacheTileOf(neighbourSlot[n]-1u,res);
 let offset=2.0*begin;
 let toThere=there+d*offset-centre;
 let toHere=centre+d*offset-there;
 let seenFromHere=cacheDepthOf(cacheRawAt(ownBase,cacheTexelOf(toThere,res)).g);
 let seenFromThere=cacheDepthOf(cacheRawAt(base,cacheTexelOf(toHere,res)).g);
 let word=cacheRawAt(base,texel).g;
 if(!(cacheFrontIs(word)||cacheTwoSidedIs(word))){return 0.0;}
 if(seenFromHere*seenFromHere<dot(toThere,toThere)||seenFromThere*seenFromThere<dot(toHere,toHere)){return 0.0;}
 var distance=cacheDepthOf(word);
 if(cacheHitIs(word)){distance=min(distance,cacheDepthOf(own.y));}
 let toHit=there+d*distance-centre;
 let angle=fastAcos(dot(toHit,d)/length(toHit));
 return 1.0-saturate(angle/cache.filterAngle);
}
@compute @workgroup_size(CACHE_TILE_SIDE,CACHE_TILE_SIDE)
fn filterMaps(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let entry=group.x;
 if(entry>=bounce.frame.y||bounce.counts.w==0u){return;}
 let queued=queuedProbe(entry);
 if(!queued.valid){return;}
 let spacing=bounce.levels[queued.level].spacing;
 if(lane<CACHE_NEIGHBOURS){cacheNeighbour(lane,queued.cell,queued.level,spacing);}
 workgroupBarrier();
 let res=cache.resolution;
 let begin=cacheMinTrace(queued.level);
 let centre=probePosition(queued.cell,spacing);
 let ownBase=cacheTileOf(queued.slot,res);
 let outBase=cacheTempTileOf(entry,res,cache.tempRow);
 for(var t=lane;t<res*res;t+=CACHE_TILE_SIDE*CACHE_TILE_SIDE){
  let texel=vec2u(t%res,t/res);
  let own=cacheRawAt(ownBase,texel);
  var light=unpackLight(own.x);
  var sky=cacheSkyOf(own.y);
  var total=1.0;
  for(var n=0u;n<CACHE_NEIGHBOURS;n++){
   if(neighbourSlot[n]==0u){continue;}
   let weight=cacheNeighbourWeight(n,own,centre,texel,res,ownBase,begin);
   let there=cacheRawAt(cacheTileOf(neighbourSlot[n]-1u,res),texel);
   light+=unpackLight(there.x)*weight;
   sky+=cacheSkyOf(there.y)*weight;
   total+=weight;
  }
  let noise=blueNoiseScalar(ownBase+texel,bounce.frame.z%8u);
  textureStore(filteredOut,vec2i(outBase+texel),vec4u(packLight(ditherLight(light/total,noise)),0u,0u,0u));
  if((cache.flags&CACHE_FLAG_SKY)!=0u){textureStore(filteredSkyOut,vec2i(outBase+texel),vec4f(sky/total,0.0,0.0,0.0));}
 }
}`,
  [
    bounceBindingsWgsl(0, B.grid, B.table),
    QUEUED_PROBE_WGSL,
    CACHE_WORDS_WGSL,
    blueNoiseWgsl(0, B.noise),
    packLight,
    unpackLight,
    ditherLight,
    fastAcos,
  ],
)
