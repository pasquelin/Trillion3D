import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { GATHER_STATE_WGSL } from './dofGatherStateWgsl.ts'

/**
 * The simple accumulator (the foreground's hole filling and the slight out of focus): one bucket of
 * colour and one of opacity, a sample weighing by its intersection with the pixel, its weight and, for
 * the colour, how far its circle is considered. The hole filling leaves out the samples of a large
 * foreground circle and keeps the distance of the nearest, which its resolve turns into the
 * translucency of the hole; a mirrored pair, where one sample is in front of the other, takes the
 * front's intersection (the hole filling: its maximum; the slight out of focus: also its weight).
 */
const SIMPLE_ACCUMULATOR_WGSL = wgslBlock(
  'SIMPLE_ACCUMULATOR_WGSL',
  [GATHER_STATE_WGSL],
  `
struct Derived{weight:f32,considered:f32,opacity:f32}
fn derive(s:GatherSample)->Derived{
 if(LAYER==HOLE){return Derived(1.0,consideredCoc(s.coc),1.0);}
 return Derived(sampleWeight(s.coc),saturate(DOF_SLIGHT-abs(s.coc)),saturate(DOF_SLIGHT-s.coc));
}
fn simpleAccumulate(s:GatherSample,d:Derived){
 if(LAYER==HOLE&&s.coc<-(DOF_SLIGHT-1.0)){
  acc.closestForeground=min(acc.closestForeground,s.dist);
  return;
 }
 let colored=s.inter*d.weight*d.considered;
 acc.color+=s.color*colored;
 acc.colorWeight+=colored;
 acc.opacity+=s.inter*d.opacity;
 acc.opacityWeight+=s.inter;
}
fn simpleMirror(a0:GatherSample,b0:GatherSample){
 var a=a0;
 var b=b0;
 var da=derive(a);
 var db=derive(b);
 if(LAYER==HOLE){
  if(isForeground(a.coc)&&b.coc>a.coc){b.inter=max(b.inter,a.inter);}
  else if(isForeground(b.coc)&&a.coc>b.coc){a.inter=max(b.inter,a.inter);}
 }else if(b.coc>a.coc){
  b.inter=a.inter;
  db.weight=da.weight;
 }else{
  a.inter=b.inter;
  da.weight=db.weight;
 }
 simpleAccumulate(a,da);
 simpleAccumulate(b,db);
}
fn simpleResolve(out:ptr<function,AccOut>){
 let color=acc.color*safeRcp(acc.colorWeight);
 if(LAYER==HOLE){
  if(acc.closestForeground!=DOF_EXTREME&&acc.colorWeight>0.0){
   let translucency=acc.closestForeground/gp.radius;
   (*out).hole=color*(1.0-translucency);
   (*out).holeAlpha=translucency;
  }
 }else{
  (*out).slight=color;
  (*out).slightOpacity=acc.opacity*safeRcp(acc.opacityWeight);
 }
}`,
)

/**
 * The foreground's accumulator, after the two layers of the Call of Duty: Advanced Warfare scheme
 * (Jimenez, SIGGRAPH 2014): a sample belongs to the closer layer or the farther by how far its circle
 * is past the tile's closest one, each layer weighed by the intersections; a sample's intersection
 * is dropped unless it is in the foreground and fades in over a texel past the least circle the
 * recombine draws. A mirrored pair takes the closer sample's intersection, circle and weight for both.
 * The resolve opens the closer layer by the share of the kernel's area it covers, and the foreground's
 * alpha is the share of the samples that were in the foreground.
 */
