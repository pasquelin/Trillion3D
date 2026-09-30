import { shaderLanguage } from '../math/shaderLanguage.ts';
/** The ray from `P` along `R`, clipped to the view (`reflectionExit`) and projected: `start` and
 *  `delta` in pixels, depth `a.z` to `b.z`, `size` the drawn one; clipped away, a miss. The
 *  mirror's walk and the rough one's (`hizTraceWgsl.ts`) both begin with it. */
export const REFLECTION_SEGMENT = `
 var c:vec4f=reflectionProject(vec4f(P,1.0));
 var d:vec4f=reflectionProject(vec4f(R,0.0));
 var reach:f32=reflectionExit(c,d);
 if(reach<=0.0||c.w<=0.0){return vec4f(0.0);}
 var e:vec4f=c+d*reach;
 if(e.w<=0.0){return vec4f(0.0);}
 var size:vec2f=reflectionSize();
 var a:vec3f=c.xyz/c.w;var b:vec3f=e.xyz/e.w;
 var start:vec2f=(a.xy*0.5+vec2f(0.5))*size;
 var delta:vec2f=(b.xy-a.xy)*0.5*size;
`;

/** Screen-space pixel DDA, following McGuire & Mara (JCGT 2014), implemented here from
 * the projected-segment equations: https://jcgt.org/published/0003/04/04/paper.pdf.
 * Clip the homogeneous ray to all six planes before division. Depth is linear along
 * the projected segment; each visited pixel tests that segment's depth interval.
 * Work is bounded by the viewport's width plus height, with no world-space step/thickness.
 * The adapters supply a canonical [0,w] depth, texture-oriented Y and the hit's radiance, whose
 * alpha 0 is a pixel the source cannot answer: a miss. */
const TRACE = `
fn reflectionExit(c:vec4f,d:vec4f)->f32{
 var end:f32=1e30;
 for(var plane:i32=0;plane<6;plane++){
  var p:f32=0.0;var v:f32=0.0;
  if(plane==0){p=c.w+c.x;v=d.w+d.x;}
  if(plane==1){p=c.w-c.x;v=d.w-d.x;}
  if(plane==2){p=c.w+c.y;v=d.w+d.y;}
  if(plane==3){p=c.w-c.y;v=d.w-d.y;}
  if(plane==4){p=c.z;v=d.z;}
  if(plane==5){p=c.w-c.z;v=d.w-d.z;}
  if(p<0.0){return 0.0;}
  if(v<0.0){end=min(end,-p/v);}
 }
 return end;
}
fn screenReflection(P:vec3f,R:vec3f)->vec4f{${REFLECTION_SEGMENT} var pixel:vec2i=vec2i(floor(start));
 var origin:vec2i=pixel;
 var step:vec2i=vec2i(0);
 var crossing:vec2f=vec2f(1e30);
 var stride:vec2f=vec2f(1e30);
 if(delta.x>0.0){step.x=1;crossing.x=(f32(pixel.x)+1.0-start.x)/delta.x;stride.x=1.0/delta.x;}
 if(delta.x<0.0){step.x=-1;crossing.x=(f32(pixel.x)-start.x)/delta.x;stride.x=-1.0/delta.x;}
 if(delta.y>0.0){step.y=1;crossing.y=(f32(pixel.y)+1.0-start.y)/delta.y;stride.y=1.0/delta.y;}
 if(delta.y<0.0){step.y=-1;crossing.y=(f32(pixel.y)-start.y)/delta.y;stride.y=-1.0/delta.y;}
 var entered:f32=0.0;
 for(var i:i32=0;i<i32(size.x+size.y)+2;i++){
  if(any(pixel<vec2i(0))||any(pixel>=vec2i(size))){break;}
  var exited:f32=min(1.0,min(crossing.x,crossing.y));
  if(!all(pixel==origin)){
   var z:f32=reflectionDepthAt(pixel);
   var before:f32=mix(a.z,b.z,entered);
   var after:f32=mix(a.z,b.z,exited);
   if(z!=reflectionClearDepth()&&z>=min(before,after)&&z<=max(before,after)){
    return reflectionHitAt(pixel);
   }
  }
  if(exited>=1.0){break;}
  var advanceX:bool=crossing.x<=crossing.y;
  var advanceY:bool=crossing.y<=crossing.x;
  if(advanceX){pixel.x+=step.x;crossing.x+=stride.x;}
  if(advanceY){pixel.y+=step.y;crossing.y+=stride.y;}
  entered=exited;
 }
 return vec4f(0.0);
}`;

/** One arithmetic source for both graphics APIs; declarations alone change language. */
export function screenTraceShader(language: 'wgsl' | 'glsl') {
  return shaderLanguage(TRACE, language);
}
