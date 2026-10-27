import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { fastAcos } from '../../../../../math/src/wgsl/geometry.ts'
import { downsampleBase, fourRooksJitter } from '../../../../../math/src/wgsl/sampling.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { SP_INTEGRATE_CELLS } from './integratePassWgsl.ts'
import { spSurface } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'

/** The bindings of the pass that picks, for each pixel, the texel of the downsampled integration it reads: the image's normals and flags, the offsets written, the blue noise. */
export const STOCHASTIC_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  normals: [1, 'float'],
  flags: [2, 'uint'],
  offsets: [3, { store: F.offsets }],
  blue: [15, 'float'],
})

const S = STOCHASTIC_BINDINGS.at

/** The pixels along a side of a workgroup, and the cells of the downsampled image along a side of its cache: the workgroup's pixels over the reduction and a border of one cell either side. */
const SIDE = 8
const CACHE = SIDE / 2 + 2
/** The threads that fill the border of the cache after the cells inside it: the cells of its ring. */
const BORDER_CELLS = 4 * CACHE - 4

/**
 * THE TEXEL EACH PIXEL READS of the integration run at a reduction of two (`stochasticOffsets`, `screenProbeIntegrateDownsampleFactor`): the integration lit the pixel
 * of each two by two block that the four-rooks pattern names (`fourRooksJitter`, turned by the probes' gather state's frame, `sp.frames.x`, the one the integration turns its own by, so that the weights describe the pixel it lit), so a pixel
 * is rebuilt from the four cells round it — the block's own and its neighbours, which the pixel's place in the block makes the ones to its upper left, upper
 * right, lower left and lower right —, one of which it takes, picked by the blue noise with the odds of their weights.
 *
 * A workgroup of 8 × 8 pixels caches the depth and the normal of the pixel each cell of its 4 × 4 cells and the ring round them stands for (`cachedDepth`,
 * `cachedNormal`: the device depth, none (-1) for a pixel that is no lit surface or for a cell past the image, and its normal): the pixel the integration lit for
 * the cell (`spIntegratePixel`, held in the image, so that a cell of an odd image's last row or column keeps the surface of its last pixel), its thread's own
 * for a cell inside, read by the first `BORDER_CELLS` threads (`upBorderCoord`) from the surfaces for the ring. The weights of the four cells round a pixel
 * (`upWeights`) are the triangle filter of the distance, in pixels, between the pixel and the pixel each cell stands for — `(2 - |dx|)(2 - |dy|)` —,
 * times the plane weight, `exp2(-5000 · (the cell's point's distance to the pixel's plane over the pixel's depth)²)` for a cell with a surface, and the
 * normal weight, the square of one less the angle between the normals (radians, held to one), none for a cell past the image's
 * downsampled size. The cell is picked (`upOffset`) by the prefix sums of the weights and a number of the blue noise at the stochastic lighting's frame, in
 * the order of the cells; the offset to it (`x` in bit 0, `y` in bit 1) is written beside whether the weights add to a hundredth at least (bit 2): else no cell can stand for
 * the pixel, and the temporal pass does not trust the light it reads.
 */
