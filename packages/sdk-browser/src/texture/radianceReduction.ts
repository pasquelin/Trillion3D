import { shaderLanguage } from '../math/shaderLanguage.ts';
/** Unlike material alpha coverage, reflected radiance averages all four channels.
 * The last cell owns an odd source tail. Weights count original pixels, so a
 * bright edge is neither discarded nor overweighted by later reductions. */
export const RADIANCE_REDUCTION_WGSL = `
fn radianceReduction(pixel:vec2i)->vec4f{
 var sourceSize:vec2i=vec2i(extent.xy);
 var destination:vec2i=max(sourceSize/2,vec2i(1));
 var start:vec2i=pixel*2;
 var end:vec2i=min(start+vec2i(2),sourceSize);
 if(pixel.x==destination.x-1){end.x=sourceSize.x;}
 if(pixel.y==destination.y-1){end.y=sourceSize.y;}
 var original:vec2f=vec2f(extent.zw);
 var level:f32=floor(log2(max(original.x/f32(sourceSize.x),original.y/f32(sourceSize.y))));
 var step:f32=exp2(level);
 var sum:vec4f=vec4f(0.0);var area:f32=0.0;var range:vec2f=vec2f(1.0,0.0);
 for(var y:i32=start.y;y<end.y;y++){
  for(var x:i32=start.x;x<end.x;x++){
   var p:vec2i=vec2i(x,y);var a:vec2f=vec2f(p)*step;
   var b:vec2f=min(a+vec2f(step),original);
   if(x==sourceSize.x-1){b.x=original.x;}
   if(y==sourceSize.y-1){b.y=original.y;}
   var weight:f32=(b.x-a.x)*(b.y-a.y);
   var value:vec4f=mipRead(p);
   range=vec2f(min(range.x,value.x),max(range.y,value.y));
   sum+=value*weight;area+=weight;
  }
 }
 if(bounds){return vec4f(range,0.0,1.0);}
 return sum/area;
}`;

export const RADIANCE_REDUCTION_GLSL = shaderLanguage(RADIANCE_REDUCTION_WGSL, 'glsl');
