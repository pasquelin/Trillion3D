import { LIGHT_KIND } from '../../../../sdk-core/src/index.ts'
import { MODEL_FLAG } from '../../scene/surfaceModel.ts'
import { LTC_SIZE } from '../../../../sdk-core/src/lighting/ltcTable.ts'
import { INVERSE_TWO_PI, PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  f0Of,
  lambertAlbedoMul,
  ndotvClamped,
  splitSumTerm,
} from '../../../../math/src/wgsl/lighting.ts'
import { tangentSide } from '../../../../math/src/wgsl/basis.ts'
import { bilinear4 } from '../../../../math/src/wgsl/sampling.ts'

/**
 * A RECTANGULAR LIGHT, one-sided: a Lambertian rectangle of uniform radiance L, centred on
 * `positionRange.xyz`, emitting along `directionCone.xyz`, with `shape.xyz` its half-width axis
 * and `shape.w` its half height (`packages/sdk-core/src/scene/light/fields.ts`). No cast shadow.
 *
 * Both lobes are integrated over the rectangle in closed form with linearly transformed cosines
 * (a cosine bent by a 3x3 matrix still integrates in closed form over a polygon). The integral of a clamped cosine over a polygon is its vector form
 * factor F = (1/2π) Σ θ_i γ̂_i over the edges (Lambert), θ_i the angle an edge subtends and γ̂_i the unit normal of the plane through the
 * point and that edge. Each term reads its edge as the difference of its corners, whole even for
 * a light far away (two close f32 corners subtract exactly), and its angle as
 * atan2(|p × e|, p·q), never acos of the dot of two unit corners nor their cross, which lose the
 * angle a far edge subtends (up to 59 % off at 1 000 sizes away). A polygon cut by the
 * horizon is clipped to it, exactly: each edge cut where it crosses,
 * the outline closed by the horizon's arc from where it leaves to where it comes back, an arc whose
 * plane is the horizon's own. Whole above, the form factor is F·z; whole below, zero.
 * - Diffuse: the cosine itself — the rectangle as it is, around the normal: exact.
 * - Specular: the engine's GGX lobe, Fresnel apart, is the cosine seen through the matrix M
 *   fitted for its roughness and view angle (`scripts/ltc-fit.ts`, `ltcTable.ts`); the rectangle, in the
 *   frame of the normal and the view, is moved by M⁻¹ and integrated the same way, then weighed
 *   by the lobe's magnitude and its Fresnel share: F0·norm + (1 − F0)·share.
 *
 * The range windows the energy exactly like a point light's, from the centre, so that the
 * tile lists that cull by the range sphere stay exact.
 */
