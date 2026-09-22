import { LIGHT_KIND } from '../sdk-core/index.ts';
import { MODEL_FLAG } from './surfaceModel.ts';
import { LTC_SIZE } from '../sdk-core/ltcTable.ts';
import { INVERSE_PI, INVERSE_TWO_PI, PI } from './shaderConstants.ts';

/**
 * A RECTANGULAR LIGHT, one-sided: a Lambertian rectangle of uniform radiance L, centred on
 * `positionRange.xyz`, emitting along `directionCone.xyz`, with `shape.xyz` its half-width axis
 * and `shape.w` its half height (`sceneLightFields.ts`). No cast shadow.
 *
 * Both lobes are integrated over the rectangle in closed form with linearly transformed cosines
 * (Heitz, Dupuy, Hill and Neubelt 2016, "Real-time polygonal-light shading with linearly
 * transformed cosines"). The integral of a clamped cosine over a polygon is its vector form
 * factor F = (1/2π) Σ θ_i γ̂_i over the edges (Lambert; Arvo 1995, "Applications of irradiance
 * tensors"), θ_i the angle an edge subtends and γ̂_i the unit normal of the plane through the
 * point and that edge; a polygon cut by the horizon is integrated as the sphere of the same
 * vector form factor clipped by it (Heitz 2017, "Geometric derivation of the irradiance of
 * polygonal lights"): (|F|² + F·z) / (|F| + 1), exactly F·z when it is whole above.
 * - Diffuse: the cosine itself — the rectangle as it is, around the normal: exact.
 * - Specular: the engine's GGX lobe, Fresnel apart, is the cosine seen through the matrix M
 *   fitted for its roughness and view angle (`scripts/ltc-fit.ts`, `ltcTable.ts`); the rectangle, in the
 *   frame of the normal and the view, is moved by M⁻¹ and integrated the same way, then weighed
 *   by the lobe's magnitude and its Schlick share: F0·norm + (1 − F0)·share.
 *
 * The range windows the energy exactly like a point light's, from the centre, so that the
 * tile lists that cull by the range sphere stay exact.
 */
export const RECT_LIGHT_WGSL = `
const KIND_RECT:f32=${LIGHT_KIND.rect}.0;
fn isRect(light:DirectLight)->bool{return abs(light.params.x-KIND_RECT)<0.5;}
/** One edge's term of the vector form factor, seen from the point: a and b unit. */
fn rectEdge(a:vec3f,b:vec3f)->vec3f{
 let c=cross(a,b);let s=length(c);
 let theta=acos(clamp(dot(a,b),-1.0,1.0));
 return c*select(1.0,theta/s,s>1e-7);
}
/** The vector form factor of the quadrilateral a b c d — its corners relative to the point —
 *  unit, and its form factor clipped by the horizon of \`up\`. */
fn polygonFormFactor(a:vec3f,b:vec3f,c:vec3f,d:vec3f,up:vec3f)->vec4f{
 let na=normalize(a);let nb=normalize(b);let nc=normalize(c);let nd=normalize(d);
 var F=(rectEdge(na,nb)+rectEdge(nb,nc)+rectEdge(nc,nd)+rectEdge(nd,na))*${INVERSE_TWO_PI};
 if(dot(F,a+c)<0.0){F=-F;}
 let l=length(F);
 if(!(l>0.0)){return vec4f(0.0);}
 return vec4f(F/l,max((l*l+dot(F,up))/(l+1.0),0.0));
}
/** The rectangle's corners relative to P, and its range window there; a zero window behind its
 *  face or beyond its range. */
struct RectView{a:vec3f,b:vec3f,c:vec3f,d:vec3f,window:f32,}
fn rectView(light:DirectLight,P:vec3f)->RectView{
 let C=light.positionRange.xyz;let n=light.directionCone.xyz;
 let U=light.shape.xyz;let W=normalize(cross(U,n))*light.shape.w;
 let window=select(rangeWindow(length(C-P),light.positionRange.w),0.0,dot(P-C,n)<=0.0);
 return RectView(C-U-W-P,C+U-W-P,C+U+W-P,C-U+W-P,window);
}
/** Direction of the vector form factor and the rectangle's irradiance per unit radiance at P
 *  for the normal N: π times its clipped form factor, range windowed. */
fn rectIrradiance(light:DirectLight,P:vec3f,N:vec3f)->vec4f{
 let r=rectView(light,P);
 if(r.window<=0.0){return vec4f(0.0);}
 let f=polygonFormFactor(r.a,r.b,r.c,r.d,N);
 return vec4f(f.xyz,${PI}*f.w*r.window);
}`;

