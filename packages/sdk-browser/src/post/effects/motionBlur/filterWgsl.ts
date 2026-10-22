import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { MINIMAL_PIXEL_VELOCITY } from './classifyWgsl.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import { FILTER_TILE, FLATTEN_TILE, OUTPUT_FORMAT } from './motionBlurLayout.ts'
import { FLAT_PACK_WGSL, MOTION_BLUR_PARAMS_WGSL } from './motionBlurWgsl.ts'

/** The filter's bindings: the blur's uniform, the image to blur and its sampler, the flattened
 *  motion, the tile ranges, the list of the filter tiles of the class, the blurred image written. */
export const FILTER_BINDINGS = {
  params: 0,
  color: 1,
  sampler: 2,
  flat: 3,
  tiles: 4,
  list: 5,
  blurred: 6,
} as const

/** The scene depth, in centimetres, the unit the flattened depth is kept in, two samples must
 *  differ by for one of them to be taken as hiding the other: one, the soft extent of the depth
 *  test. */
export const SOFT_Z_EXTENT = 1

/**
 * What the filter reads and weighs by:
 * - `colorAt`: the image at a coordinate, the nearest texel, or from `mip` one half on the mean of
 *   the 2 × 2 texels a half-size image's texel covers (`knobs.z`, `halfResInput`);
 * - `flatAt`: the flattened motion of the texel at a coordinate, its length, its angle and its depth
 *   in centimetres;
 * - `tileTexelAt`: the tile of motion at a coordinate, shifted by `jitter` tiles;
 * - `spreadWeight`: how far a streak of that motion, in samples a side, reaches the sample
 *   `offset` samples along; `sampleWeight`: the share of the centre's and of the other texel's
 *   streak that the sample takes, the nearer of the two weighing more, within the soft extent
 *   of their depths.
 */
export const FILTER_INPUTS_WGSL = wgslBlock(
  'FILTER_INPUTS_WGSL',
  [
    MOTION_BLUR_PARAMS_WGSL,
    FLAT_PACK_WGSL,
    listWgsl({
      name: 'tileList',
      group: 0,
      binding: FILTER_BINDINGS.list,
      entry: 'u32',
      append: false,
    }),
  ],
  `
@group(0) @binding(${FILTER_BINDINGS.params}) var<uniform> mb:MotionBlurParams;
@group(0) @binding(${FILTER_BINDINGS.color}) var colorTexture:texture_2d<f32>;
@group(0) @binding(${FILTER_BINDINGS.sampler}) var colorSampler:sampler;
@group(0) @binding(${FILTER_BINDINGS.flat}) var flatTexture:texture_2d<u32>;
@group(0) @binding(${FILTER_BINDINGS.tiles}) var tilesTexture:texture_2d<f32>;
@group(0) @binding(${FILTER_BINDINGS.blurred}) var blurredOut:texture_storage_2d<${OUTPUT_FORMAT},write>;
fn colorAt(uv:vec2f,mip:f32)->vec4f{
 let size=mb.color.xy;
 if(mip<0.5||mb.knobs.z==0.0){
  return textureLoad(colorTexture,clamp(vec2i(uv*size),vec2i(0),vec2i(size)-vec2i(1)),0);
 }
 let corner=clamp(floor(uv*size*0.5)*2.0+vec2f(1.0),vec2f(1.0),size-vec2f(1.0));
 return textureSampleLevel(colorTexture,colorSampler,corner/vec2f(textureDimensions(colorTexture)),0.0);
}
fn flatAt(uv:vec2f)->vec3f{
 let size=mb.grid;
 return unpackFlat(textureLoad(flatTexture,clamp(vec2i(uv*size),vec2i(0),vec2i(size)-vec2i(1)),0).r);
}
fn tileTexelAt(uv:vec2f,jitter:vec2f)->vec2i{
 let grid=mb.grid;
 var place=(floor(clamp(uv*grid,vec2f(0.5),grid-vec2f(0.5)))+vec2f(0.5))*${1 / FLATTEN_TILE}+jitter;
 place=min(place,vec2f(mb.tiles.xy)-vec2f(0.5));
 return clamp(vec2i(place),vec2i(0),vec2i(mb.tiles.xy)-vec2i(1));
}
fn spreadWeight(spread:f32,offset:f32,scale:f32)->f32{return saturate(scale*spread-max(offset-1.0,0.0));}
fn sampleWeight(centre:vec3f,other:vec3f,offset:f32,scale:f32)->f32{
 let apart=${SOFT_Z_EXTENT}.0*(other.z-centre.z);
 return saturate(0.5+apart)*spreadWeight(centre.x,offset,scale)+saturate(0.5-apart)*spreadWeight(other.x,offset,scale);
}`,
)

