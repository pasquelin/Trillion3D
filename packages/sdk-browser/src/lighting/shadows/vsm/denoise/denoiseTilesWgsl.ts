/**
 * THE PENUMBRA TILE LIST of the shadow mask denoise (`denoiseTilesPass` in `denoisePass.ts`): which tiles of 8 x 8
 * pixels the filter (`denoiseWgsl.ts`) has to run over. The filter leaves a pixel as it is where its probe finds the
 * mask wholly 0 or wholly 1 (a lane of a packed texel: 0 or 15), and the passes' probes chain: a pixel is left alone
 * by every pass only when the mask is uniform within the sum of their probes' reaches (2 + 4 + .. + 2^n pixels for
 * n passes, 6 for the default 2). Three dispatches find the others:
 *   1. `vsmDenoiseTiles`: a group a tile reads its pixels (every layer of a suns' array) and writes two words, the
 *      bit of each layer (or lane) that holds a value above 0 (`nz`) and the bit of each that holds a value below 1
 *      (`nl`);
 *   2. `vsmDenoiseMark`: a thread a tile ORs the words of the tiles within `dn.phase.w` tiles of it (the reach, rounded
 *      up to whole tiles) and marks the tile when some layer has both bits (a value above 0 and one below 1 in the
 *      reach: a penumbra, or a hard edge between 0 and 1): it sets the tile's flag and appends it to the list;
 *   3. `vsmDenoiseArgs`: a thread writes the count in the list's first word, the indirect dispatch arguments of the
 *      filter (a row of `DENOISE_LIST_ROW` groups at most, the layers in z) and zeroes the counter for the next use.
 * The sky and the pixels past the rect are not read; the marks are a superset of the pixels the filter changes.
 */
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { ONE_PASS_MASK_WGSL } from '../projection/maskFormat.ts'
import {
  DENOISE_GROUP,
  DENOISE_LIST_ROW,
  DENOISE_PARAMS_WGSL,
  PACKED_WORDS,
  TILE_BINDING,
  type DenoiseKind,
} from './denoiseWgsl.ts'

/** The tiles a filter of `iterations` passes (n) has to reach: the sum of the probes of its passes, 2 + 4 + .. + 2^n pixels, in tiles of `DENOISE_GROUP`. */
export const denoiseTileReach = (iterations: number) =>
  iterations <= 0 ? 0 : Math.ceil((2 * (2 ** iterations - 1)) / DENOISE_GROUP)

/** The stats of a tile are two words: the bits of what is above 0 and of what is below 1. */
export const TILE_STAT_WORDS = 2

/** The kernel that marks and counts, shared by the kinds: it reads the stats, not the mask. */
export const DENOISE_MARK_WGSL = wgslBlock(
  'DENOISE_MARK_WGSL',
  [DENOISE_PARAMS_WGSL],
  /* wgsl */ `
@group(0) @binding(${TILE_BINDING.stats}) var<storage,read> dnStats:array<vec2u>;
@group(0) @binding(${TILE_BINDING.flags}) var<storage,read_write> dnFlags:array<u32>;
@group(0) @binding(${TILE_BINDING.list}) var<storage,read_write> dnList:array<u32>;
@group(0) @binding(${TILE_BINDING.args}) var<storage,read_write> dnArgs:array<u32>;
@group(0) @binding(${TILE_BINDING.counter}) var<storage,read_write> dnCounter:atomic<u32>;
fn dnTilesY()->i32{return (dn.rect.w-dn.rect.y+DN_TILE-1)/DN_TILE;}
/** Whether the tile t is to be filtered: some layer (lane) holds a value above 0 and a value below 1 within d tiles of it. */
fn dnWindowMarked(t:vec2i,d:i32)->bool{
 let last=vec2i(dnTilesX()-1,dnTilesY()-1);
 var nz=0u;var nl=0u;
 for(var j=-d;j<=d;j++){
  for(var i=-d;i<=d;i++){
   let q=clamp(t+vec2i(i,j),vec2i(0),last);
   let s=dnStats[u32(q.y*dnTilesX()+q.x)];
   nz=nz|s.x;nl=nl|s.y;
  }
 }
 return (nz&nl)!=0u;
}
@compute @workgroup_size(${DENOISE_GROUP},${DENOISE_GROUP},1)
fn vsmDenoiseMark(@builtin(global_invocation_id) gid:vec3u){
 let t=vec2i(gid.xy);
 if(t.x>=dnTilesX()||t.y>=dnTilesY()){return;}
 let index=u32(t.y*dnTilesX()+t.x);
 let marked=dnWindowMarked(t,i32(dn.phase.w));
 dnFlags[index]=select(0u,1u,marked);
 if(marked){
  let slot=atomicAdd(&dnCounter,1u);
  dnList[1u+slot]=index;
 }
}
@compute @workgroup_size(1)
fn vsmDenoiseArgs(){
 let count=atomicLoad(&dnCounter);
 atomicStore(&dnCounter,0u);
 dnList[0]=count;
 dnArgs[0]=min(count,DN_LIST_ROW);
 dnArgs[1]=max(1u,(count+DN_LIST_ROW-1u)/DN_LIST_ROW);
 dnArgs[2]=u32(dn.extra.x);
}
`,
)

