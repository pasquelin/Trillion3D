/** Collocated unit-box smoke: semi-Lagrangian transport and pressure projection. */
const header = `struct Step { n:f32, dt:f32, time:f32, pad:f32 };
@group(0) @binding(0) var<uniform> step:Step;
fn cell(p:vec3i)->vec3i { return clamp(p,vec3i(0),vec3i(i32(step.n)-1)); }
fn walls(v:vec3f,p:vec3u)->vec3f {
  var result=v; let last=u32(step.n)-1u;
  if(p.x==0u || p.x==last){result.x=0.0;}
  if(p.y==0u || p.y==last){result.y=0.0;}
  if(p.z==0u || p.z==last){result.z=0.0;}
  return result;
}
`;
const kernel = (bindings: string, body: string) => `${header}${bindings}
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(u32(step.n)))){return;} let p=vec3i(id);
 ${body}
}`;
export const SMOKE_ADVECTION = kernel(
  `
@group(0) @binding(1) var field:texture_3d<f32>;
@group(0) @binding(2) var linearClamp:sampler;
@group(0) @binding(3) var result:texture_storage_3d<rgba16float,write>;`,
  `
 let uv=(vec3f(id)+0.5)/step.n;
 let velocity=textureLoad(field,p,0).xyz;
 var next=textureSampleLevel(field,linearClamp,uv-step.dt*velocity,0.0);
 let delta=uv-vec3f(0.5,0.12,0.5);
 let source=exp(-dot(delta,delta)/0.0064);
 next.w=max(0.0,next.w*exp(-0.15*step.dt)+6.0*source*step.dt);
 next=vec4f(walls(next.xyz+vec3f(0.04*sin(step.time),0.6*next.w,0.0)*step.dt,id),next.w);
 textureStore(result,p,next);
`,
);
export const SMOKE_DIVERGENCE = kernel(
  `
@group(0) @binding(1) var field:texture_3d<f32>;
@group(0) @binding(2) var divergence:texture_storage_3d<r32float,write>;
@group(0) @binding(3) var pressure:texture_storage_3d<r32float,write>;
fn velocity(p:vec3i)->vec3f{return textureLoad(field,cell(p),0).xyz;}`,
  `
 let d=(velocity(p+vec3i(1,0,0)).x-velocity(p-vec3i(1,0,0)).x
       +velocity(p+vec3i(0,1,0)).y-velocity(p-vec3i(0,1,0)).y
       +velocity(p+vec3i(0,0,1)).z-velocity(p-vec3i(0,0,1)).z)*0.5*step.n;
 textureStore(divergence,p,vec4f(d,0.0,0.0,0.0));
 textureStore(pressure,p,vec4f(0.0));
`,
);
export const SMOKE_PRESSURE = kernel(
  `
@group(0) @binding(1) var pressure:texture_3d<f32>;
@group(0) @binding(2) var divergence:texture_3d<f32>;
@group(0) @binding(3) var result:texture_storage_3d<r32float,write>;
fn value(p:vec3i)->f32{return textureLoad(pressure,cell(p),0).x;}`,
  `
 let sum=value(p+vec3i(1,0,0))+value(p-vec3i(1,0,0))
        +value(p+vec3i(0,1,0))+value(p-vec3i(0,1,0))
        +value(p+vec3i(0,0,1))+value(p-vec3i(0,0,1));
 let next=(sum-textureLoad(divergence,p,0).x/(step.n*step.n))/6.0;
 textureStore(result,p,vec4f(next,0.0,0.0,0.0));
`,
);
export const SMOKE_PROJECTION = kernel(
  `
@group(0) @binding(1) var field:texture_3d<f32>;
@group(0) @binding(2) var pressure:texture_3d<f32>;
@group(0) @binding(3) var result:texture_storage_3d<rgba16float,write>;
fn value(p:vec3i)->f32{return textureLoad(pressure,cell(p),0).x;}`,
  `
 let old=textureLoad(field,p,0);
 let gradient=vec3f(value(p+vec3i(1,0,0))-value(p-vec3i(1,0,0)),
                    value(p+vec3i(0,1,0))-value(p-vec3i(0,1,0)),
                    value(p+vec3i(0,0,1))-value(p-vec3i(0,0,1)))*0.5*step.n;
 textureStore(result,p,vec4f(walls(old.xyz-gradient,id),old.w));
`,
);
