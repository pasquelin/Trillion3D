import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spProbeWord, spSurface, spWeights } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'
import { spVectors } from './vectorsWgsl.ts'

/** The placement group's bindings: the image's normals and flags beside its depth (the reflection group's),
 *  the probes' records, the pixel of every probe, the mask of the samples that need an adaptive probe, the
 *  count of adaptive probes placed, each tile's own count and list, the surfaces' vectors, the indirect arguments
 *  the kernels over the probes in use are dispatched by. */
export const PLACE_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  normals: [1, 'float'],
  flags: [2, 'uint'],
  info: [3, { store: F.info }],
  normal: [4, { store: F.normal }],
  pixels: [5, 'buffer'],
  mask: [6, 'buffer'],
  counts: [7, 'buffer'],
  header: [8, 'buffer'],
  indices: [9, 'buffer'],
  vectors: [10, 'uint'],
  args: [11, 'buffer'],
})

const B = PLACE_BINDINGS.at

/** The bindings the placement writes, and the writing of a probe: the surface at a pixel, the speed it moves at. */
const PLACE_DECLARATIONS = wgslBlock(
  'PLACE_DECLARATIONS',
  [spProbeWord],
  `@group(0) @binding(${B.info}) var info:texture_storage_2d<${F.info},write>;
@group(0) @binding(${B.normal}) var normal:texture_storage_2d<${F.normal},write>;
@group(0) @binding(${B.pixels}) var<storage,read_write> pixels:array<u32>;
@group(0) @binding(${B.mask}) var<storage,read_write> mask:array<atomic<u32>>;
@group(0) @binding(${B.counts}) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(${B.header}) var<storage,read_write> header:array<atomic<u32>>;
@group(0) @binding(${B.indices}) var<storage,read_write> indices:array<u32>;
@group(0) @binding(${B.args}) var<storage,read_write> args:array<u32>;
/** The record of the uniform probe of \`tile\`: its surface at its pixel. */
fn spCornerProbe(tile:vec2u)->SpProbe{
 let s=spSurfaceAt(spUniformPixel(tile,sp.mode.x));
 return SpProbe(s.P,select(-1.0,spDepthOf(s.P),s.lit),s.N,0.0,s.foliage,s.hair);
}
/** Writes the probe \`index\` of the atlas: the surface at \`pix\`, the speed it moves at and its kind. */
fn spWriteProbe(index:u32,pix:vec2u){
 let s=spSurfaceAt(pix);
 let at=vec2i(spAtlasOf(index));
 textureStore(info,at,vec4f(s.P,select(-1.0,spDepthOf(s.P),s.lit)));
 textureStore(normal,at,vec4u(spProbeWord(s.N,select(0.0,spMotionOf(vec2i(pix),s.P,vec2f(0.0)).speed,s.lit),s.foliage,s.hair),0u,0u,0u));
 pixels[index]=pix.x|(pix.y<<16u);
}`,
)

/**
 * THE UNIFORM PROBES: every tile of the image takes a probe on a pixel of its own that turns every frame
 * (`placeUniform`): its surface — the world point, the normal, the depth — written in the atlas; the same thread
 * empties its tile's mask and count, and the first the count of adaptive probes, which the next steps fill. `probeArgs`,
 * once the adaptive probes are placed, writes the arguments the kernels over the probes in use are dispatched by: the
 * atlas's rows that hold one, and the trace texels over them in groups of 8 × 8.
 */
const PLACE_UNIFORM = wgslBlock(
  'PLACE_UNIFORM',
  [PLACE_DECLARATIONS],
  `@compute @workgroup_size(8,8)
fn placeUniform(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=sp.grid.xy)){return;}
 let tile=id.y*sp.grid.x+id.x;
 atomicStore(&mask[tile],0u);
 atomicStore(&header[tile],0u);
 if(all(id.xy==vec2u(0u))){atomicStore(&counts[0],0u);}
 spWriteProbe(spIndexOf(id.xy),spUniformPixel(id.xy,sp.mode.x));
}
@compute @workgroup_size(1)
fn probeArgs(){
 let placed=min(atomicLoad(&counts[0]),sp.grid.w);
 let rows=min(sp.grid.z,(sp.counts.y+placed+sp.grid.x-1u)/sp.grid.x);
 args[0]=sp.grid.x;
 args[1]=rows;
 args[2]=1u;
 args[3]=(sp.grid.x*sp.counts.w+7u)/8u;
 args[4]=(rows*sp.counts.w+7u)/8u;
 args[5]=1u;
}`,
)

