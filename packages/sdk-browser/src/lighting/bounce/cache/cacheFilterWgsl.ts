import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { QUEUED_PROBE_WGSL } from '../probes/probeQueueWgsl.ts'
import { CACHE_FILTER_BINDINGS as B } from './cacheBindings.ts'
import {
  CACHE_TILE_SIDE,
  RADIANCE_CACHE_FLAGS,
  RADIANCE_CACHE_FORMATS as F,
  RADIANCE_CACHE_PARAMS,
} from './cacheLayout.ts'
import { CACHE_WORDS_WGSL, cacheTagsWgsl } from './cacheWordsWgsl.ts'

/** The six cells beside a probe, each along an axis, and the threads of a workgroup. */
const NEIGHBOURS = 6

/**
 * THE FILTER OF THE MAPS: the radiance of every texel of a probe's map traced this frame (`cacheEntries`), averaged with the same
 * texel of its six neighbours' (the cells beside its own on each axis, one level), as a workgroup a probe. A neighbour's texel
 * weighs `1 − angle / filterAngle`, the angle the neighbour's ray in that direction, taken from the neighbour, makes with the probe's
 * own ray as it is seen from the probe — the neighbour's distance held to the probe's where it met a surface, so that a contact
 * keeps its shadow —, and nothing where a surface stands between the two: the ray of each probe, started twice the nearest a ray
 * starts at past the other, ends before it reaches the other's point (the distance the other's map holds in that direction). The
 * result is the final atlas's texel, and the probe's tag — the cell and level the map was made for — is written last. Without the
 * filter the final map is the raw one. The share of a ray that left the scene (`cacheSkyOf`), where the sky is kept apart, is filtered by the
 * same weights into the sky's atlas.
 */