export const RECT_LIGHT_WGSL = wgslBlock(
  'RECT_LIGHT_WGSL',
  [INVERSE_TWO_PI, PI],
  `
const KIND_RECT:f32=${LIGHT_KIND.rect}.0;
fn isRect(light:DirectLight)->bool{return abs(light.params.x-KIND_RECT)<0.5;}
/** One edge's term of the vector form factor, seen from the point: the edge from p along e, of
 *  which the share \`part\` (whole: 1) lies above the horizon, \`along\` the dot of its ends there. */
fn rectEdge(p:vec3f,e:vec3f,part:f32,along:f32)->vec3f{
 let c=cross(p,e);let cc=dot(c,c);let r=inverseSqrt(cc);
 return c*select(0.0,atan2(part*cc*r,along)*r,cc>0.0);
}
/** A cut outline's vector form factor so far, and where it leaves the horizon and comes back. */
struct Outline{F:vec3f,exit:vec3f,entry:vec3f,}
/** The edge p q, its ends at heights hp and hq over the horizon, cut to the part above it. */
fn cutEdge(o:Outline,p:vec3f,q:vec3f,hp:f32,hq:f32)->Outline{
 let e=q-p;let t=select(0.0,hp/(hp-hq),(hp>0.0)!=(hq>0.0));
 let s0=select(t,0.0,hp>0.0);let s1=select(t,1.0,hq>0.0);
 let u=p+s0*e;let v=p+s1*e;
 return Outline(o.F+rectEdge(p,e,s1-s0,dot(u,v)),select(o.exit,v,hp>0.0&&hq<=0.0),select(o.entry,u,hp<=0.0&&hq>0.0));
}
/** The vector form factor of the quadrilateral a b c d — its corners relative to the point —
 *  unit, and its form factor clipped by the horizon of the unit \`up\`. */
fn polygonFormFactor(a:vec3f,b:vec3f,c:vec3f,d:vec3f,up:vec3f)->vec4f{
 let h=vec4f(dot(a,up),dot(b,up),dot(c,up),dot(d,up));
 if(all(h<=vec4f(0.0))){return vec4f(0.0);}
 var F:vec3f;
 if(all(h>vec4f(0.0))){
  F=rectEdge(a,b-a,1.0,dot(a,b))+rectEdge(b,c-b,1.0,dot(b,c))+rectEdge(c,d-c,1.0,dot(c,d))+rectEdge(d,a-d,1.0,dot(d,a));
 }else{
  var o=Outline(vec3f(0.0),vec3f(0.0),vec3f(0.0));
  o=cutEdge(o,a,b,h.x,h.y);o=cutEdge(o,b,c,h.y,h.z);o=cutEdge(o,c,d,h.z,h.w);o=cutEdge(o,d,a,h.w,h.x);
  // The arc lies on the rectangle's side of the horizon, that of k (the corners wind about it):
  // past a right angle it passes k, and turns from the exit toward it, a sign no rounding flips
  // when exit and entry are near opposite (a point near the rectangle's plane).
  let k=cross(b-a,d-a);let x=dot(o.exit,o.entry);let y=dot(cross(o.exit,o.entry),up);
  let turn=select(y,select(-1.0,1.0,dot(cross(o.exit,k),up)>=0.0)*abs(y),x<0.0);
  F=o.F+up*atan2(turn,x);
 }
 // Wound either way, the polygon's F faces it, F·up its form factor: both read the sign. The
 // 1/2π scales the form factor alone: the direction drops it.
 let E=dot(F,up)*INVERSE_TWO_PI;let ll=dot(F,F);
 if(!(ll>0.0)){return vec4f(0.0);}
 return vec4f(F*(sign(E)*inverseSqrt(ll)),abs(E));
}
/** The rectangle's corners relative to P, and its range window there; a zero window behind its
 *  face or beyond its range. The centre is taken relative to P first: a corner then rounds at the
 *  light's distance, not at its world position's. */
struct RectView{a:vec3f,b:vec3f,c:vec3f,d:vec3f,window:f32,}
fn rectView(light:DirectLight,P:vec3f)->RectView{
 let o=light.positionRange.xyz-P;let n=light.directionCone.xyz;
 let U=light.shape.xyz;let W=normalize(cross(U,n))*light.shape.w;
 let window=select(rangeWindow(length(o),light.positionRange.w),0.0,dot(o,n)>=0.0);
 return RectView(o-U-W,o+U-W,o+U+W,o-U+W,window);
}
/** Direction of the vector form factor and the rectangle's irradiance per unit radiance at P
 *  for the normal N: π times its clipped form factor, range windowed. */
fn rectIrradiance(light:DirectLight,P:vec3f,N:vec3f)->vec4f{return rectIrradianceOf(rectView(light,P),N);}
/** The same, of the rectangle's view \`r\` at P: what a caller that holds it reads again. */
fn rectIrradianceOf(r:RectView,N:vec3f)->vec4f{
 if(r.window<=0.0){return vec4f(0.0);}
 let f=polygonFormFactor(r.a,r.b,r.c,r.d,N);
 return vec4f(f.xyz,PI*f.w*r.window);
}`,
)

/** The rectangle's fitted lobe at (roughness, cos θ_v): bilinear over the table's cells, texel
 *  \`k\` 0 for M⁻¹'s entries, 1 for the lobe's magnitude and Fresnel share (\`ltcTable.ts\`). */