/** The bits one texel adds to its tile's stats, and the kernel that reduces them, for the mask `kind`. */
const statsKernel = (kind: DenoiseKind) => {
  const head = /* wgsl */ `
@group(0) @binding(${TILE_BINDING.stats}) var<storage,read_write> dnStats:array<vec2u>;
var<workgroup> wgNz:atomic<u32>;
var<workgroup> wgNl:atomic<u32>;
`
  const bits =
    kind === 'sun'
      ? /* wgsl */ `
@group(0) @binding(${TILE_BINDING.source}) var dnSrc:texture_2d_array<f32>;
/** The bits of the texel p: a bit a layer, set in the first word for a value above 0, in the second for one below 1. */
fn dnBits(p:vec2i)->vec2u{
 var nz=0u;var nl=0u;
 for(var l=0;l<dn.extra.x;l++){
  let v=textureLoad(dnSrc,p,l,0).r;
  let bit=1u<<(u32(l)&31u);
  if(v>0.0){nz=nz|bit;}
  if(v<1.0){nl=nl|bit;}
 }
 return vec2u(nz,nl);
}`
      : kind === 'light'
        ? /* wgsl */ `
@group(0) @binding(${TILE_BINDING.source}) var dnSrc:texture_2d<f32>;
/** The bits of the texel p: one, for the channel the lighting reads. */
fn dnBits(p:vec2i)->vec2u{
 let v=textureLoad(dnSrc,p,0).b;
 return vec2u(select(0u,1u,v>0.0),select(0u,1u,v<1.0));
}`
        : /* wgsl */ `
@group(0) @binding(${TILE_BINDING.source}) var dnSrc:texture_2d<u32>;
/** The bits of the texel p: a bit a lane, set in the first word for a share above 0, in the second for one below 15. */
fn dnBits(p:vec2i)->vec2u{
 let w=textureLoad(dnSrc,p,0);
 var nz=0u;var nl=0u;
 for(var k=0u;k<${PACKED_WORDS[kind as keyof typeof PACKED_WORDS]}u;k++){
  for(var l=0u;l<ONE_PASS_MASK_LANES;l++){
   let share=(w[k]>>(l*ONE_PASS_MASK_BITS))&ONE_PASS_MASK_MAX;
   let bit=1u<<(k*ONE_PASS_MASK_LANES+l);
   if(share!=0u){nz=nz|bit;}
   if(share!=ONE_PASS_MASK_MAX){nl=nl|bit;}
  }
 }
 return vec2u(nz,nl);
}`
  return /* wgsl */ `${head}${bits}
@compute @workgroup_size(${DENOISE_GROUP},${DENOISE_GROUP},1)
fn vsmDenoiseTiles(@builtin(workgroup_id) wid:vec3u,@builtin(local_invocation_id) lid:vec3u){
 let p=dn.rect.xy+vec2i(wid.xy)*DN_TILE+vec2i(lid.xy);
 if(dnInRect(p)){
  let b=dnBits(p);
  atomicOr(&wgNz,b.x);
  atomicOr(&wgNl,b.y);
 }
 workgroupBarrier();
 if(lid.x==0u&&lid.y==0u){
  dnStats[wid.y*u32(dnTilesX())+wid.x]=vec2u(atomicLoad(&wgNz),atomicLoad(&wgNl));
 }
}
`
}

/** The program that reduces the mask `kind` to the stats of its tiles. */
export function vsmDenoiseTilesWgsl(kind: DenoiseKind) {
  return wgslProgram(statsKernel(kind), [
    DENOISE_PARAMS_WGSL,
    ...(kind === 'sun' || kind === 'light' ? [] : [ONE_PASS_MASK_WGSL]),
  ])
}

/** The program that marks the tiles, lists them and writes the indirect arguments. */
export const vsmDenoiseMarkWgsl = () => wgslProgram('', [DENOISE_MARK_WGSL])