const STOCHASTIC_KERNEL = wgslBlock(
  'STOCHASTIC_KERNEL',
  [fastAcos, fourRooksJitter, downsampleBase],
  `@group(0) @binding(${S.offsets}) var offsetsOut:texture_storage_2d<${F.offsets},write>;
var<workgroup> cachedDepth:array<array<f32,${CACHE}>,${CACHE}>;
var<workgroup> cachedNormal:array<array<vec3f,${CACHE}>,${CACHE}>;
fn upJitter(cell:vec2u)->vec2u{return fourRooksJitter(cell,sp.frames.x);}
/** The cell of the cache the thread \`index\` of the workgroup fills in the ring round the cells inside: the first row, the two end cells of each row between, the last row. */
fn upBorderCoord(index:u32)->vec2u{
 if(index<${CACHE}u){return vec2u(index,0u);}
 let between=index-${CACHE}u;
 if(between<${2 * (CACHE - 2)}u){return vec2u(select(${CACHE - 1}u,0u,between%2u==0u),1u+between/2u);}
 let last=between-${2 * (CACHE - 2)}u;
 return vec2u(last,${CACHE - 1}u);
}
/** The weights of the four cells round the pixel \`pixel\` (of the thread \`local\` of its workgroup, the surface \`s\`), the cell above and left of it first, then its right, its lower and its lower right. */
fn upWeights(pixel:vec2u,local:vec2u,s:SpSurface)->vec4f{
 let depth=spDepthOf(s.P);
 let first=downsampleBase(vec2i(pixel),2);
 let cache=(local+vec2u(1u))/vec2u(2u);
 let here=vec2i(pixel)-first*2;
 let plane=dot(s.P,s.N);
 let size=spIntegrateSize();
 var weights=vec4f(0.0);
 for(var k=0u;k<4u;k++){
  let offset=vec2i(i32(k&1u),i32(k>>1u));
  let corner=first+offset;
  let stood=vec2i(upJitter(vec2u(corner)))+offset*2-here;
  let triangle=(2.0-abs(f32(stood.x)))*(2.0-abs(f32(stood.y)));
  let at=cache+vec2u(offset);
  let z=cachedDepth[at.x][at.y];
  let away=abs(dot(worldAt(vec2f(vec2i(pixel)+stood)+vec2f(0.5),z),s.N)-plane)/depth;
  let near=select(0.0,exp2(-5000.0*away*away),z>0.0);
  let alike=1.0-saturate(fastAcos(saturate(dot(cachedNormal[at.x][at.y],s.N))));
  weights[k]=select(0.0,triangle*near*(alike*alike),all(vec2u(corner)<size));
 }
 return weights;
}
/** The offset of the cell the number \`random\` of [0, 1) picks among the four weighed \`weights\`: the first whose prefix sum it does not pass, the last where none. */
fn upOffset(random:f32,weights:vec4f)->vec2u{
 let upTo=vec4f(weights.x,weights.x+weights.y,weights.x+weights.y+weights.z,weights.x+weights.y+weights.z+weights.w);
 let draw=random*upTo.w;
 if(draw<=upTo.x&&weights.x>0.0){return vec2u(0u,0u);}
 if(draw<=upTo.y&&weights.y>0.0){return vec2u(1u,0u);}
 if(draw<=upTo.z&&weights.z>0.0){return vec2u(0u,1u);}
 return vec2u(1u,1u);
}
@compute @workgroup_size(${SIDE},${SIDE})
fn stochasticOffsets(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(global_invocation_id) id:vec3u){
 let pixel=id.xy;
 let inside=all(pixel<sp.size.xy);
 let s=spSurfaceAt(min(pixel,sp.size.xy-vec2u(1u)));
 let lit=inside&&s.lit;
 if(all(spIntegratePixel(pixel/vec2u(2u))==pixel)){
  let at=local.xy/vec2u(2u)+vec2u(1u);
  cachedDepth[at.x][at.y]=select(-1.0,s.z,lit);
  cachedNormal[at.x][at.y]=select(vec3f(0.0),s.N,lit);
 }
 let lane=local.x+${SIDE}u*local.y;
 if(lane<${BORDER_CELLS}u){
  let at=upBorderCoord(lane);
  let cell=group.xy*${SIDE / 2}u-vec2u(1u)+at;
  var z=-1.0;
  var n=vec3f(0.0);
  if(all(cell<spIntegrateSize())){
   let other=spSurfaceAt(spIntegratePixel(cell));
   if(other.lit){z=other.z;n=other.N;}
  }
  cachedDepth[at.x][at.y]=z;
  cachedNormal[at.x][at.y]=n;
 }
 workgroupBarrier();
 if(!inside){return;}
 var word=0u;
 if(lit){
  let weights=upWeights(pixel,local.xy,s);
  let offset=upOffset(blueNoiseScalar(pixel,sp.frames.z),weights);
  if(dot(weights,vec4f(1.0))>=0.01){word=offset.x|(offset.y<<1u)|4u;}
 }
 textureStore(offsetsOut,vec2i(pixel),vec4u(word,0u,0u,0u));
}`,
)

/** The program that picks the texel each pixel reads of the integration run at a reduction of two, over the `samples` of a tile. */
export const stochasticShader = (samples: readonly [number, number]) =>
  wgslProgram(
    `${spParams(S.params)}
${wgslConsts({ SP_INTEGRATE_DOWNSAMPLE: 2 })}`,
    [
      spCommon(samples),
      spSurface(S.normals, S.flags),
      blueNoiseWgsl(0, S.blue),
      SP_INTEGRATE_CELLS,
      STOCHASTIC_KERNEL,
    ],
  )
