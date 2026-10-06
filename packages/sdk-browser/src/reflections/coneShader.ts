import { shaderLanguage } from '../math/shaderLanguage.ts'
import { REFLECTION_SEGMENT } from './traceShader.ts'

/** Screen-space cone tracing.
 * The cone contains half the N.L-weighted GGX directional mass; it is a finite
 * prefilter approximation, not an exact quadrature of the unbounded GGX tail.
 * Its footprint grows in world units before projection, and depth intervals are
 * tested while tracing. A mip of the mirror hit alone is not a cone trace.
 * From its receiver's point `P` and normal `N`, the receiver itself never answering
 * (`reflectionConeMeets`). Where the cone is narrow beside its reach — a smooth surface's —, stepping
 * cell by cell at its own level walked a pixel at a time: a coarser block round its axis that holds
 * nothing the cone can meet over the stretch it covers is passed whole and the next one taken a
 * level up, coarse to fine as a depth pyramid's walk, but only where that stretch outruns a cell of
 * the cone's own level; a block that holds something is not tried again before the axis leaves it.
 * `reflectionConeSection`: the section at fraction `t`, its footprint in pixels and depth spread. */
export function reflectionConeShader(language: 'wgsl' | 'glsl') {
  return shaderLanguage(
    `
fn reflectionGgxMass(u:f32,k:f32)->f32{
 var d:f32=k-1.0;
 if(abs(d)<0.125){
  var power:f32=u*u;var result:f32=u;var sign:f32=-1.0;
  for(var order:i32=2;order<=9;order++){
   result+=sign*2.0*k*power/f32(order);power*=d*u;sign=-sign;
  }
  return result;
 }
 return -(k+1.0)*u/d+2.0*k*log(1.0+d*u)/(d*d);
}
fn reflectionConeSlope(rough:f32)->f32{
 var alpha:f32=rough*rough;var k:f32=alpha*alpha;
 if(k<1e-7){return 2.0*alpha;}
 var lo:f32=0.0;var hi:f32=1.0/(1.0+k);
 var quantileMass:f32=reflectionGgxMass(hi,k)*0.5;
 // Sixteen bisections resolve the CDF interval to 1/65536; no rays are cast here.
 for(var step:i32=0;step<16;step++){
  var u:f32=(lo+hi)*0.5;
  if(reflectionGgxMass(u,k)<quantileMass){lo=u;}else{hi=u;}
 }
 var u:f32=(lo+hi)*0.5;
 var cosine:f32=(1.0-(k+1.0)*u)/(1.0+(k-1.0)*u);
 return sqrt(max(0.0,1.0-cosine*cosine))/max(cosine,1e-6);
}
fn reflectionConeSection(c:vec4f,d:vec4f,e:vec4f,reach:f32,t:f32,basis:vec4f,slope:f32,size:vec2f)->vec4f{
 var distance:f32=reach*t*c.w/(e.w*(1.0-t)+c.w*t);
 var centre:vec4f=c+d*distance;
 var spread:vec4f=basis*distance*slope;
 var nearW:f32=max(centre.w-spread.w,1e-6);
 var footprint:vec2f=(spread.xy+abs(centre.xy/centre.w)*spread.w)/nearW*size*0.5;
 return vec4f(footprint,(spread.z+abs(centre.z/centre.w)*spread.w)/nearW,0.0);
}
fn reflectionConeLimits(z0:f32,z1:f32,spread:f32)->vec2f{
 return vec2f(min(z0,z1)-spread,max(z0,z1)+spread);
}
fn screenReflectionCone(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec4f{${REFLECTION_SEGMENT}
 var T:vec3f=reflectionTangent(R);var B:vec3f=cross(R,T);
 var projectedT:vec4f=reflectionProject(vec4f(T,0.0));
 var projectedB:vec4f=reflectionProject(vec4f(B,0.0));
 var basis:vec4f=sqrt(projectedT*projectedT+projectedB*projectedB);
 var slope:f32=reflectionConeSlope(rough);
 var receiver:vec4f=reflectionReceiverPlane(c,N,start,a.z);
 var pixels:f32=max(max(abs(delta.x),abs(delta.y)),1e-6);
 var top:i32=i32(reflectionLastMip());
 var entered:f32=0.0;
 var coarse:i32=0;
 // A block found to hold something, and how far along the axis it reaches: no block of its level
 // or above is tried again before the axis leaves it.
 var blockedLevel:i32=0;var blockedUntil:f32=0.0;var backoff:f32=1.0;
 // The section where the axis stands, and its level, kept while the axis does not move.
 var section:vec4f=vec4f(0.0);var level:i32=0;var sectionAt:f32=-1.0;
 for(var iteration:i32=0;iteration<i32(size.x+size.y)+2;iteration++){
  var at:vec2f=start+delta*entered;
  var pixel:vec2i=vec2i(floor(at));
  if(any(pixel<vec2i(0))||any(pixel>=vec2i(size))){break;}
  if(entered!=sectionAt){
   section=reflectionConeSection(c,d,e,reach,entered,basis,slope,size);
   level=i32(clamp(ceil(log2(max(1.0,2.0*max(section.x,section.y)))),0.0,f32(top)));
   sectionAt=entered;
  }
  if(entered<blockedUntil){coarse=min(coarse,blockedLevel-1);}
  var z0:f32=mix(a.z,b.z,entered);
  if(coarse>level){
   // A coarser block of cells round the axis, half a cell each way: where none of its four can
   // hold what the cone meets until the axis has moved as far as the cone's section allows within
   // it, that stretch is passed whole and the next block taken a level up; else a level down.
   var halfSide:f32=0.5*exp2(f32(coarse));
   var far:f32=min(1.0,entered+halfSide/pixels);
   var farSection:vec4f=reflectionConeSection(c,d,e,reach,far,basis,slope,size);
   var room:f32=halfSide-max(max(farSection.x,farSection.y),0.5);
   // A block that does not outrun a cell of the cone's own level is not tried: a step there.
   if(room<=exp2(f32(level))){coarse=level;continue;}
   var next:f32=min(1.0,entered+room/pixels);
   var limits:vec2f=reflectionConeLimits(z0,mix(a.z,b.z,next),farSection.z);
   if(reflectionConeCell(at,vec2f(halfSide),coarse,limits,receiver,start,false).a==0.0){
    if(next>=1.0){break;}
    entered=next;coarse=min(coarse+1,top);backoff=1.0;
    continue;
   }
   blockedLevel=coarse;blockedUntil=entered+(far-entered)*backoff;backoff*=2.0;
   coarse-=1;
   continue;
  }
  var side:f32=exp2(f32(level));
  var cell:vec2f=floor(at/side);
  var boundary:vec2f=vec2f(1e30);
  if(delta.x>0.0){boundary.x=((cell.x+1.0)*side-start.x)/delta.x;}
  if(delta.x<0.0){boundary.x=(cell.x*side-start.x)/delta.x;}
  if(delta.y>0.0){boundary.y=((cell.y+1.0)*side-start.y)/delta.y;}
  if(delta.y<0.0){boundary.y=(cell.y*side-start.y)/delta.y;}
  var exited:f32=min(1.0,min(boundary.x,boundary.y));
  var limits:vec2f=reflectionConeLimits(z0,mix(a.z,b.z,exited),section.z);
  if(!all(pixel==vec2i(floor(start)))){
   var hit:vec4f=reflectionConeCell(at,section.xy,level,limits,receiver,start,true);
   if(hit.a>0.0){return hit;}
  }
  if(exited>=1.0){break;}
  // The next representable screen fraction avoids re-entering a cell boundary.
  entered=max(exited,entered)+1e-7;
  coarse=min(level+2,top);
 }
 return vec4f(0.0);
}`,
    language,
  ).replace('all(pixel==ivec2(floor(start)))', 'all(equal(pixel,ivec2(floor(start))))')
}
