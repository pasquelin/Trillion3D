/** Isolated orthographic volume witness: no claim of interleaved scene transparency. */
const view = `struct View { inverse:mat4x4f, size:vec4f, extent:vec4f, params:vec4f };
@group(0) @binding(0) var<uniform> view:View;
struct Vertex { @builtin(position) position:vec4f, @location(0) uv:vec2f };
@vertex fn vertex(@builtin(vertex_index) index:u32)->Vertex {
 let xy=vec2f(f32((index<<1u)&2u),f32(index&2u));
 var output:Vertex; output.position=vec4f(xy*2.0-1.0,0.0,1.0);
 output.uv=vec2f(xy.x,1.0-xy.y); return output;
}
struct Ray { origin:vec3f, direction:vec3f };
fn ray(uv:vec2f)->Ray {
 let xy=vec2f(uv.x*2.0-1.0,1.0-uv.y*2.0);
 // SDK Camera matrices use the OpenGL [-1,+1] clip-depth convention.
 let a=view.inverse*vec4f(xy,-1.0,1.0); let b=view.inverse*vec4f(xy,1.0,1.0);
 let origin=a.xyz/a.w; return Ray(origin,normalize(b.xyz/b.w-origin));
}
fn slab(origin:f32,direction:f32,halfSize:f32)->vec2f {
 if(abs(direction)<1e-7){
   if(abs(origin)>halfSize){return vec2f(1e20,-1e20);}
   return vec2f(-1e20,1e20);
 }
 let a=(-halfSize-origin)/direction; let b=(halfSize-origin)/direction;
 return vec2f(min(a,b),max(a,b));
}
fn bounds(r:Ray)->vec2f {
 let x=slab(r.origin.x,r.direction.x,view.extent.x);
 let y=slab(r.origin.y,r.direction.y,view.extent.y);
 let z=slab(r.origin.z,r.direction.z,view.extent.z);
 return vec2f(max(0.0,max(x.x,max(y.x,z.x))),min(x.y,min(y.y,z.y)));
}
`;
export const SMOKE_RAYMARCH = `${view}
@group(0) @binding(1) var field:texture_3d<f32>;
@group(0) @binding(2) var linearClamp:sampler;
struct March { @location(0) color:vec4f, @location(1) depth:f32 };
@fragment fn fragment(input:Vertex)->March {
 var result:March; result.color=vec4f(0.0); result.depth=1e20;
 let r=ray(input.uv); let hit=bounds(r); if(hit.y<=hit.x){return result;}
 result.depth=hit.x; let stepSize=(hit.y-hit.x)/view.params.x;
 var transmittance=1.0; var color=vec3f(0.0);
 for(var index=0u;index<u32(view.params.x);index++){
   let distance=hit.x+(f32(index)+0.5)*stepSize;
   let position=r.origin+r.direction*distance;
   let uv=position/(2.0*view.extent.xyz)+0.5;
   let density=max(0.0,textureSampleLevel(field,linearClamp,uv,0.0).w);
   let alpha=1.0-exp(-view.params.y*density*stepSize);
   color+=transmittance*alpha*vec3f(0.65,0.7,0.8);
   transmittance*=1.0-alpha;
   if(transmittance<view.params.z){break;}
 }
 result.color=vec4f(color,1.0-transmittance); return result;
}
`;
export const SMOKE_UPSAMPLE = `${view}
@group(0) @binding(1) var halfColor:texture_2d<f32>;
@group(0) @binding(2) var halfDepth:texture_2d<f32>;
@fragment fn fragment(input:Vertex)->@location(0) vec4f {
 let hit=bounds(ray(input.uv)); if(hit.y<=hit.x){return vec4f(0.0);}
 let position=input.uv*view.size.zw-0.5;
 let base=vec2i(floor(position)); let fraction=fract(position);
 let maximum=vec2i(textureDimensions(halfColor))-1;
 var total=0.0; var color=vec4f(0.0);
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){
   let pixel=clamp(base+vec2i(x,y),vec2i(0),maximum);
   let depth=textureLoad(halfDepth,pixel,0).x;
   let spatial=mix(1.0-fraction.x,fraction.x,f32(x))*mix(1.0-fraction.y,fraction.y,f32(y));
   let weight=spatial*exp(-abs(depth-hit.x)*view.params.w);
   color+=textureLoad(halfColor,pixel,0)*weight; total+=weight;
 }}
 if(total>0.0){return color/total;}
 // No low-resolution sample actually entered this subpixel box: do not invent smoke.
 return vec4f(0.0);
}
`;
