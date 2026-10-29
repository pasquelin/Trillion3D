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
import { SAMPLED_TILE_SIZE, type SampledLightsSettings } from './parameters.ts'

const B = SAMPLED_BINDINGS

/**
 * THE LIGHTS EACH TILE SAW: one group a tile of eight pixels across of the view, which reads the samples of the pixels the tile covers and
 * sets, in the tile's visible set (four words), the two bits the hash of each light whose sample was visible names, and, in its hidden set
 * (two words), the two bits of each whose sample was not. The next image draws its lights by them (`isLightVisible`, `isLightHidden`): a light
 * hidden last image is drawn less (`sampledLightsHiddenWeight`). The threads' sets are joined in the group by atomics on the group's words.
 * Every tile is written, the empty ones with empty sets. The sets go to the raw hash, which `filterHashWgsl` joins across the tiles.
 */
export const HASH_ENTRY = 'visibleHashMain'
export const hashWgsl = () =>
  wgslProgram(
    `
@group(0) @binding(${B.samples}) var samples:texture_2d<u32>;
@group(0) @binding(${B.hashRaw}) var<storage,read_write> raw:array<atomic<u32>>;
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
 if(linear<${VISIBLE_HASH_WORDS}u){atomicStore(&raw[tile*${VISIBLE_HASH_WORDS}u+linear],atomicLoad(&visibleSet[linear]));}
 if(linear<${HIDDEN_HASH_WORDS}u){atomicStore(&raw[params.hiddenAt+tile*${HIDDEN_HASH_WORDS}u+linear],atomicLoad(&hiddenSet[linear]));}
}`,
    [SAMPLED_PARAMS_WGSL, hashLightIndex, lightSampleIndex, lightSampleVisible, lightSampleWeight],
  )

/**
 * THE SETS OF EACH TILE JOINED WITH ITS NEIGHBOURS': one thread a tile of the view, which ORs its visible and hidden sets with those of the tiles
 * to its left, right, above and below (the view's edge bounds them) and writes the result in the guide the next image draws by. It runs only
 * where `hashFilterOn` says so; otherwise the hash pass writes the guide itself.
 */
/** Whether the tiles' hashes are joined with their neighbours' before they guide the next image (the guide by history and its filter both on). */
export const hashFilterOn = (settings: SampledLightsSettings) =>
  settings.sampledLightsGuideByHistory && settings.sampledLightsGuideByHistoryFilter

export const FILTER_HASH_ENTRY = 'filterHashMain'
export const filterHashWgsl = () =>
  wgslProgram(
    `
@group(0) @binding(${B.hashRaw}) var<storage,read> raw:array<u32>;
@group(0) @binding(${B.guideCurrent}) var<storage,read_write> guide:array<u32>;
fn joinTile(tile:vec2i,sets:ptr<function,array<u32,${VISIBLE_HASH_WORDS + HIDDEN_HASH_WORDS}>>){
 if(any(tile<vec2i(0))||any(tile>=vec2i(params.viewTiles))){return;}
 let at=u32(tile.y)*params.viewTiles.x+u32(tile.x);
 for(var i=0u;i<${VISIBLE_HASH_WORDS}u;i++){(*sets)[i]|=raw[at*${VISIBLE_HASH_WORDS}u+i];}
 for(var i=0u;i<${HIDDEN_HASH_WORDS}u;i++){(*sets)[${VISIBLE_HASH_WORDS}u+i]|=raw[params.hiddenAt+at*${HIDDEN_HASH_WORDS}u+i];}
}
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${FILTER_HASH_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=params.viewTiles)){return;}
 let tile=vec2i(id.xy);
 var sets:array<u32,${VISIBLE_HASH_WORDS + HIDDEN_HASH_WORDS}>;
 joinTile(tile,&sets);
 joinTile(tile+vec2i(1,0),&sets);
 joinTile(tile-vec2i(1,0),&sets);
 joinTile(tile+vec2i(0,1),&sets);
 joinTile(tile-vec2i(0,1),&sets);
 let at=id.y*params.viewTiles.x+id.x;
 for(var i=0u;i<${VISIBLE_HASH_WORDS}u;i++){guide[at*${VISIBLE_HASH_WORDS}u+i]=sets[i];}
 for(var i=0u;i<${HIDDEN_HASH_WORDS}u;i++){guide[params.hiddenAt+at*${HIDDEN_HASH_WORDS}u+i]=sets[${VISIBLE_HASH_WORDS}u+i];}
}`,
    [SAMPLED_PARAMS_WGSL],
  )