const LTC_WGSL = wgslBlock(
  'LTC_WGSL',
  [],
  `
const LTC_SIZE:u32=${LTC_SIZE}u;
fn ltcTexel(x:u32,y:u32,k:u32)->vec4f{return directLights.ltc[(y*LTC_SIZE+x)*2u+k];}
fn ltcLookup(rough:f32,NdotV:f32,k:u32)->vec4f{
 let at=vec2f(clamp(rough,0.0,1.0),sqrt(clamp(1.0-NdotV,0.0,1.0)))*f32(LTC_SIZE-1u);
 let i=min(vec2u(at),vec2u(LTC_SIZE-2u));let f=at-vec2f(i);
 return bilinear4(ltcTexel(i.x,i.y,k),ltcTexel(i.x+1u,i.y,k),ltcTexel(i.x,i.y+1u,k),ltcTexel(i.x+1u,i.y+1u,k),f);
}`,
)

/** The shading of a rectangle at a surface point, colour and intensity included: the diffuse of
 *  its exact irradiance, the specular of its fitted lobe. */
export const RECT_SHADING_WGSL = wgslBlock(
  'RECT_SHADING_WGSL',
  [PI, f0Of, lambertAlbedoMul, ndotvClamped, splitSumTerm, tangentSide, bilinear4, LTC_WGSL],
  `
/** A corner in the frame (T1, T2, N) moved by M⁻¹ = [[m.x, 0, m.y], [0, 1, 0], [m.z, 0, m.w]]. */
fn ltcCorner(q:vec3f,T1:vec3f,T2:vec3f,N:vec3f,m:vec4f)->vec3f{
 let x=dot(q,T1);let z=dot(q,N);
 return vec3f(m.x*x+m.y*z,dot(q,T2),m.z*x+m.w*z);
}
/** The rectangle's fitted specular lobe at the normal \`N\`, of reflectance \`f0\`, per unit
 *  radiance and before its range window: the polygon of its view \`r\` moved by M⁻¹ in the frame of
 *  the normal and the view, integrated, weighed by the lobe's magnitude and Fresnel share. */
fn rectLtc(r:RectView,N:vec3f,V:vec3f,f0:vec3f,rough:f32)->vec3f{
 let NdotV=ndotvClamped(N,V);
 let side=V-N*dot(N,V);
 let other=tangentSide(N);
 let T1=normalize(select(side,other,dot(side,side)<1e-10));let T2=cross(N,T1);
 let m=ltcLookup(rough,NdotV,0u);let t=ltcLookup(rough,NdotV,1u);
 let lobe=polygonFormFactor(ltcCorner(r.a,T1,T2,N,m),ltcCorner(r.b,T1,T2,N,m),ltcCorner(r.c,T1,T2,N,m),ltcCorner(r.d,T1,T2,N,m),vec3f(0.0,0.0,1.0)).w;
 return splitSumTerm(f0,t)*lobe;
}
fn rectLight(light:DirectLight,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32)->vec3f{
 let r=rectView(light,P);
 let incident=rectIrradianceOf(r,N);
 if(incident.w<=0.0){return vec3f(0.0);}
 let E=light.colorIntensity.w*incident.w;
 let tint=light.colorIntensity.rgb;
 // E already carries the cosine: the diffuse model takes it whole, at a unit N·L.
 if(surfaceModel==${MODEL_FLAG.diffuse}u){return modelLight(rgb,metal,N,N,E,ao)*tint;}
 // Toon bands the cosine toward the form factor, on the irradiance of a face turned to it:
 // bounded by π, as a lamp's energy is by its falloff.
 if(surfaceModel==${MODEL_FLAG.toon}u){
  let facing=light.colorIntensity.w*PI*polygonFormFactor(r.a,r.b,r.c,r.d,incident.xyz).w*r.window;
  return modelLight(rgb,metal,N,incident.xyz,facing,ao)*tint;
 }
 let specular=rectLtc(r,N,V,f0Of(rgb,metal),rough)*light.colorIntensity.w*r.window;
 return (lambertAlbedoMul(rgb,metal)*E+specular)*tint;
}`,
)
