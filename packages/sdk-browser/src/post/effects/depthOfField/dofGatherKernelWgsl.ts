import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { GATHER_ACCUMULATOR_WGSL } from './dofGatherAccumulatorWgsl.ts'
import { GATHER_STATE_WGSL } from './dofGatherStateWgsl.ts'
import { DOF_PETZVAL_WGSL } from './dofScatterWgsl.ts'
import { BOKEH_LUT_SIZE } from './dofLayout.ts'

/**
 * The gather's reads: a sample of the reduced setup at a UV (`fetchSample`), mirrored at the setup's
 * edge for the sorting accumulators and held to its last UV, by the bilinear sampler when the kernel is
 * the fast one (`ks.bilinear`) and by the point sampler else, at the kernel's mip level; and the
 * kernel scope (`updateKernel`), remade whenever the radius changes: the mip level of the radius over
 * a sample's spacing (rounded, never negative), the kernel's centre moved by a random point of a disc
 * of 0.48 of that spacing (less the bilinear sampler's footprint), the factor an intersection is
 * measured by, and the Petzval transform of the pixel.
 */
const GATHER_READS_WGSL = wgslBlock(
  'GATHER_READS_WGSL',
  [GATHER_STATE_WGSL, DOF_PETZVAL_WGSL],
  `
fn fetchSample(at:vec2f)->GatherSample{
 var uv=at;
 if(QUALITY>=1u){uv=max(uv,-uv);uv=min(uv,2.0*ks.maxUv-uv);}
 uv=min(uv,ks.maxUv);
 if(ks.bilinear){
  return GatherSample(textureSampleLevel(gatherColor,linearSampler,uv,ks.mip),textureSampleLevel(gatherCoc,linearSampler,uv,ks.mip).x,0.0,1.0);
 }
 return GatherSample(textureSampleLevel(gatherColor,pointSampler,uv,ks.mip),textureSampleLevel(gatherCoc,pointSampler,uv,ks.mip).x,0.0,1.0);
}
fn updateKernel(){
 let spacing=gp.radius/(f32(gp.rings)+0.5);
 let disc=(0.48*sqrt(gp.random.x))*vec2f(cos(TWO_PI*gp.random.y),sin(TWO_PI*gp.random.y));
 var mip=select(max(floor(0.5+log2(spacing)),0.0),0.0,LAYER==SLIGHT);
 var range=select(spacing,0.0,LAYER==SLIGHT);
 if(ks.bilinear){range=max(gp.radius-f32(gp.maxRings)-exp2(mip),0.0)/(f32(gp.rings)+0.5);}
 let invSize=1.0/vec2f(view.tiles.zw);
 ks.centre=gp.centre+(disc*range)*invSize;
 ks.swirl=vec3f(1.0,0.0,1.0);
 if(QUALITY>=1u&&view.petzval.x!=0.0){ks.swirl=petzvalTransform(gp.viewport*2.0-1.0,true);}
 ks.countToPos=select(spacing,1.0,LAYER==SLIGHT);
 let texel=exp2(mip);
 ks.maxUv=(vec2f(view.gather.xy)-vec2f(0.5*texel))*invSize;
 ks.mip=mip;
 ks.intersectionScale=1.0/texel;
}
fn sampleIntersection(coc:f32,dist:f32)->f32{
 let scale=select(ks.intersectionScale,4.0,LAYER==SLIGHT);
 return saturate((abs(coc)-dist)*scale+0.5);
}`,
)

/**
 * The positions of a ring's samples, in mirrored pairs, and what is made of each pair:
 * - the ring has `4 (ring + 1)` pairs (`3 (ring + 1)` for the hexagonal web), rotated one step of
 *   `π / pairs` from the last, in batches of two where the count is even (the second sample of a
 *   batch is the first turned by a quarter), each batch with the position of its square ring too;
 * - a disk kernel puts a sample `ring + 1` spacings out along the pair's direction, the horizontal
 *   squeezed; a bokeh kernel reads its table, indexed by the square ring's position (mirrored for the
 *   background); the slight out of focus' kernel is the aligned square, a sample for every texel of
 *   the disc of the rings it gathers, at its own distance;
 * - each sample is read at its offset (turned by the Petzval transform), its circle scaled by the
 *   table's edge factor for the slight out of focus' bokeh, its intersection measured, and the two
 *   handed to the accumulator.
 */