/** The rectangle's fitted lobe at (roughness, cos θ_v): bilinear over the table's cells, texel
 *  \`k\` 0 for M⁻¹'s entries, 1 for the lobe's magnitude and Schlick share (\`ltcTable.ts\`). */
const LTC_WGSL = `
const LTC_SIZE:u32=${LTC_SIZE}u;
fn ltcTexel(x:u32,y:u32,k:u32)->vec4f{return directLights.ltc[(y*LTC_SIZE+x)*2u+k];}
fn ltcLookup(rough:f32,NdotV:f32,k:u32)->vec4f{
 let at=vec2f(clamp(rough,0.0,1.0),sqrt(clamp(1.0-NdotV,0.0,1.0)))*f32(LTC_SIZE-1u);
 let i=min(vec2u(at),vec2u(LTC_SIZE-2u));let f=at-vec2f(i);
 let low=mix(ltcTexel(i.x,i.y,k),ltcTexel(i.x+1u,i.y,k),f.x);
 return mix(low,mix(ltcTexel(i.x,i.y+1u,k),ltcTexel(i.x+1u,i.y+1u,k),f.x),f.y);
}`;

/** The shading of a rectangle at a surface point, colour and intensity included: the diffuse of
 *  its exact irradiance, the specular of its fitted lobe. */
export const RECT_SHADING_WGSL = `
${LTC_WGSL}
/** A corner in the frame (T1, T2, N) moved by M⁻¹ = [[m.x, 0, m.y], [0, 1, 0], [m.z, 0, m.w]]. */
fn ltcCorner(q:vec3f,T1:vec3f,T2:vec3f,N:vec3f,m:vec4f)->vec3f{
 let x=dot(q,T1);let z=dot(q,N);
 return vec3f(m.x*x+m.y*z,dot(q,T2),m.z*x+m.w*z);
}
fn rectLight(light:DirectLight,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32)->vec3f{
 let incident=rectIrradiance(light,P,N);
 if(incident.w<=0.0){return vec3f(0.0);}
 let E=light.colorIntensity.w*incident.w;
 let tint=light.colorIntensity.rgb;
 if(surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){
  return modelLight(rgb,metal,N,incident.xyz,E/max(dot(N,incident.xyz),1e-4),ao)*tint;
 }
 let r=rectView(light,P);
 let NdotV=clamp(dot(N,V),1e-4,1.0);
 let side=V-N*dot(N,V);
 let other=cross(N,select(vec3f(1.0,0.0,0.0),vec3f(0.0,1.0,0.0),abs(N.x)>0.9));
 let T1=normalize(select(side,other,dot(side,side)<1e-10));let T2=cross(N,T1);
 let m=ltcLookup(rough,NdotV,0u);let t=ltcLookup(rough,NdotV,1u);
 let lobe=polygonFormFactor(ltcCorner(r.a,T1,T2,N,m),ltcCorner(r.b,T1,T2,N,m),ltcCorner(r.c,T1,T2,N,m),ltcCorner(r.d,T1,T2,N,m),vec3f(0.0,0.0,1.0)).w;
 let f0=mix(vec3f(0.04),rgb,metal);
 let specular=(f0*t.x+(vec3f(1.0)-f0)*t.y)*lobe*light.colorIntensity.w*r.window;
 return (rgb*(1.0-metal)*${INVERSE_PI}*E+specular)*tint;
}`;
