import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { HIDDEN_HASH_WORDS, SAMPLED_GROUP, VISIBLE_HASH_WORDS } from './layout.ts'
import {
  hashLightIndex,
  lightSampleIndex,
  lightSampleVisible,
  lightSampleWeight,
  NO_LIGHT_INDEX,
} from './lightSamplerWgsl.ts'
import { SAMPLED_PARAMS_WGSL } from './paramsWgsl.ts'
import { SAMPLED_TILE_SIZE } from './parameters.ts'

const B = SAMPLED_BINDINGS

/**
 * THE LIGHTS EACH TILE SAW: one group a tile of eight pixels across of the view, which reads the samples of the pixels the tile covers and
 * sets, in the tile's visible set (four words), the two bits the hash of each light whose sample was visible names, and, in its hidden set
 * (two words), the two bits of each whose sample was not. The next image draws its lights by them (`isLightVisible`, `isLightHidden`): a light
 * hidden last image is drawn less (`sampledLightsHiddenWeight`). The threads' sets are joined in the group by atomics on the group's words.
 * Every tile is written, the empty ones with empty sets.
 */
export const HASH_ENTRY = 'visibleHashMain'
export const hashWgsl = () =>
  wgslProgram(
    `
@group(0) @binding(${B.samples}) var samples:texture_2d<u32>;
@group(0) @binding(${B.guideCurrent}) var<storage,read_write> guide:array<atomic<u32>>;
var<workgroup> visibleSet:array<atomic<u32>,${VISIBLE_HASH_WORDS}>;
var<workgroup> hiddenSet:array<atomic<u32>,${HIDDEN_HASH_WORDS}>;
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${HASH_ENTRY}(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_id) lane:vec3u,@builtin(local_invocation_index) linear:u32){
 if(linear<${VISIBLE_HASH_WORDS}u){atomicStore(&visibleSet[linear],0u);}
 if(linear<${HIDDEN_HASH_WORDS}u){atomicStore(&hiddenSet[linear],0u);}
 workgroupBarrier();
 let tileSize=(vec2u(${SAMPLED_TILE_SIZE}u)/params.factor)*params.samples;
 let first=block.xy*tileSize;
 let last=min(first+tileSize,params.sampleView);
 let perThread=(tileSize+vec2u(${SAMPLED_GROUP}u-1u))/vec2u(${SAMPLED_GROUP}u);
 for(var y=0u;y<perThread.y;y++){
  for(var x=0u;x<perThread.x;x++){
   let coord=first+lane.xy*perThread+vec2u(x,y);
   if(all(coord<last)){
    let word=textureLoad(samples,vec2i(coord),0).r;
    if(lightSampleIndex(word)!=${NO_LIGHT_INDEX}u&&lightSampleWeight(word)>0.0){
     let h=hashLightIndex(lightSampleIndex(word));
     if(lightSampleVisible(word)){
      atomicOr(&visibleSet[h&3u],1u<<((h>>4u)&31u));
      atomicOr(&visibleSet[(h>>2u)&3u],1u<<((h>>9u)&31u));
     }else{
      atomicOr(&hiddenSet[h&1u],1u<<((h>>2u)&31u));
      atomicOr(&hiddenSet[(h>>1u)&1u],1u<<((h>>7u)&31u));
     }
    }
   }
  }
 }
 workgroupBarrier();
 let tile=block.y*params.viewTiles.x+block.x;
 if(linear<${VISIBLE_HASH_WORDS}u){atomicStore(&guide[tile*${VISIBLE_HASH_WORDS}u+linear],atomicLoad(&visibleSet[linear]));}
 if(linear<${HIDDEN_HASH_WORDS}u){atomicStore(&guide[params.hiddenAt+tile*${HIDDEN_HASH_WORDS}u+linear],atomicLoad(&hiddenSet[linear]));}
}`,
    [SAMPLED_PARAMS_WGSL, hashLightIndex, lightSampleIndex, lightSampleVisible, lightSampleWeight],
  )