export const GATHER_RING_WGSL = wgslBlock(
  'GATHER_RING_WGSL',
  [GATHER_READS_WGSL, GATHER_ACCUMULATOR_WGSL],
  `
fn squareRing(batch:u32,ring:u32)->vec2f{
 let r=f32(ring);
 if(batch<ring){return vec2f(r,f32(batch));}
 if(batch<ring*3u){return vec2f(r-f32(batch-ring),r);}
 return vec2f(-r,r-f32(batch-ring*3u));
}
fn quarter(v:vec2f,s:u32)->vec2f{return select(v,vec2f(-v.y,v.x),s==1u);}
fn tableOffset(square:vec2f,side:f32)->vec2f{
 let mirror=select(1.0,-1.0,LAYER==BACKGROUND);
 let uv=0.5+(0.5+side*mirror*square)/${BOKEH_LUT_SIZE}.0;
 return ks.countToPos*textureSampleLevel(bokehTable,wrappedSampler,uv,0.0).xy;
}
fn pairSample(offset:vec2f,side:f32,dist:f32,unit:vec2f)->GatherSample{
 var o=offset;
 if(QUALITY>=1u&&view.petzval.x!=0.0){o=petzvalApply(o,ks.swirl);}
 var s=fetchSample(ks.centre+o/vec2f(view.tiles.zw));
 if(BOKEH&&LAYER==SLIGHT){
  s.coc*=textureSampleLevel(bokehTable,wrappedSampler,(side*(0.5-1.0/${BOKEH_LUT_SIZE}.0))*unit,0.0).x;
 }
 s.dist=dist;
 s.inter=sampleIntersection(s.coc,dist);
 fast+=s.color;
 return s;
}
fn ringSamples(ring:u32){
 let pairs=pairCount(ring);
 let batchSize=select(2u,1u,(pairs%2u)==1u);
 let ringDist=ring+1u;
 let radius=f32(ringDist)*ks.countToPos;
 let angle=PI/f32(pairs);
 let turn=vec2f(cos(angle),sin(angle));
 var start=f32(ring%2u)*0.5;
 if(QUALITY==0u){start+=f32(ring+1u)*0.2;}
 var unit=vec2f(cos(PI*start/f32(pairs)),sin(PI*start/f32(pairs)));
 var offset=unit*radius;
 for(var b=0u;b<pairs/batchSize;b++){
  unit=vec2f(unit.x*turn.x-unit.y*turn.y,unit.x*turn.y+unit.y*turn.x);
  offset=vec2f(offset.x*turn.x-offset.y*turn.y,offset.x*turn.y+offset.y*turn.x);
  for(var s=0u;s<batchSize;s++){
   let square=quarter(squareRing(b,ringDist),s);
   let direction=quarter(unit,s);
   var o0=quarter(offset,s);
   var dist=radius;
   if(LAYER==SLIGHT){
    if(length(square)>f32(gp.maxRings)+0.5){continue;}
    o0=square*ks.countToPos;
    dist=length(o0*vec2f(view.lens.x,1.0));
   }else if(BOKEH){
    o0=tableOffset(square,1.0);
   }else{
    o0=vec2f(o0.x*view.lens.y,o0.y);
   }
   var o1=-o0;
   if(BOKEH&&LAYER!=SLIGHT){o1=tableOffset(square,-1.0);}
   let a=pairSample(o0,1.0,dist,direction);
   let c=pairSample(o1,-1.0,dist,direction);
   if(!gp.fast){gatherMirror(a,c);}
  }
 }
}
fn gatherRing(ring:u32,first:bool){
 let pairs=pairCount(ring);
 if(!gp.fast){gatherStart(ring,first);}
 ringSamples(ring);
 if(!gp.fast){gatherEnd(first,f32(pairs*2u));}
}
fn centreSample()->GatherSample{
 var s=fetchSample(ks.centre);
 s.dist=0.0;
 return s;
}`,
)
