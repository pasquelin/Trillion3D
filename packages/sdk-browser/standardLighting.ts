/** Shared opaque/forward lighting. Match the explorer's Three.js standard
 * material with punctual light and hemisphere irradiance, without an envMap. */
export const STANDARD_LIGHTING_WGSL=`
fn standardLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,light:vec4f,sky:vec3f,ground:vec3f,ao:f32)->vec3f{
 let L=normalize(light.xyz);
 let NdotL=max(dot(N,L),0.0);
 let NdotV=max(dot(N,V),1e-4);
 let hemi=mix(ground,sky,N.y*0.5+0.5);
 let direct=light.w*NdotL;
 let H=normalize(L+V);
 let NdotH=max(dot(N,H),0.0);
 let VdotH=max(dot(V,H),0.0);
 let alpha=rough*rough;let alpha2=alpha*alpha;
 let dDenom=NdotH*NdotH*(alpha2-1.0)+1.0;
 let D=alpha2/(3.14159265*dDenom*dDenom);
 let gV=NdotL*sqrt(NdotV*NdotV*(1.0-alpha2)+alpha2);
 let gL=NdotV*sqrt(NdotL*NdotL*(1.0-alpha2)+alpha2);
 let Vis=0.5/(gV+gL+1e-7);
 let f0=mix(vec3f(0.04),rgb,metal);
 let F=f0+(vec3f(1.0)-f0)*pow(clamp(1.0-VdotH,0.0,1.0),5.0);
 let diffuse=rgb*(1.0-metal)/3.14159265;
 return diffuse*(hemi*ao+vec3f(direct))+D*Vis*F*direct;
}`;

export const NORMAL_TRANSFORM_WGSL=`
fn inverseTranspose3(m:mat3x3f,v:vec3f)->vec3f{
 let a=m[0];let b=m[1];let c=m[2];let det=dot(a,cross(b,c));
 if(abs(det)<1e-20){return v;}
 return (1.0/det)*(mat3x3f(cross(b,c),cross(c,a),cross(a,b))*v);
}
fn xformNormal(world:mat4x4f,n:vec3f)->vec3f{
 return normalize(inverseTranspose3(mat3x3f(world[0].xyz,world[1].xyz,world[2].xyz),n));
}`;
