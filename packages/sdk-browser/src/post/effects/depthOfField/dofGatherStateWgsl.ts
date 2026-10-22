import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { PI, TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { DOF_LAYER_WGSL } from './dofLayerWgsl.ts'
import { COC_FORMAT, COLOR_FORMAT } from './dofLayout.ts'

/** The gather's bindings: the reduced setup's colour and circle of confusion, the two tile images,
 *  the bokeh table, its three samplers, the colour, opacity and occlusion written. */
export const GATHER_BINDINGS = {
  color: 1,
  coc: 2,
  tileFg: 3,
  tileBg: 4,
  lut: 5,
  point: 6,
  linear: 7,
  wrapped: 8,
  outColor: 9,
  outAlpha: 10,
  outOcclusion: 11,
} as const

/** The densities of the kernel's samples. */
export const DENSITIES = {
  constant: 0,
  hexaweb: 1,
  centerDisk: 2,
  recursive: 4,
  dynamic: 5,
} as const

/**
 * What the gather keeps while it runs, in private variables (`gp`, `ks`, `acc`, `fast`, one set to
 * an invocation) so that the kernel and the accumulators share them without passing them:
 * - `Gp`, the gather's parameters: the rings (`rings` the unit the kernel's sample spacing is made of,
 *   `maxRings` the rings it gathers), the centre of the kernel in the reduced setup's UV and the
 *   pixel's in the image's, the kernel's radius in texels of the gather's size, the pixel's two
 *   random signals, whether it is the fast gather, the closest circle of the tile, the transforms
 *   saturating which circles are considered, the density of the kernel's samples and how it changes;
 * - `Ks`, the kernel scope, remade when the radius changes: the centre moved by a random offset, the
 *   texels a sample count spans, the mip level and the last UV it may read, the factor of the
 *   intersection and the Petzval transform;
 * - `Acc`, every accumulator's fields at once (the foreground's two layers, the background's two
 *   buckets, the simple one's sums): each layer touches only its own.
 */
export const GATHER_STATE_WGSL = wgslBlock(
  'GATHER_STATE_WGSL',
  [DOF_LAYER_WGSL, PI, TWO_PI],
  `
override RINGS:u32=4u;
override QUALITY:u32=1u;
override BOKEH:bool=false;
const D_CONSTANT:u32=${DENSITIES.constant}u;
const D_HEXAWEB:u32=${DENSITIES.hexaweb}u;
const D_CENTER_DISK:u32=${DENSITIES.centerDisk}u;
const D_RECURSIVE:u32=${DENSITIES.recursive}u;
const D_DYNAMIC:u32=${DENSITIES.dynamic}u;
@group(0) @binding(${GATHER_BINDINGS.color}) var gatherColor:texture_2d<f32>;
@group(0) @binding(${GATHER_BINDINGS.coc}) var gatherCoc:texture_2d<f32>;
@group(0) @binding(${GATHER_BINDINGS.tileFg}) var tileFgTexture:texture_2d<f32>;
@group(0) @binding(${GATHER_BINDINGS.tileBg}) var tileBgTexture:texture_2d<f32>;
@group(0) @binding(${GATHER_BINDINGS.lut}) var bokehTable:texture_2d<f32>;
@group(0) @binding(${GATHER_BINDINGS.point}) var pointSampler:sampler;
@group(0) @binding(${GATHER_BINDINGS.linear}) var linearSampler:sampler;
@group(0) @binding(${GATHER_BINDINGS.wrapped}) var wrappedSampler:sampler;
@group(0) @binding(${GATHER_BINDINGS.outColor}) var colorOut:texture_storage_2d<${COLOR_FORMAT},write>;
@group(0) @binding(${GATHER_BINDINGS.outAlpha}) var alphaOut:texture_storage_2d<${COC_FORMAT},write>;
@group(0) @binding(${GATHER_BINDINGS.outOcclusion}) var occlusionOut:texture_storage_2d<${COC_FORMAT},write>;
struct Gp{
 rings:u32,maxRings:u32,centre:vec2f,viewport:vec2f,radius:f32,random:vec2f,fast:bool,closest:f32,
 affine:vec2f,density:u32,densityRings:u32,maxChanges:u32,minIntersect:f32,
}
struct Ks{
 centre:vec2f,countToPos:f32,mip:f32,maxUv:vec2f,intersectionScale:f32,swirl:vec3f,bilinear:bool,
}
struct Acc{
 color:vec4f,colorWeight:f32,opacity:f32,opacityWeight:f32,closestForeground:f32,
 layer0:vec4f,layer1:vec4f,weight0:f32,weight1:f32,foregroundSum:f32,
 prevColor:vec4f,prevCoc:f32,prevCocSquare:f32,prevWeight:f32,
 curColor:vec4f,curCoc:f32,curCocSquare:f32,curWeight:f32,curTranslucency:f32,
 border:f32,first:bool,farBorder:f32,closeBorder:f32,
}
struct GatherSample{color:vec4f,coc:f32,dist:f32,inter:f32}
struct AccOut{
 foreground:vec4f,foregroundAlpha:f32,hole:vec4f,holeAlpha:f32,
 background:vec4f,backgroundWeight:f32,cocAverage:vec2f,slight:vec4f,slightOpacity:f32,
}
var<private> gp:Gp;
var<private> ks:Ks;
var<private> acc:Acc;
var<private> fast:vec4f;
fn emptyOutput()->AccOut{
 return AccOut(vec4f(0.0),0.0,vec4f(0.0),1.0,vec4f(0.0),0.0,vec2f(0.0),vec4f(0.0),0.0);
}
fn sampleWeight(coc:f32)->f32{
 if(QUALITY==0u){return 1.0;}
 return min(1.0/max(PI*coc*coc,1e-30),1.0/(PI*0.25*0.25));
}
fn consideredCoc(coc:f32)->f32{return select(1.0,affine(abs(coc),gp.affine),LAYER!=HOLE);}
fn largestFirst()->bool{return LAYER==BACKGROUND;}
fn pairCount(ring:u32)->u32{return (ring+1u)*select(4u,3u,gp.density==D_HEXAWEB);}
fn kernelSamples(rings:u32)->f32{
 let r=f32(rings);
 return 1.0+select(4.0,3.0,gp.density==D_HEXAWEB)*r*(r+1.0);
}`,
)
