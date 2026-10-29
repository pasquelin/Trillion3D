import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { gridWalkAdvance } from '../gridWalkWgsl.ts'
import { RENDER_CURVE_PARAMS_WGSL } from './paramsWgsl.ts'

/** The most tiles a segment's walk visits. */
export const RENDER_CURVE_DDA_MAX_STEPS = 256

/**
 * The projection of a segment: its pixel coordinates (`toPixel`, the depth the clip space's), its clip in homogeneous coordinates by
 * the six planes of the view (`blinnClip`), its clip to a box in the image (`clipSegment`), and the walk through the tiles it crosses
 * (`Dda`). The segments that run along an axis, and the ones of no length, have steps and directions that are defined here.
 */
export const RENDER_CURVE_PROJECT_WGSL = wgslBlock(
  'RENDER_CURVE_PROJECT_WGSL',
  [RENDER_CURVE_PARAMS_WGSL, gridWalkAdvance],
  `fn toPixel(c:vec4f)->vec3f{
 let ndc=c.xyz/c.w;
 return vec3f(vec2f(ndc.x*0.5+0.5,ndc.y*-0.5+0.5)*vec2f(curve.resolution),ndc.z);
}
fn blinnClip(p0:ptr<function,vec4f>,p1:ptr<function,vec4f>)->bool{
 var t=vec2f(0.0,1.0);
 var removed=(*p0).w<0.0&&(*p1).w<0.0;
 var positive=false;
 for(var plane=0u;plane<6u;plane++){
  positive=!positive;
  let component=plane/2u;
  let sgn=select(-1.0,1.0,positive);
  let wFactor=select(0.0,1.0,plane!=4u);
  let bc=wFactor*vec2f((*p0).w,(*p1).w)+sgn*vec2f((*p0)[component],(*p1)[component]);
  removed=removed||(bc.x<0.0&&bc.y<0.0);
  let denom=bc.x-bc.y;
  if(denom<0.0){t.x=max(t.x,bc.x/denom);}
  else if(denom>0.0){t.y=min(t.y,bc.x/denom);}
 }
 if(!removed){
  let a=mix(*p0,*p1,t.x);
  let b=mix(*p0,*p1,t.y);
  *p0=a;
  *p1=b;
 }
 return !removed;
}
fn clipSegment(lo:vec2f,hi:vec2f,p0:ptr<function,vec3f>,p1:ptr<function,vec3f>)->bool{
 let a=*p0;
 let b=*p1;
 let out0=any(a.xy<lo)||any(a.xy>hi);
 let out1=any(b.xy<lo)||any(b.xy>hi);
 if(!out0&&!out1){return true;}
 let dir=b.xy-a.xy;
 let rcp=1.0/select(dir,vec2f(1e-20),abs(dir)<vec2f(1e-20));
 let t0=(lo-a.xy)*rcp;
 let t1=(hi-a.xy)*rcp;
 let near=max(min(t0.x,t1.x),min(t0.y,t1.y));
 let far=min(max(t0.x,t1.x),max(t0.y,t1.y));
 if(far<0.0||near>far||near>1.0){return false;}
 if(out0&&near>0.0&&near<1.0){*p0=mix(a,b,near);}
 if(out1&&far>0.0&&far<1.0){*p1=mix(a,b,far);}
 return true;
}
struct Dda{coord:vec2f,delta:vec2f,step:vec2f,side:vec2f}
fn ddaCreate(start:vec2f,end:vec2f)->Dda{
 let d=end-start;
 let len=length(d);
 let dir=select(vec2f(1.0,0.0),d/max(len,1e-20),len>0.0);
 let still=dir==vec2f(0.0);
 let rcp=1.0/select(dir,vec2f(1.0),still);
 var out:Dda;
 out.coord=floor(start);
 out.delta=select(abs(rcp),vec2f(3.4e38),still);
 out.step=sign(dir);
 out.side=select((out.coord-start+max(out.step,vec2f(0.0)))*rcp,vec2f(3.4e38),still);
 return out;
}`,
)