const FOREGROUND_ACCUMULATOR_WGSL = wgslBlock(
  'FOREGROUND_ACCUMULATOR_WGSL',
  [GATHER_STATE_WGSL],
  `
fn fading(coc:f32)->f32{return saturate(-coc-(DOF_SLIGHT-1.0));}
fn sampleLayer(coc:f32)->f32{
 let id=saturate((coc-gp.closest)*0.5);
 if(QUALITY>=1u){return smoothstep(0.0,1.0,id);}
 return id;
}
fn foregroundAccumulate(s:GatherSample,weight:f32){
 var inter=s.inter;
 if(!isForeground(s.coc)){inter=0.0;}
 inter*=fading(s.coc);
 let near=sampleLayer(s.coc);
 let far=1.0-near;
 acc.layer1+=s.color*(near*inter*weight);
 acc.weight1+=near*inter*weight;
 acc.layer0+=s.color*(far*inter*weight);
 acc.weight0+=far*inter*weight;
 acc.foregroundSum+=select(0.0,1.0,isForeground(s.coc))*fading(s.coc);
}
fn foregroundCenter(c0:GatherSample){
 var c=c0;
 c.inter*=fading(c.coc);
 foregroundAccumulate(c,sampleWeight(c.coc));
}
fn foregroundMirror(a0:GatherSample,b0:GatherSample){
 var a=a0;
 var b=b0;
 var wa=sampleWeight(a.coc);
 var wb=sampleWeight(b.coc);
 a.inter*=fading(a.coc);
 b.inter*=fading(b.coc);
 if(b.coc>a.coc){b.inter=a.inter;b.coc=a.coc;wb=wa;}
 else{a.inter=b.inter;a.coc=b.coc;wa=wb;}
 foregroundAccumulate(a,wa);
 foregroundAccumulate(b,wb);
}
fn foregroundResolve(out:ptr<function,AccOut>,samples:f32){
 let area=1.0/sampleWeight(gp.radius*((f32(gp.rings)+0.5)/f32(gp.rings)));
 let opening=saturate(select(0.0,1.0,acc.weight1==0.0)+(1.0/samples)*area*acc.weight0);
 let color=mix(acc.layer1*safeRcp(acc.weight1),acc.layer0*safeRcp(acc.weight0),opening);
 (*out).foreground=color;
 (*out).foregroundAlpha=select(0.0,acc.foregroundSum/samples,acc.weight0+acc.weight1>0.0);
 (*out).background=color;
 (*out).backgroundWeight=acc.weight0+acc.weight1;
}`,
)

/**
 * The background's accumulator, binning the kernel by rings, the largest first: a ring's samples go to
 * the current bucket or, if their circle is past the radius between this ring and the next, to the
 * previous one (`border`); the current bucket is then composited into the previous — added where the
 * average circles agree, in front of it by the translucency of the ring where it is nearer —, and
 * emptied. Far rings reach only distant geometry, so closer geometry found by the nearer rings
 * is composited over it. The cinematic accumulator also keeps a bucket to the layer between two
 * borders (`closeBorder`, `farBorder`). The centre is a ring of its own, last.
 */