export const CACHE_FILTER_PROGRAM = wgslProgram(
  `${RADIANCE_CACHE_PARAMS.wgsl}
@group(0) @binding(${B.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${B.params}) var<uniform> cache:RadianceCacheParams;
@group(0) @binding(${B.entries}) var<storage,read> cacheEntries:array<u32>;
@group(0) @binding(${B.raw}) var cacheRaw:texture_2d<u32>;
@group(0) @binding(${B.final}) var finalOut:texture_storage_2d<${F.final},write>;
@group(0) @binding(${B.sky}) var skyOut:texture_storage_2d<${F.sky},write>;
${wgslConsts({
  CACHE_TILE_SIDE,
  CACHE_NEIGHBOURS: NEIGHBOURS,
  CACHE_FLAG_FILTER: RADIANCE_CACHE_FLAGS.filter,
  CACHE_FLAG_SKY: RADIANCE_CACHE_FLAGS.sky,
})}
var<workgroup> neighbourSlot:array<u32,CACHE_NEIGHBOURS>;
var<workgroup> neighbourCentre:array<vec3f,CACHE_NEIGHBOURS>;
fn cacheAxis(n:u32)->vec3i{
 var axis=vec3i(0);
 axis[n>>1u]=select(-1,1,(n&1u)==1u);
 return axis;
}
/** The word of the raw texel \`texel\` of the map at \`base\`. */
fn cacheRawAt(base:vec2u,texel:vec2u)->vec2u{return textureLoad(cacheRaw,vec2i(base+texel),0).rg;}
/** The texel of a map of the direction \`d\`. */
fn cacheTexelOf(d:vec3f,res:u32)->vec2u{return min(vec2u(equalAreaEncode(d)*f32(res)),vec2u(res-1u));}
/** The neighbour \`n\` of the probe, if its map holds a cell and a level of the probe's own level and its flag says it was made. */
fn cacheNeighbour(n:u32,cell:vec3i,level:u32,spacing:f32){
 let next=cell+cacheAxis(n);
 let slot=cacheSlotOf(level,next);
 neighbourSlot[n]=select(0u,slot,slot!=0u&&cacheTagOk(slot,next,level));
 neighbourCentre[n]=probeCentre(next,spacing);
}
/** The weight of neighbour \`n\` for the texel \`texel\`: its angle's, zero where a surface stands between the probes. */
fn cacheNeighbourWeight(n:u32,own:vec2u,centre:vec3f,texel:vec2u,res:u32,ownBase:vec2u,begin:f32)->f32{
 let d=equalAreaDecode((vec2f(texel)+vec2f(0.5))/f32(res));
 let there=neighbourCentre[n];
 let base=cacheTileOf(neighbourSlot[n]-1u,res);
 let offset=2.0*begin;
 let toThere=there+d*offset-centre;
 let toHere=centre+d*offset-there;
 let seenFromHere=cacheDepthOf(cacheRawAt(ownBase,cacheTexelOf(toThere,res)).g);
 let seenFromThere=cacheDepthOf(cacheRawAt(base,cacheTexelOf(toHere,res)).g);
 if(seenFromHere*seenFromHere<dot(toThere,toThere)||seenFromThere*seenFromThere<dot(toHere,toHere)){return 0.0;}
 let word=cacheRawAt(base,texel).g;
 var distance=cacheDepthOf(word);
 if(cacheHitIs(word)){distance=min(distance,cacheDepthOf(own.y));}
 let toHit=there+d*distance-centre;
 let angle=acos(clamp(dot(toHit,d)/max(length(toHit),1e-6),-1.0,1.0));
 return 1.0-saturate(angle/cache.distances.w);
}
@compute @workgroup_size(CACHE_TILE_SIDE,CACHE_TILE_SIDE)
fn filterMaps(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let entry=group.x;
 if(entry>=bounce.frame.y||bounce.counts.w==0u||cacheEntries[entry]==0u){return;}
 let queued=queuedProbe(entry);
 if(!queued.valid){return;}
 let spacing=bounce.levels[queued.level].spacing;
 if(lane<CACHE_NEIGHBOURS){cacheNeighbour(lane,queued.cell,queued.level,spacing);}
 workgroupBarrier();
 let res=cache.size.x;
 let begin=cacheMinTrace(queued.level);
 let centre=probeCentre(queued.cell,spacing);
 let ownBase=cacheTileOf(queued.slot,res);
 let filtered=(cache.size.y&CACHE_FLAG_FILTER)!=0u;
 for(var t=lane;t<res*res;t+=CACHE_TILE_SIDE*CACHE_TILE_SIDE){
  let texel=vec2u(t%res,t/res);
  let own=cacheRawAt(ownBase,texel);
  var light=unpackLight(own.x);
  var sky=cacheSkyOf(own.y);
  var total=1.0;
  if(filtered){
   for(var n=0u;n<CACHE_NEIGHBOURS;n++){
    if(neighbourSlot[n]==0u){continue;}
    let weight=cacheNeighbourWeight(n,own,centre,texel,res,ownBase,begin);
    let there=cacheRawAt(cacheTileOf(neighbourSlot[n]-1u,res),texel);
    light+=unpackLight(there.x)*weight;
    sky+=cacheSkyOf(there.y)*weight;
    total+=weight;
   }
  }
  textureStore(finalOut,vec2i(ownBase+texel),vec4u(packLight(light/total),0u,0u,0u));
  if((cache.size.y&CACHE_FLAG_SKY)!=0u){textureStore(skyOut,vec2i(ownBase+texel),vec4f(sky/total,0.0,0.0,0.0));}
 }
 if(lane==0u){
  let at=queued.slot*CACHE_TAG_WORDS;
  let tagged=bitcast<vec3u>(queued.cell);
  cacheTags[at]=tagged.x;
  cacheTags[at+1u]=tagged.y;
  cacheTags[at+2u]=tagged.z;
  cacheTags[at+3u]=queued.level+1u;
 }
}`,
  [
    bounceBindingsWgsl(0, B.grid, B.probes),
    QUEUED_PROBE_WGSL,
    CACHE_WORDS_WGSL,
    cacheTagsWgsl(B.tags, true),
    packLight,
    unpackLight,
  ],
)