/**
 * THE ADAPTIVE PROBES, in two steps over the tiles whose uniform probes do not cover a surface: `adaptiveMark` takes,
 * for each tile, `SP_SAMPLES` pixels of it and marks, in a word of the tile's, those whose four uniform probes weigh under
 * the minimum (`spInterpolation`: the surface at a plane the probes' planes are not), and `adaptiveSpawn` keeps each marked
 * sample unless a sample of a lower rank, in its own tile or its neighbours', already covers it (`spAdaptiveWeight`),
 * numbering the survivors in the atlas after the uniform probes and listing them in their tile, up to the most the atlas
 * holds. A uniform probe is the surface at its pixel: its record is the same whether it is written or read again here
 * (`spCornerProbe`), so the weights need no read of the atlas.
 */
const PLACE_ADAPTIVE = wgslBlock(
  'PLACE_ADAPTIVE',
  [PLACE_DECLARATIONS],
  `/** A thread a sample of a tile: its tile, its rank among the tile's samples. */
struct SpSample{tile:vec2u,rank:u32,valid:bool,}
fn spSampleOf(id:vec2u)->SpSample{
 let tile=id/vec2u(SP_SAMPLES_X,SP_SAMPLES_Y);
 let sub=id%vec2u(SP_SAMPLES_X,SP_SAMPLES_Y);
 return SpSample(tile,sub.x+SP_SAMPLES_X*sub.y,all(tile<sp.grid.xy));
}
@compute @workgroup_size(8,8)
fn adaptiveMark(@builtin(global_invocation_id) id:vec3u){
 let at=spSampleOf(id.xy);
 if(!at.valid){return;}
 let pix=spAdaptivePixel(at.tile,at.rank);
 if(any(pix>=sp.size.xy)){return;}
 let s=spSurfaceAt(pix);
 if(!s.lit){return;}
 let covered=spInterpolation(pix,vec2f(0.0),s.P,s.N,spDepthOf(s.P),s.foliage);
 if(dot(covered.w,vec4f(1.0))<SP_MIN_WEIGHT){atomicOr(&mask[at.tile.y*sp.grid.x+at.tile.x],1u<<at.rank);}
}
/** Whether the sample \`pix\` of rank \`rank\` is covered by a marked sample of a lower rank round it. */
fn spCovered(pix:vec2u,rank:u32,s:SpSurface,depth:f32)->bool{
 let full=clamp(vec2f(pix)-vec2f(spTileJitter(sp.mode.x)),vec2f(0.0),vec2f(sp.size.xy)-vec2f(1.0));
 let first=min(vec2u(full/f32(sp.size.z)),max(sp.grid.xy,vec2u(2u))-vec2u(2u));
 var covered=vec4f(0.0);
 for(var corner=0u;corner<4u;corner++){
  let cornerTile=min(first+vec2u(corner%2u,corner/2u),sp.grid.xy-vec2u(1u));
  var bits=atomicLoad(&mask[cornerTile.y*sp.grid.x+cornerTile.x]);
  while(bits!=0u){
   let k=firstTrailingBit(bits);
   bits^=1u<<k;
   if(k>=rank){break;}
   let other=spAdaptivePixel(cornerTile,k);
   let weight=spAdaptiveWeight(pix,s.P,s.N,depth,s.foliage,other,spSurfaceAt(other).P);
   covered[corner]=max(covered[corner],weight.x);
   if(covered.x+covered.y+covered.z+covered.w>=SP_MIN_WEIGHT){return true;}
  }
 }
 return false;
}
@compute @workgroup_size(8,8)
fn adaptiveSpawn(@builtin(global_invocation_id) id:vec3u){
 let at=spSampleOf(id.xy);
 if(!at.valid){return;}
 let tileIndex=at.tile.y*sp.grid.x+at.tile.x;
 if((atomicLoad(&mask[tileIndex])&(1u<<at.rank))==0u){return;}
 let pix=spAdaptivePixel(at.tile,at.rank);
 let s=spSurfaceAt(pix);
 if(spCovered(pix,at.rank,s,spDepthOf(s.P))){return;}
 let adaptive=atomicAdd(&counts[0],1u);
 if(adaptive>=sp.grid.w){return;}
 let slot=atomicAdd(&header[tileIndex],1u);
 if(slot<SP_SAMPLES){indices[tileIndex*SP_SAMPLES+slot]=adaptive;}
 spWriteProbe(sp.counts.y+adaptive,pix);
}`,
)

/** The placement's program over `samples` of a tile: the uniform probes and their arguments, the adaptive ones. */
export const placeShader = (samples: readonly [number, number]) =>
  wgslProgram(spParams(B.params), [
    spCommon(samples),
    spWeights,
    spSurface(B.normals, B.flags),
    spVectors(B.vectors),
    PLACE_UNIFORM,
    PLACE_ADAPTIVE,
  ])
