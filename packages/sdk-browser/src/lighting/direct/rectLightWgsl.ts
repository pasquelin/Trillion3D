import { LIGHT_KIND } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { MODEL_FLAG } from '../../materials/surface/surfaceModelWord.ts'
import { SURFACE_MODEL_LIGHT_WGSL } from '../../materials/surface/surfaceModel.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { LTC_SIZE } from '../../../../sdk-core/src/lighting/ltcTable.ts'
import { INVERSE_PI, INVERSE_TWO_PI, PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { horizonWrap, ndotvClamped, splitSumTerm } from '../../../../math/src/wgsl/lighting.ts'
import { tangentSide } from '../../../../math/src/wgsl/basis.ts'
import { faceNormal, vectorRejection } from '../../../../math/src/wgsl/geometry.ts'
import { bilinear4 } from '../../../../math/src/wgsl/sampling.ts'
import { isKind, rangeWindow } from './lightReachWgsl.ts'

/**
 * The colour a rectangle's picture gives where a ray along \`L\` from the point meets the face of the rectangle with corners \`a\`, \`b\` (across), \`d\`
 * (down) relative to the point and atlas slot \`slot\` (x, y, width, height in texels; a width of 0 for none): white for a rectangle with no picture,
 * and for a program that binds no atlas, which keeps this default. A program that binds the atlas lists its own
 * (\`rectSourceWgsl\`, \`../rectLightAtlas/readWgsl.ts\`), which replaces it.
 */
export const RECT_SOURCE_DEFAULT = wgslFn(
  'rectSourceAt',
  [],
  'fn rectSourceAt(slot:vec4f,a:vec3f,b:vec3f,d:vec3f,L:vec3f)->vec3f{return vec3f(1.0);}',
  { weak: true },
)

/**
 * A RECTANGULAR LIGHT, one-sided: a Lambertian rectangle of uniform radiance L, centred on
 * `positionRange.xyz`, emitting along `directionCone.xyz`, with `shape.xyz` its half-width axis
 * and `shape.w` its half height, its shares of diffuse and specular light in `capsule.zw`
 * (`packages/sdk-core/src/scene/light/fields.ts`). Where it casts a
 * shadow (`lightLoopWgsl.ts`), its share of the light is the shadow of its point-light cube, its
 * source radius half its width.
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
 * - Diffuse: the whole rectangle's vector form factor, its length half the irradiance of a face turned
 *   to it and its direction the mean direction of the light, under the cosine of the normal with that
 *   direction wrapped about the horizon of a sphere of the same solid angle (`horizonWrap`): a
 *   rectangle under the horizon still lights, fading to nothing a sphere's radius under it.
 * - Specular: the engine's GGX lobe, Fresnel apart, is the cosine seen through the matrix M
 *   fitted for its roughness and view angle (`scripts/dev/ltc-fit.ts`, `ltcTable.ts`); the rectangle, in the
 *   frame of the normal and the view, is moved by M⁻¹ and integrated the same way, then weighed
 *   by the lobe's magnitude and its Fresnel share: F0·norm + (1 − F0)·share.
 *
 * The range windows the energy exactly like a point light's, from the centre, so that the
 * tile lists that cull by the range sphere stay exact.
 */
export const RECT_LIGHT_WGSL = wgslBlock(
  'RECT_LIGHT_WGSL',
  [INVERSE_PI, INVERSE_TWO_PI, faceNormal, horizonWrap, rangeWindow, isKind, RECT_SOURCE_DEFAULT],
  `
const KIND_RECT:u32=${LIGHT_KIND.rect}u;
fn isRect(light:DirectLight)->bool{return isKind(light,KIND_RECT);}
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
  let k=faceNormal(a,b,d);let x=dot(o.exit,o.entry);let y=dot(cross(o.exit,o.entry),up);
  let turn=select(y,select(-1.0,1.0,dot(cross(o.exit,k),up)>=0.0)*abs(y),x<0.0);
  F=o.F+up*atan2(turn,x);
 }
 // Wound either way, the polygon's F faces it, F·up its form factor: both read the sign. The
 // 1/2π scales the form factor alone: the direction drops it.
 let E=dot(F,up)*INVERSE_TWO_PI;let ll=dot(F,F);
 if(!(ll>0.0)){return vec4f(0.0);}
 return vec4f(F*(sign(E)*inverseSqrt(ll)),abs(E));
}
/** The rectangle's corners relative to P, and its range window there, of a rectangle the light term
 *  let through (\`lightReaches\`: in range, P before its face). The centre is taken relative to P
 *  first: a corner then rounds at the light's distance, not at its world position's. */
struct RectView{a:vec3f,b:vec3f,c:vec3f,d:vec3f,window:f32,slot:vec4f,}
/** Where a rectangle's picture is in the atlas: the origin and the size in texels (\`LIGHT_FIELD.rectAtlasOriginX\`), a width of 0 for none. */
fn rectSlotOf(light:DirectLight)->vec4f{return vec4f(light.capsule.x,light.capsule.y,light.params.w,light.traits.w);}
/** The colour of the rectangle's picture along \`L\`, the way the point sees the rectangle \`r\`: white for none. */
fn rectColour(r:RectView,L:vec3f)->vec3f{return rectSourceAt(r.slot,r.a,r.b,r.d,L);}
fn rectView(light:DirectLight,P:vec3f)->RectView{
 let o=light.positionRange.xyz-P;let n=light.directionCone.xyz;
 let U=light.shape.xyz;let W=normalize(cross(U,n))*light.shape.w;
 let window=rangeWindow(length(o),light.positionRange.w);
 return RectView(o-U-W,o+U-W,o+U+W,o-U+W,window,rectSlotOf(light));
}
/** Direction of the vector form factor and the rectangle's irradiance per unit radiance at P
 *  for the normal N: half the length of its whole vector form factor, times the cosine of N with
 *  its direction wrapped about the horizon of the sphere of that irradiance (sin² α = it over π),
 *  range windowed. */
fn rectIrradiance(light:DirectLight,P:vec3f,N:vec3f)->vec4f{return rectIrradianceOf(rectView(light,P),N);}
/** The same, of the rectangle's view \`r\` at P: what a caller that holds it reads again. */
fn rectIrradianceOf(r:RectView,N:vec3f)->vec4f{
 if(r.window<=0.0){return vec4f(0.0);}
 let form=rectVectorForm(r);
 let size=length(form);
 if(!(size>0.0)){return vec4f(0.0);}
 // The polygon's form factor faces it wound one way and away from it wound the other.
 let toward=form*(select(1.0,-1.0,dot(form,r.a+r.c)<0.0)/size);
 let irradiance=0.5*size;
 return vec4f(toward,irradiance*max(horizonWrap(dot(N,toward),sqrt(irradiance*INVERSE_PI)),0.0)*r.window);
}
/** The vector form factor of the rectangle's view \`r\` at P, whole: each edge's term by the angle it
 *  subtends (\`rectEdge\`). */
fn rectVectorForm(r:RectView)->vec3f{
 return rectEdge(r.a,r.b-r.a,1.0,dot(r.a,r.b))+rectEdge(r.b,r.c-r.b,1.0,dot(r.b,r.c))+rectEdge(r.c,r.d-r.c,1.0,dot(r.c,r.d))+rectEdge(r.d,r.a-r.d,1.0,dot(r.d,r.a));
}
/** The rectangle's integral with no normal, of its view \`r\` at P: half the length of its vector
 *  form factor (\`rectVectorForm\`), before its range window
 *  (\`r.window\`, the caller's). It is the irradiance on a face turned to the rectangle, whole above its
 *  horizon: what a point of a medium, which has no surface, reads of it — a facing patch's solid
 *  angle, \`area / distance²\` far away. */
fn rectFormOf(r:RectView)->f32{return 0.5*length(rectVectorForm(r));}
/** The same, times the range window of the view \`r\`: the energy a point reads of the rectangle where
 *  it has no surface — the volume's, the clouds' — and a shadow catcher's. */
fn rectWindowed(r:RectView)->f32{return rectFormOf(r)*r.window;}`,
)

/** The rectangle's fitted lobe at (roughness, cos θ_v): bilinear over the table's cells, texel
 *  \`k\` 0 for M⁻¹'s entries, 1 for the lobe's magnitude and Fresnel share (\`ltcTable.ts\`): the weight of a
 *  rectangle's specular lobe (\`splitSumTerm\`, \`rectLtc\`). */
const LTC_WGSL = wgslBlock(
  'LTC_WGSL',
  [bilinear4],
  `
const LTC_SIZE:u32=${LTC_SIZE}u;
fn ltcTexel(x:u32,y:u32,k:u32)->vec4f{return directLights.ltc[(y*LTC_SIZE+x)*2u+k];}
fn ltcLookup(rough:f32,NdotV:f32,k:u32)->vec4f{
 let at=vec2f(clamp(rough,0.0,1.0),sqrt(clamp(1.0-NdotV,0.0,1.0)))*f32(LTC_SIZE-1u);
 let i=min(vec2u(at),vec2u(LTC_SIZE-2u));let f=at-vec2f(i);
 return bilinear4(ltcTexel(i.x,i.y,k),ltcTexel(i.x+1u,i.y,k),ltcTexel(i.x,i.y+1u,k),ltcTexel(i.x+1u,i.y+1u,k),f);
}`,
)

/** What a rectangle's shading reads: its fitted lobe (\`rectLtc\`) and the corners' move into it. The
 *  lobe's frame at a normal, view and roughness (\`RectFrame\`: the frame, M⁻¹ and the split-sum
 *  texel, two table lookups) is the pixel's, not the light's: taken once a pixel, on the first
 *  rectangle that lights it (\`pixelRectFrame\`), and read by every other. */
const RECT_SHADING_WGSL = wgslBlock(
  'RECT_SHADING_WGSL',
  [RECT_LIGHT_WGSL, PI, ndotvClamped, tangentSide, vectorRejection, LTC_WGSL, splitSumTerm],
  `
/** A corner in the frame (T1, T2, N) moved by M⁻¹ = [[m.x, 0, m.y], [0, 1, 0], [m.z, 0, m.w]]. */
fn ltcCorner(q:vec3f,T1:vec3f,T2:vec3f,N:vec3f,m:vec4f)->vec3f{
 let x=dot(q,T1);let z=dot(q,N);
 return vec3f(m.x*x+m.y*z,dot(q,T2),m.z*x+m.w*z);
}
struct RectFrame{T1:vec3f,T2:vec3f,N:vec3f,m:vec4f,split:vec4f,}
/** The fitted lobe's frame at the normal \`N\`, view \`V\` and roughness \`rough\`. */
fn rectFrameOf(N:vec3f,V:vec3f,rough:f32)->RectFrame{
 let NdotV=ndotvClamped(N,V);
 let side=vectorRejection(V,N);
 let other=tangentSide(N);
 let T1=normalize(select(side,other,dot(side,side)<1e-10));
 return RectFrame(T1,cross(N,T1),N,ltcLookup(rough,NdotV,0u),ltcLookup(rough,NdotV,1u));
}
var<private> rectFrameHeld:bool=false;
var<private> rectFrameKept:RectFrame;
/** The pixel's base frame, taken on its first rectangle: every rectangle of a pixel reads its
 *  surface's normal, view and roughness, so one frame serves them all. */
fn pixelRectFrame(N:vec3f,V:vec3f,rough:f32)->RectFrame{
 if(!rectFrameHeld){rectFrameKept=rectFrameOf(N,V,rough);rectFrameHeld=true;}
 return rectFrameKept;
}
/** A direction of the lobe's frame, back in the world: the frame's axes times M, the inverse of the matrix \`ltcCorner\` applies. */
fn ltcWorld(d:vec3f,f:RectFrame)->vec3f{
 let m=f.m;let det=m.x*m.w-m.y*m.z;
 let x=(m.w*d.x-m.y*d.z)/det;let z=(m.x*d.z-m.z*d.x)/det;
 return f.T1*x+f.T2*d.y+f.N*z;
}
/** The rectangle's fitted specular lobe in the frame \`f\`, of reflectance \`f0\`, per unit radiance
 *  and before its range window: the polygon of its view \`r\` moved by M⁻¹, integrated, weighed by
 *  the lobe's magnitude and Fresnel share, and by the colour of the rectangle's picture where the
 *  lobe's mean direction meets it (white for none). */
fn rectLtc(r:RectView,f:RectFrame,f0:vec3f)->vec3f{
 let lobe=polygonFormFactor(ltcCorner(r.a,f.T1,f.T2,f.N,f.m),ltcCorner(r.b,f.T1,f.T2,f.N,f.m),ltcCorner(r.c,f.T1,f.T2,f.N,f.m),ltcCorner(r.d,f.T1,f.T2,f.N,f.m),vec3f(0.0,0.0,1.0));
 var picture=vec3f(1.0);
 if(r.slot.z>0.0&&lobe.w>0.0){picture=rectColour(r,ltcWorld(lobe.xyz,f));}
 return splitSumTerm(f0,f.split)*lobe.w*picture;
}`,
)

/** The shading of a rectangle at a surface point \`s\` (\`lobeSurface\`), colour and intensity
 *  included, its view \`r\` from the point (\`rectView\`): on a diffuse model, the model's
 *  light of its exact irradiance, no lobe read; else the diffuse of that irradiance and the specular of
 *  its fitted lobe (\`rectBase\`, stretched where the pixel's lobes skew it; both under a cloth's
 *  fuzz, \`rectCloth\`); under a coat, the coat model's (\`coatedRect\`). The hooks are declared by the hook block that
 *  lists this one (\`lobesWgsl.ts\`: the lobed one, or the lobeless one's plain lobe, one and zero). */
export const RECT_SURFACE_LIGHT_WGSL = wgslBlock(
  'RECT_SURFACE_LIGHT_WGSL',
  [RECT_SHADING_WGSL, STANDARD_LIGHTING_WGSL, SURFACE_MODEL_LIGHT_WGSL],
  `
/** Its diffuse share (column 0) and the rest (column 1: the specular lobe, the coat), one
 *  evaluation for the whole term, which weighs them by the light's shares, and the split one
 *  (\`declaredLightSplit\`, a translucent layer's diffuse under its coverage, its specular over it). */
fn rectLightSplit(light:DirectLight,r:RectView,s:LobeSurface,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->mat2x3f{
 let tint=light.colorIntensity.rgb;
 let incident=rectIrradianceOf(r,N);
 let intensity=lightStrength(light);
 let E=intensity*incident.w;
 // The picture's colour where the rectangle's mean direction meets it: what the diffuse light and the cloth's fuzz are multiplied by.
 var picture=vec3f(1.0);
 if(r.slot.z>0.0&&incident.w>0.0){picture=rectColour(r,incident.xyz);}
 if(surfaceModel==${MODEL_FLAG.diffuse}u){
  if(incident.w<=0.0){return mat2x3f(vec3f(0.0),vec3f(0.0));}
  // E already carries the cosine: the diffuse model takes it whole, at a unit N·L.
  return mat2x3f(modelLight(rgb,metal,N,N,E)*tint*picture,vec3f(0.0));
 }
 // A pixel under a clear coat is lit by the coat model whole (\`coatedRect\`): the coat lights from its own normal,
 // whatever the base's face.
 if(hasCoat()){
  let coated=coatedRect(light,r,incident,s,N,V,rough);
  return mat2x3f(coated[0]*tint*picture,coated[1]*tint);
 }
 if(incident.w<=0.0){return mat2x3f(vec3f(0.0),vec3f(0.0));}
 let parts=rectCloth(mat2x3f(s.diffuse*E*picture,rectBase(r,N,V,s.f0,rough)*intensity*r.window),r,N,intensity,picture);
 return mat2x3f(parts[0]*tint,parts[1]*tint);
}`,
)