/**
 * The two ways a pixel's streak is read, `count` samples along it, half each way, spaced `inv`
 * apart in fractions of the streak and jittered by the pixel's `noise`:
 * - `gatherStreak`: the mean of the samples, the streak all one motion;
 * - `weighStreak`: the samples each weighed by `sampleWeight`, against the centre's own motion and
 *   depth: where the two samples of a pair differ — the farther one of the slower — the weights
 *   are taken from the one that covers more, so a nearer, still surface does not smear its colour
 *   onto what moves behind it. Returns the weighed mean and its weight, whose lack is the share
 *   of the pixel's own colour kept;
 * - `finished`: the pixel's own colour times that share, plus the streak, its alpha held to 0 or
 *   1 within half a percent of them.
 */
export const STREAK_WGSL = wgslBlock(
  'STREAK_WGSL',
  [FILTER_INPUTS_WGSL],
  `
struct Streak{color:vec4f,weight:f32,}
fn gatherStreak(uv:vec2f,search:vec2f,noise:f32,count:u32,inv:f32,mip:f32)->vec4f{
 let low=mb.color.zw*0.5;
 let high=vec2f(1.0)-low;
 var sum=vec4f(0.0);
 for(var i=0u;i<count;i+=4u){
  for(var j=0u;j<2u;j++){
   let along=vec2f(f32(i/2u+j))+vec2f(noise,1.0-noise);
   let reach=along*(2.0*inv);
   sum+=colorAt(clamp(uv+reach.x*search,low,high),mip)+colorAt(clamp(uv-reach.y*search,low,high),mip);
  }
 }
 return sum*inv;
}
fn weighStreak(uv:vec2f,largest:vec2f,noise:f32,count:u32,mip:f32)->Streak{
 let steps=count/2u;
 let centre=flatAt(uv);
 let scale=f32(steps)*inverseSqrt(dot(largest,largest));
 let search=largest*mb.color.zw;
 let low=mb.color.zw*0.5;
 let high=vec2f(1.0)-low;
 var color=vec4f(0.0);
 var weight=0.0;
 for(var s=0u;s<steps;s++){
  let along=vec2f(f32(s)+0.5)+vec2f(noise-0.5,0.5-noise);
  let reach=along/f32(steps);
  let uv0=clamp(uv+reach.x*search,low,high);
  let uv1=clamp(uv-reach.y*search,low,high);
  let a=flatAt(uv0);
  let b=flatAt(uv1);
  let offset=f32(s)+0.5;
  var w0=sampleWeight(centre,a,offset,scale);
  var w1=sampleWeight(centre,b,offset,scale);
  let deeper=a.z>b.z;
  let slower=a.x<b.x;
  if(deeper&&slower){w0=w1;}
  if(!(deeper||slower)){w1=w0;}
  color+=w0*colorAt(uv0,mip)+w1*colorAt(uv1,mip);
  weight+=w0+w1;
 }
 let norm=0.5/f32(steps);
 return Streak(color*norm,weight*norm);
}
fn finished(centre:vec4f,blend:f32,blurred:vec4f)->vec4f{
 var result=centre*blend+blurred;
 result.a=select(select(result.a,0.0,result.a<0.005),1.0,result.a>0.995);
 return result;
}`,
)

/**
 * The head of the filter's entry `entry`, which the classes of one motion and of two share: the
 * tile's coordinates from its list, its pixel, its noise and the range of its tile of motion, and,
 * across the workgroup, the samples a pixel takes (`count`, `inv`) and whether every pixel's motion
 * is nearly all the same (`togetherCount`).
 */
