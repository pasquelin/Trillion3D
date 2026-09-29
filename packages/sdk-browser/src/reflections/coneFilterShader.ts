import { shaderLanguage } from './traceShader.ts';

/** Up to four mip cells enclose a cone section; integrate their covered areas.
 * The depth range rejects empty or disjoint cells, rather than treating the
 * farthest occlusion depth as a first-hit boundary. */
export function reflectionConeFilterShader(language: 'wgsl' | 'glsl') {
  return shaderLanguage(
    `
fn reflectionConeCell(at:vec2f,footprint:vec2f,level:i32,limits:vec2f)->vec4f{
 var side:f32=exp2(f32(level));
 var radius:vec2f=max(footprint,vec2f(0.5));
 var low:vec2f=max(at-radius,vec2f(0.0));
 var high:vec2f=min(at+radius,reflectionSize());
 var origin:vec2i=vec2i(floor(low/side));
 var total:f32=4.0*radius.x*radius.y;
 var sum:vec4f=vec4f(0.0);
 for(var y:i32=0;y<2;y++){
  for(var x:i32=0;x<2;x++){
   var pixel:vec2i=origin+vec2i(x,y);
   var begin:vec2f=vec2f(pixel)*side;
   var overlap:vec2f=max(vec2f(0.0),min(high,begin+vec2f(side))-max(low,begin));
   var area:f32=overlap.x*overlap.y;
   if(area>0.0){
    var range:vec2f=reflectionBoundsAt(pixel,level);
    if(range.x<=range.y&&range.x<=limits.y&&range.y>=limits.x){
     sum+=reflectionMipColorAt(pixel,level)*area;
    }
   }
  }
 }
 return sum/max(total,1.0);
}`,
    language,
  );
}