const BACKGROUND_ACCUMULATOR_WGSL = wgslBlock(
  'BACKGROUND_ACCUMULATOR_WGSL',
  [GATHER_STATE_WGSL],
  `
fn binAccumulate(s:GatherSample,weight:f32){
 var inter=s.inter;
 if(isForeground(s.coc)){inter=0.0;}
 let considered=consideredCoc(s.coc);
 var previous=saturate(s.coc-acc.border+0.5);
 if(QUALITY>=1u){previous=smoothstep(0.0,1.0,previous);}
 if(acc.first){previous=0.0;}
 var current=1.0-previous;
 if(QUALITY==3u&&!acc.first){
  current*=saturate(s.coc-acc.closeBorder+0.5);
  previous*=1.0-saturate(s.coc-acc.farBorder+0.5);
 }
 let wc=inter*considered*weight*current;
 acc.curColor+=s.color*wc;
 acc.curCoc+=s.coc*wc;
 acc.curCocSquare+=s.coc*(s.coc*wc);
 acc.curWeight+=wc;
 let wp=inter*considered*weight*previous;
 acc.prevColor+=s.color*wp;
 acc.prevCoc+=s.coc*wp;
 acc.prevCocSquare+=s.coc*(s.coc*wp);
 acc.prevWeight+=wp;
 acc.curTranslucency+=saturate(s.coc-acc.border);
}
fn binMerge(samples:f32){
 if(acc.curWeight==0.0){return;}
 let opacity=saturate(1.0-acc.curTranslucency/samples);
 let occluding=saturate(acc.prevCoc*safeRcp(acc.prevWeight)-acc.curCoc*safeRcp(acc.curWeight));
 let factor=select(1.0-opacity*occluding,0.0,acc.prevWeight==0.0);
 acc.prevColor=acc.prevColor*factor+acc.curColor;
 acc.prevCoc=acc.prevCoc*factor+acc.curCoc;
 acc.prevCocSquare=acc.prevCocSquare*factor+acc.curCocSquare;
 acc.prevWeight=acc.prevWeight*factor+acc.curWeight;
}
fn binClear(){
 acc.curColor=vec4f(0.0);acc.curCoc=0.0;acc.curCocSquare=0.0;acc.curWeight=0.0;acc.curTranslucency=0.0;
}
fn binStart(ring:u32,first:bool){
 acc.first=first;
 acc.border=(f32(ring)+2.5)*(gp.radius/(0.5+f32(gp.rings)));
}
fn binEnd(first:bool,samples:f32){
 if(first){
  acc.prevColor=acc.curColor;acc.prevCoc=acc.curCoc;acc.prevCocSquare=acc.curCocSquare;acc.prevWeight=acc.curWeight;
 }else{binMerge(samples);}
 binClear();
}
fn binCenterRing(c:GatherSample){
 acc.border=1.5*gp.radius/(0.5+f32(gp.rings));
 acc.first=!largestFirst();
 binAccumulate(c,sampleWeight(c.coc));
 binMerge(1.0);
}
fn binMirror(a:GatherSample,b:GatherSample){
 binAccumulate(a,sampleWeight(a.coc));
 binAccumulate(b,sampleWeight(b.coc));
}
fn binAmend(factor:f32){
 acc.prevColor*=factor;acc.prevCoc*=factor;acc.prevCocSquare*=factor;acc.prevWeight*=factor;
}
fn binResolve(out:ptr<function,AccOut>){
 let inverse=safeRcp(acc.prevWeight);
 (*out).background=acc.prevColor*inverse;
 (*out).backgroundWeight=acc.prevWeight;
 (*out).cocAverage=vec2f(acc.prevCoc*inverse,acc.prevCocSquare*inverse);
}`,
)

/** The accumulators, and the one of the layer chosen by the pipeline constant `LAYER`: the single
 *  set of functions the kernel calls (`gatherMirror`, `gatherCenter`, `gatherStart`, `gatherEnd`,
 *  `gatherAmend`, `gatherResolve`, `gatherClear`). */
export const GATHER_ACCUMULATOR_WGSL = wgslBlock(
  'GATHER_ACCUMULATOR_WGSL',
  [SIMPLE_ACCUMULATOR_WGSL, FOREGROUND_ACCUMULATOR_WGSL, BACKGROUND_ACCUMULATOR_WGSL],
  `
fn gatherClear(){
 acc=Acc(vec4f(0.0),0.0,0.0,0.0,DOF_EXTREME,vec4f(0.0),vec4f(0.0),0.0,0.0,0.0,
  vec4f(0.0),0.0,0.0,0.0,vec4f(0.0),0.0,0.0,0.0,0.0,0.0,false,0.0,0.0);
}
fn gatherMirror(a:GatherSample,b:GatherSample){
 if(LAYER==FOREGROUND){foregroundMirror(a,b);}
 else if(LAYER==BACKGROUND){binMirror(a,b);}
 else{simpleMirror(a,b);}
}
// The centre sample, as the last ring of the kernel for the background, else as a sample of its own.
fn gatherCenter(c:GatherSample,ownRing:bool){
 if(LAYER==FOREGROUND){foregroundCenter(c);}
 else if(LAYER==BACKGROUND){
  if(ownRing){binCenterRing(c);}else{binAccumulate(c,sampleWeight(c.coc));}
 }else{simpleAccumulate(c,derive(c));}
}
fn gatherStart(ring:u32,first:bool){if(LAYER==BACKGROUND){binStart(ring,first);}}
fn gatherEnd(first:bool,samples:f32){if(LAYER==BACKGROUND){binEnd(first,samples);}}
fn gatherAmend(factor:f32){if(LAYER==BACKGROUND){binAmend(factor);}}
fn gatherResolve(samples:f32)->AccOut{
 var out=emptyOutput();
 if(LAYER==FOREGROUND){foregroundResolve(&out,samples);}
 else if(LAYER==BACKGROUND){binResolve(&out);}
 else{simpleResolve(&out);}
 return out;
}`,
)