export const filterHead = (entry: string) => `override TILE:u32=${FILTER_TILE}u;
override HALF_RES:bool=false;
override WEIGH:bool=false;
var<workgroup> sampleCount:atomic<u32>;
var<workgroup> togetherCount:atomic<u32>;
@compute @workgroup_size(TILE,TILE)
fn ${entry}(@builtin(workgroup_id) wg:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=flatIndex(wg,groups,1u);
 let valid=index<tileList.count;
 var tileAt=vec2u(0u);
 if(valid){
  let word=tileList.entries[index];
  tileAt=vec2u(word&0xffffu,word>>16u);
 }
 let id=lid.xy+tileAt*TILE;
 var uv=(vec2f(id)+vec2f(0.5))*mb.color.zw;
 if(HALF_RES){uv=(vec2f(id*2u)+vec2f(1.0))*mb.color.zw;}
 let noise=interleavedGradientNoise(vec2f(id),0.0);
 let jitter=(vec2f(noise,interleavedGradientNoise(vec2f(id),1.0))-vec2f(0.5))*0.5;
 let range=select(vec4f(0.0),textureLoad(tilesTexture,tileTexelAt(uv,jitter),0),valid);
 let largest=range.zw;
 let reach=length(largest);
 let wanted=clamp(4.0*ceil(reach*0.25),4.0,mb.knobs.x);
 let together=dot(range.xy,range.xy)>0.4*reach*reach;
 if(lane==0u){atomicStore(&sampleCount,0u);atomicStore(&togetherCount,0u);}
 workgroupBarrier();
 atomicMax(&sampleCount,u32(wanted));
 atomicAdd(&togetherCount,select(0u,1u,together));
 workgroupBarrier();
 let count=atomicLoad(&sampleCount);
 let inv=1.0/f32(count);
`
/** The tail of the filter's entry, the classes' too: the blurred pixels written, a half-resolution
 *  thread's four, each its own colour kept by `blend`. */
export const FILTER_STORE = ` let size=vec2i(mb.color.xy);
 var base=vec2i(uv*mb.color.xy);
 if(HALF_RES){base=base&vec2i(-2);}
 for(var k=0i;k<select(1i,4i,HALF_RES);k++){
  let p=min(base+select(vec2i(0),vec2i(k&1,k>>1),HALF_RES),size-vec2i(1));
  var centre=vec4f(0.0);
  if(blend>0.0){centre=textureLoad(colorTexture,p,0);}
  if(valid&&all(base<size)){textureStore(blurredOut,p,finished(centre,blend,color));}
 }
}`

/** The pixel's blur along its tile's one motion: the gather's mean, or the weighing's. */
const ONE_MOTION = ` let mip=saturate(reach*inv-1.0);
 var color=vec4f(0.0);
 var blend=1.0;
 if(reach>=${MINIMAL_PIXEL_VELOCITY}){
  if(!WEIGH||atomicLoad(&togetherCount)==TILE*TILE){
   color=gatherStreak(uv,largest*mb.color.zw,noise,count,inv,mip);
   blend=0.0;
  }else{
   let streak=weighStreak(uv,largest,noise,count,mip);
   color=streak.color;
   blend=1.0-streak.weight;
  }
 }
`

/**
 * The blur of the image, a workgroup to a filter tile of one class (its list `tileList`, whose
 * `HALF_RES` and `WEIGH` the pipeline is made with), `TILE` threads a side: the tile's coordinates
 * are read from the list, the workgroup `index`-th (`flatIndex`, `gpu/dispatch/grid.ts`), and a
 * workgroup past the list's count has no motion, takes no sample and writes nothing.
 * - a thread's pixel — a half-resolution thread's 2 × 2 quad — reads the range of the tile of
 *   motion at its place, shifted by up to a quarter tile by its noise (the interleaved gradient
 *   of its coordinates), so the borders of the tiles do not show;
 * - the samples a pixel takes — 4 times the length of its motion over 4, up to the quality's —
 *   are the most any thread of the workgroup asks, so a tile is gathered at one density; a tile
 *   of the weighing classes whose every pixel's motion is nearly all the same (its smallest
 *   over 0.4 of its largest) is gathered instead;
 * - a pixel whose motion is under half a pixel is left as it is; the others take the gather's mean,
 *   or the weighing's, plus what is left of the pixel's own colour (`finished`).
 */
export const filterShader = () =>
  wgslProgram(`${filterHead('filterTiles')}${ONE_MOTION}${FILTER_STORE}`, [
    MOTION_BLUR_PARAMS_WGSL,
    STREAK_WGSL,
    interleavedGradientNoise,
  ])
