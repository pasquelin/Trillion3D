/** Depth reads a rough reflection ray may spend, whatever the resolution or the scene (#33): the
 *  cost of a rough pixel is fixed, never the projected ray's length in pixels. */
export const ROUGH_TRACE_READS = 16;

/**
 * The rough trace's screen march. A mirror walks every pixel its ray crosses (`traceShader.ts`); a
 * rough sample is one of many a history averages, so it spends a fixed budget instead: one read per
 * pixel crossed while the segment is short, then the budget spread evenly over it, offset by the
 * frame's `jitter` in (0, 1] so the history covers the gaps between reads. Each read tests the
 * ray's depth interval since the previous one, the same interval rule as the mirror's walk; the
 * adapters are the mirror's (`screenWgsl.ts`).
 */
export const ROUGH_TRACE_WGSL = `
fn roughMarch(start:vec2f,delta:vec2f,za:f32,zb:f32,size:vec2f,jitter:f32)->vec4f{
 let origin=vec2i(floor(start));
 let reads=clamp(ceil(max(abs(delta.x),abs(delta.y))),1.0,${ROUGH_TRACE_READS}.0);
 var entered:f32=0.0;
 for(var i:i32=0;i<${ROUGH_TRACE_READS};i++){
  if(f32(i)>=reads){break;}
  let exited=min(1.0,(f32(i)+jitter)/reads);
  let pixel=vec2i(floor(start+delta*exited));
  if(any(pixel<vec2i(0))||any(pixel>=vec2i(size))){break;}
  if(!all(pixel==origin)){
   let z=reflectionDepthAt(pixel);
   let before=mix(za,zb,entered);let after=mix(za,zb,exited);
   if(z!=reflectionClearDepth()&&z>=min(before,after)&&z<=max(before,after)){
    return vec4f(reflectionColorAt(pixel),1.0);
   }
  }
  entered=exited;
 }
 return vec4f(0.0);
}
fn roughScreenReflection(P:vec3f,R:vec3f,jitter:f32)->vec4f{
 let c=reflectionProject(vec4f(P,1.0));
 let d=reflectionProject(vec4f(R,0.0));
 let reach=reflectionExit(c,d);
 if(reach<=0.0||c.w<=0.0){return vec4f(0.0);}
 let e=c+d*reach;
 if(e.w<=0.0){return vec4f(0.0);}
 let size=reflectionSize();
 let a=c.xyz/c.w;let b=e.xyz/e.w;
 return roughMarch((a.xy*0.5+vec2f(0.5))*size,(b.xy-a.xy)*0.5*size,a.z,b.z,size,jitter);
}`;
