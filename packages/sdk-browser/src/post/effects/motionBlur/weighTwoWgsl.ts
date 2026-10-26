import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { PI, TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { safeRcp } from '../../../../../math/src/wgsl/reals.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { LEAST_STREAK_PIXELS } from './classifyWgsl.ts'
import {
  DEPTH_SOFT_EXTENT_CM,
  FILTER_BINDINGS,
  filterStore,
  filterHead,
  filterInputs,
  headDeclarations,
  once,
  streakWgsl,
  type FilterShape,
} from './filterWgsl.ts'
import { MOTION_BLUR_PARAMS_WGSL, POLAR_TWO_WGSL, POLAR_WGSL } from './motionBlurWgsl.ts'

/** The filter's bindings with two directions: those of one, and the image of the second largest
 *  motions of the tiles beside the ranges'. */
export const FILTER_TWO_BINDINGS = { ...FILTER_BINDINGS, tilesSecond: 8 } as const

/** What the weighing of two motions reads of the tiles' second largest motion, beside the filter's
 *  own inputs. */
const secondInput = once((flat) =>
  wgslBlock(
    `SECOND_INPUT_WGSL(${flat})`,
    [filterInputs(flat)],
    `
@group(0) @binding(${FILTER_TWO_BINDINGS.tilesSecond}) var secondsTexture:texture_2d<f32>;`,
  ),
)

/**
 * The weighing of a pixel's streak along two motions, the class of two motions:
 * - `flatAtAngle`: the flattened motion of the texel at a coordinate as `(length, angle, depth)`,
 *   the angle in radians;
 * - `tapWeight`: how much a sample of motion `tap` counts to a streak along `blurAngle`, `offset`
 *   samples out — its spread (`spreadWeight`) and how well its own direction follows the streak's:
 *   whole within 0.1 radians, lost 0.25 radians further;
 * - `sharedWeight`: the share of the centre's and of the other texel's motion the sample takes,
 *   by depth, within the soft extent (`sampleWeight`'s), each with the direction it follows;
 * - `walkLeg`: the samples of one of the two motions, every second step from its `first` — the two
 *   interleave their steps —, a pair a step, one each way: what its samples add (`color`, their
 *   weights `weight`), how far they leave the pixel's depth open (`hole`, the weight of the
 *   colours that could fill it with `holeColor`, `holeColorWeight`) and the depths they were weighed
 *   at (`depth`, `depthSquare`, `depthWeight`); the colours that fill the hole are taken while the
 *   leg `holeOpen`, the second leg's only where the first took none;
 * - `joinLegs`: the two legs made one colour and the share of the pixel's own it keeps (`blend`):
 *   with only one motion the two are one; the second leg's gaps are filled from the first's colour
 *   as much as its depths differ from the first's (`seeThrough`), the first's from the hole colour;
 *   each leg's opacity is its weight over the steps it took, at most that of the depths it counted.
 * Each leg's weights are a sum of positive terms, so a leg that took none has no colour, and is
 * normalised to nothing, not to a division by zero.
 */
const TWO_STREAK_TEXT = `
struct Leg{color:vec4f,weight:f32,hole:f32,depth:f32,depthSquare:f32,depthWeight:f32,holeColor:vec4f,holeColorWeight:f32}
struct Joined{color:vec4f,blend:f32}
struct Filled{color:vec4f,opacity:f32,valid:bool}
fn flatAtAngle(uv:vec2f)->vec3f{
 let word=flatAt(uv);
 return vec3f(word.x,word.y*TWO_PI-PI,word.z);
}
fn tapWeight(tap:vec3f,offset:f32,blurAngle:f32,scale:f32)->f32{
 return spreadWeight(tap.x,offset,scale)*saturate(1.0-max(polarGap(tap.y,blurAngle)-0.1,0.0)*4.0);
}
fn sharedWeight(centre:vec3f,other:vec3f,offset:f32,blurAngle:f32,scale:f32)->f32{
 let apart=${DEPTH_SOFT_EXTENT_CM}.0*(other.z-centre.z);
 return saturate(0.5+apart)*tapWeight(centre,offset,blurAngle,scale)+saturate(0.5-apart)*tapWeight(other,offset,blurAngle,scale);
}
fn normalized(accumulator:vec4f,weight:f32)->vec4f{
 return max(accumulator*safeRcp(weight),vec4f(0.0));
}
fn normalizedOne(accumulator:f32,weight:f32)->f32{
 return max(accumulator*safeRcp(weight),0.0);
}
fn walkLeg(uv:vec2f,centre:vec3f,search:vec2f,blurAngle:f32,scale:f32,mip:f32,first:u32,steps:u32,noise:f32,spread:f32,holeOpen:bool)->Leg{
 let low=mb.color.zw*0.5;
 let high=vec2f(1.0)-low;
 var leg=Leg(vec4f(0.0),0.0,0.0,0.0,0.0,0.0,vec4f(0.0),0.0);
 for(var s=first;s<steps;s+=2u){
  let along=vec2f(f32(s)+0.5)+vec2f(noise-0.5,0.5-noise)*spread;
  let reach=along/f32(steps);
  let uv0=clamp(uv+reach.x*search,low,high);
  let uv1=clamp(uv-reach.y*search,low,high);
  let a=flatAtAngle(uv0);
  let b=flatAtAngle(uv1);
  let c0=colorAt(uv0,mip);
  let c1=colorAt(uv1,mip);
  let offset=f32(first+s)+0.5;
  let w0=tapWeight(a,along.x,blurAngle,scale);
  let w1=tapWeight(b,along.x,blurAngle,scale);
  var h0=sharedWeight(centre,a,offset,blurAngle,scale);
  var h1=sharedWeight(centre,b,offset,blurAngle,scale);
  let deeper=a.z>b.z;
  let slower=a.x<b.x;
  if(deeper&&slower){h0=h1;}
  if(!(deeper||slower)){h1=h0;}
  leg.color+=w0*c0+w1*c1;
  leg.weight+=w0+w1;
  leg.depth+=h0*a.z+h1*b.z;
  leg.depthSquare+=h0*a.z*a.z+h1*b.z*b.z;
  leg.depthWeight+=h0+h1;
  let f0=saturate(h0-w0);
  let f1=saturate(h1-w1);
  leg.hole+=f0+f1;
  if(holeOpen){
   leg.holeColor+=f0*c0+f1*c1;
   leg.holeColorWeight+=f0+f1;
  }
 }
 return leg;
}
fn filled(color:vec4f,colorWeight:f32,holeWeight:f32,depthWeight:f32,holeColor:vec4f,inv:f32)->Filled{
 let total=colorWeight+holeWeight;
 let opacity=min(saturate(colorWeight*inv*2.0),depthWeight*inv*2.0);
 return Filled(normalized(color+holeWeight*holeColor,total),opacity,total>0.0);
}
fn joinLegs(first:Leg,second:Leg,one:bool,inv:f32)->Joined{
 var a=first;
 var b=second;
 var each=inv*2.0;
 if(one){
  a.color+=b.color;a.weight+=b.weight;a.hole+=b.hole;
  b.color=vec4f(0.0);b.weight=0.0;b.hole=0.0;
  each=inv;
 }
 let meanSquare=normalizedOne(a.depthSquare,a.depthWeight);
 let mean0=normalizedOne(a.depth,a.depthWeight);
 let mean1=normalizedOne(b.depth,b.depthWeight);
 let variance=meanSquare-mean0*mean0;
 let apart=variance+(mean1-mean0)*(mean1-mean0);
 let seeThrough=select(0.0,saturate(2.0*variance/apart),apart!=0.0);
 let hole=normalized(a.holeColor+b.holeColor,a.holeColorWeight+b.holeColorWeight);
 let f0=filled(a.color,a.weight,a.hole,a.depthWeight,hole,each);
 let seed=mix(f0.color,hole,select(1.0,seeThrough,f0.valid));
 let f1=filled(b.color,b.weight,b.hole,b.depthWeight,seed,each);
 let opacity1=f1.opacity*saturate(1.0-seeThrough);
 let blend=saturate(1.0-f0.opacity)*saturate(1.0-opacity1);
 let total=f0.opacity+opacity1;
 let share=select(0.0,(1.0-blend)/total,total>0.0);
 return Joined((f0.color*f0.opacity+f1.color*opacity1)*share,blend);
}
fn weighStreakTwo(uv:vec2f,largest:vec2f,second:vec2f,noise:f32,count:u32,mips:vec2f,one:bool,inv:f32)->Joined{
 let steps=count/2u;
 let centre=flatAtAngle(uv);
 let spread=select(2.0,1.0,one);
 let scale0=f32(steps)*inverseSqrt(dot(largest,largest));
 let scale1=f32(steps)*inverseSqrt(dot(second,second));
 let first=walkLeg(uv,centre,largest*mb.color.zw,toPolar(largest).y,scale0,mips.x,0u,steps,noise,spread,true);
 let other=walkLeg(uv,centre,second*mb.color.zw,toPolar(second).y,scale1,mips.y,1u,steps,noise,spread,first.holeColorWeight==0.0);
 return joinLegs(first,other,one,inv);
}`

const twoStreak = once((flat) =>
  wgslBlock(
    `TWO_STREAK_WGSL(${flat})`,
    [secondInput(flat), streakWgsl(flat), POLAR_WGSL, POLAR_TWO_WGSL, PI, TWO_PI, safeRcp],
    TWO_STREAK_TEXT,
  ),
)

/** The pixel's blur along its tile's two motions, or one where the second is under half a pixel:
 *  `mips` the levels of the half-size image the two read, `one` whether the second is none. */
const TWO_MOTIONS = ` let second=select(vec2f(0.0),textureLoad(secondsTexture,tileTexelAt(uv,jitter),0).xy,valid);
 let reachSecond=length(second);
 let one=reachSecond<${LEAST_STREAK_PIXELS};
 let mips=select(vec2f(saturate(reach*inv*2.0-1.0),saturate(reachSecond*inv*2.0-1.0)),vec2f(saturate(reach*inv-1.0)),one);
 var color=vec4f(0.0);
 var blend=1.0;
 if(reach>=${LEAST_STREAK_PIXELS}){
  if(allTogether){
   color=gatherStreak(uv,largest*mb.color.zw,noise,count,inv,mips.x);
   blend=0.0;
  }else{
   let streak=weighStreakTwo(uv,largest,select(second,largest,one),noise,count,mips,one,inv);
   color=streak.color;
   blend=streak.blend;
  }
 }
`

/**
 * The blur of the filter tiles of the class of two motions, a workgroup to a tile: the filter of
 * the classes of one motion (`filterShader`) up to the pixel's blur, which here, where its tile
 * holds a second largest motion of half a pixel or more, takes the samples along both
 * (`weighStreakTwo`); at the resolution of the image, so the pipeline is made with its defaults.
 * A pixel whose tile's every pixel's motion is nearly all the same is gathered along the first
 * motion alone, as the other classes do, its samples read at the levels the two motions ask.
 */
export const filterTwoShader = ({ flat = 'packed', subgroups = false }: FilterShape = {}) =>
  wgslProgram(`${filterHead('filterTwoTiles', subgroups)}${TWO_MOTIONS}${filterStore(subgroups)}`, [
    MOTION_BLUR_PARAMS_WGSL,
    twoStreak(flat),
    interleavedGradientNoise,
    ...headDeclarations(subgroups),
  ])
