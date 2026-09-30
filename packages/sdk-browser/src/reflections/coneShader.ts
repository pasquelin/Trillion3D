import { shaderLanguage } from '../math/shaderLanguage.ts';
import { REFLECTION_SEGMENT } from './traceShader.ts';

/** Screen-space cone tracing (Hermanns/Franke, SIGGRAPH 2014).
 * The cone contains half the N.L-weighted GGX directional mass; it is a finite
 * prefilter approximation, not an exact quadrature of the unbounded GGX tail.
 * Its footprint grows in world units before projection, and depth intervals are
 * tested while tracing. A mip of the mirror hit alone is not a cone trace.
 * https://www.tobias-franke.eu/publications/hermanns14ssct/index.html */
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
fn screenReflectionCone(P:vec3f,R:vec3f,rough:f32)->vec4f{${REFLECTION_SEGMENT}
 var axis:vec3f=vec3f(0.0,0.0,1.0);
 if(abs(R.z)>0.999){axis=vec3f(0.0,1.0,0.0);}
 var T:vec3f=normalize(cross(axis,R));var B:vec3f=cross(R,T);
 var projectedT:vec4f=reflectionProject(vec4f(T,0.0));
 var projectedB:vec4f=reflectionProject(vec4f(B,0.0));
 var slope:f32=reflectionConeSlope(rough);
 var entered:f32=0.0;
 for(var iteration:i32=0;iteration<i32(size.x+size.y)+2;iteration++){
  var at:vec2f=start+delta*entered;
  var pixel:vec2i=vec2i(floor(at));
  if(any(pixel<vec2i(0))||any(pixel>=vec2i(size))){break;}
  var distance:f32=reach*entered*c.w/(e.w*(1.0-entered)+c.w*entered);
  var centre:vec4f=c+d*distance;
  var radius:f32=distance*slope;
  // Axis-aligned enclosure of the projected disk, with its homogeneous denominator.
  var spread:vec4f=sqrt(projectedT*projectedT+projectedB*projectedB)*radius;
  var nearW:f32=max(centre.w-spread.w,1e-6);
  var footprint:vec2f=(spread.xy+abs(centre.xy/centre.w)*spread.w)/nearW*size*0.5;
  var level:i32=i32(clamp(ceil(log2(max(1.0,2.0*max(footprint.x,footprint.y)))),0.0,reflectionLastMip()));
  var side:f32=exp2(f32(level));
  var cell:vec2f=floor(at/side);
  var boundary:vec2f=vec2f(1e30);
  if(delta.x>0.0){boundary.x=((cell.x+1.0)*side-start.x)/delta.x;}
  if(delta.x<0.0){boundary.x=(cell.x*side-start.x)/delta.x;}
  if(delta.y>0.0){boundary.y=((cell.y+1.0)*side-start.y)/delta.y;}
  if(delta.y<0.0){boundary.y=(cell.y*side-start.y)/delta.y;}
  var exited:f32=min(1.0,min(boundary.x,boundary.y));
  var z0:f32=mix(a.z,b.z,entered);
  var z1:f32=mix(a.z,b.z,exited);
  var zSpread:f32=(spread.z+abs(centre.z/centre.w)*spread.w)/nearW;
  var limits:vec2f=vec2f(min(z0,z1)-zSpread,max(z0,z1)+zSpread);
  if(!all(pixel==vec2i(floor(start)))){
   var hit:vec4f=reflectionConeCell(at,footprint,level,limits);
   if(hit.a>0.0){return hit;}
  }
  if(exited>=1.0){break;}
  // The next representable screen fraction avoids re-entering a cell boundary.
  entered=max(exited,entered)+1e-7;
 }
 return vec4f(0.0);
}`,
    language,
  ).replace('all(pixel==ivec2(floor(start)))', 'all(equal(pixel,ivec2(floor(start))))');
}
