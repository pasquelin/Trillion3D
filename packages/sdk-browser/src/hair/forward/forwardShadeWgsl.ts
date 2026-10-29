import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FORWARD_RASTER_TILE } from './forwardMath.ts'
import { forwardClipSegment, forwardPoint, forwardToPixel } from './forwardCommonWgsl.ts'

/**
 * A SEGMENT AS A TILE OF PIXELS SHADES IT. `perspectiveAlpha` is the place along a segment, in the homogeneous parameter the attributes of its ends are
 * interpolated by, of the point whose place along it in the image is `a` (the ends' reciprocal w `w0` and `w1`): a colour or a radius mixed by the
 * image's parameter would bend toward the end that is nearer. `shadeSegment` cuts the segment to the view, projects it, and cuts it to the box of the tile of
 * `RASTER_TILE` pixels (half a pixel more all round), with the parameters (`alpha0`, `alpha1`) of the ends that remain, along the whole segment, and its
 * ends' radii; a segment along an axis, or reduced to a point, is cut as any other.
 */
export const forwardShade = wgslBlock(
  'forwardShade',
  [forwardPoint, forwardClipSegment, forwardToPixel],
  `const RASTER_TILE=${FORWARD_RASTER_TILE}u;
struct Shaded{ok:bool,sp0:vec4f,sp1:vec4f,alpha0:f32,alpha1:f32,rad0:f32,rad1:f32}
fn perspectiveAlpha(a:f32,w0:f32,w1:f32)->f32{return saturate(a*w1/max(mix(w0,w1,a),1e-20));}
fn shadeSegment(id:u32,low:vec2f)->Shaded{
 var s=Shaded(false,vec4f(0.0),vec4f(0.0),0.0,1.0,0.0,0.0);
 let first=forwardPoint(id);
 let second=forwardPoint(id+1u);
 let cut=forwardClipSegment(first.clip,second.clip);
 if(!cut.ok){return s;}
 s.rad0=first.radius;
 s.rad1=second.radius;
 s.sp0=forwardToPixel(cut.a);
 s.sp1=forwardToPixel(cut.b);
 s.alpha0=cut.t.x;
 s.alpha1=cut.t.y;
 let lo=low-vec2f(0.5);
 let hi=low+vec2f(f32(RASTER_TILE)+0.5);
 let p0=s.sp0;
 let p1=s.sp1;
 let out0=any(p0.xy<lo)||any(p0.xy>hi);
 let out1=any(p1.xy<lo)||any(p1.xy>hi);
 if(!out0&&!out1){s.ok=true;return s;}
 let d=p1.xy-p0.xy;
 var enter=-1e30;
 var leave=1e30;
 for(var axis=0u;axis<2u;axis++){
  if(abs(d[axis])<1e-12){
   if(p0.xy[axis]<lo[axis]||p0.xy[axis]>hi[axis]){return s;}
  }else{
   let t0=(lo[axis]-p0.xy[axis])/d[axis];
   let t1=(hi[axis]-p0.xy[axis])/d[axis];
   enter=max(enter,min(t0,t1));
   leave=min(leave,max(t0,t1));
  }
 }
 if(leave<0.0||enter>leave||enter>1.0){return s;}
 let a0=s.alpha0;
 let a1=s.alpha1;
 if(out0&&enter>0.0&&enter<1.0){
  s.alpha0=mix(a0,a1,perspectiveAlpha(enter,p0.w,p1.w));
  s.sp0=mix(p0,p1,enter);
 }
 if(out1&&leave>0.0&&leave<1.0){
  s.alpha1=mix(a0,a1,perspectiveAlpha(leave,p0.w,p1.w));
  s.sp1=mix(p0,p1,leave);
 }
 s.ok=true;
 return s;
}`,
)
