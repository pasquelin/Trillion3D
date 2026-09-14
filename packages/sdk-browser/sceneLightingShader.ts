/** Requires STANDARD_LIGHTING_WGSL. Binding is chosen by the consuming pass. */
export const SCENE_LIGHTING_WGSL = `
struct SceneLight{positionKind:vec4f,colorIntensity:vec4f,directionRange:vec4f,groundDecay:vec4f,spot:vec4f,}
struct SceneLights{count:u32,pad0:u32,pad1:u32,pad2:u32,items:array<SceneLight>,}
fn sceneLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32)->vec3f{
 var result=vec3f(0.0);
 let diffuse=rgb*(1.0-metal)/3.14159265;
 for(var i=0u;i<sceneLights.count;i++){
  let light=sceneLights.items[i];let kind=u32(light.positionKind.w);
  let color=light.colorIntensity.rgb;let intensity=light.colorIntensity.w;
  if(kind==0u){result+=diffuse*color*intensity*ao;continue;}
  if(kind==4u){result+=diffuse*mix(light.groundDecay.rgb,color,dot(N,light.directionRange.xyz)*0.5+0.5)*intensity*ao;continue;}
  var L=light.directionRange.xyz;var attenuation=1.0;
  if(kind==2u||kind==3u){
   let offset=light.positionKind.xyz-P;let distance=length(offset);L=offset/max(distance,1e-6);
   attenuation=1.0/max(pow(distance,light.groundDecay.w),0.01);
   if(light.directionRange.w>0.0){let ratio=distance/light.directionRange.w;attenuation*=pow(clamp(1.0-pow(ratio,4.0),0.0,1.0),2.0);}
   if(kind==3u){let angleCos=dot(L,light.directionRange.xyz);var cone=step(light.spot.x,angleCos);if(light.spot.y>light.spot.x){cone=smoothstep(light.spot.x,light.spot.y,angleCos);}attenuation*=cone;}
  }
  result+=standardLighting(rgb,metal,rough,N,V,vec4f(L,intensity*attenuation),vec3f(0.0),vec3f(0.0),ao)*color;
 }
 return result;
}`;
