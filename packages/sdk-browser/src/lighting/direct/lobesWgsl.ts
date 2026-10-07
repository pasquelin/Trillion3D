import { PI } from '../../../../math/src/wgsl/constants.ts'
import { LOBE_PACK_WGSL, PHYSICAL_LOBES_TARGET } from '../../scene/physicalLobes.ts'
import { MODEL_FLAG } from '../../scene/surfaceModel.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  DIELECTRIC_F0,
  fresnelScalar,
  fresnelSchlick,
  lambertAlbedoMul,
  ndotvFloor,
} from '../../../../math/src/wgsl/lighting.ts'

/**
 * The lighting of the physical material's anisotropic and clear-coat lobes
 * (`../../scene/physicalLobes.ts`), from the Khronos material extension equations: in the opaque
 * resolve's program that has them (`contractLightingProgram`, `key.lobeless` false), which reads a
 * pixel's lobes from the lobes target (`LOBES_TARGET_WGSL`), in the blend pass's lobed programs,
 * which compute them in place (`../../webgpu/blend/physicalWgsl.ts`), and in the water composite's,
 * which reads what its surface stage left in that target (`../../webgpu/water/waterLobesWgsl.ts`).
 * Each sets them once a pixel (`setLobes`) where it carries them, and every term below falls back
 * on the standard one, operand for operand, on a pixel that does not.
 *
 * Anisotropic GGX: αt = mix(α, 1, s²) along the direction T, αb = α across it, the distribution
 * 1 / (π αt αb |(T·H/αt, B·H/αb, N·H)|⁴) and its height-correlated visibility. The coat: a
 * dielectric GGX lobe (F0 0.04) on the coat normal at the coat roughness, weighted by the coat,
 * above a base that the coat's Fresnel at the view, 1 − coat·F(N_c·V), lets through — on every
 * light, the environment, bounced light and the mirror term alike. What a pixel's lights share is
 * taken once: αt, αb, their reciprocals and the distribution's scale 1/(π αt αb) (a light's T·H/αt
 * is a product, its D a quotient by q², the same 8-bit image, `lobeLight.test.ts`), the view's
 * length in the stretched frame and, under a coat, the coat's own surface (`lobeSurface`) when its
 * lobes are set, the base's surface before its light loop (`sliceLighting`), a light's direction
 * and half-vector once for the base and the coat (`standardLobe`). A rectangle stretches its polygon in the direction's frame before its fitted
 * lobe, and lights the coat with that lobe on the coat normal.
 */
export const LOBES_LIGHTING_WGSL = wgslBlock(
  'LOBES_LIGHTING_WGSL',
  [PI, DIELECTRIC_F0, fresnelScalar, fresnelSchlick, lambertAlbedoMul, ndotvFloor],
  `
struct Lobes{on:bool,strength:f32,T:vec3f,B:vec3f,coat:f32,coatRough:f32,coatN:vec3f,through:f32,at:f32,ab:f32,invAt:f32,invAb:f32,dScale:f32,viewLength:f32,coatSurface:LobeSurface,}
var<private> lobes:Lobes;
/** A pixel's lobes: its direction \`d\` kept orthogonal to the normal the lighting reads, and what
 *  its lights share of them at its roughness \`rough\`. */
fn setLobes(d:vec3f,strength:f32,coat:f32,coatRough:f32,coatN:vec3f,N:vec3f,V:vec3f,rough:f32){
 let t=d-N*dot(N,d);let l=dot(t,t);
 lobes.on=true;
 lobes.strength=select(0.0,strength,l>1e-12);
 lobes.T=select(vec3f(0.0),t*inverseSqrt(max(l,1e-24)),l>1e-12);
 lobes.B=cross(N,lobes.T);
 lobes.coat=coat;lobes.coatRough=coatRough;lobes.coatN=coatN;
 let alpha=rough*rough;
 lobes.at=mix(alpha,1.0,lobes.strength*lobes.strength);lobes.ab=alpha;
 lobes.invAt=1.0/lobes.at;lobes.invAb=1.0/lobes.ab;lobes.dScale=1.0/(PI*lobes.at*lobes.ab);
 lobes.viewLength=length(vec3f(lobes.at*dot(lobes.T,V),lobes.ab*dot(lobes.B,V),ndotvFloor(N,V)));
 // Without a coat, its surface is never read (every coat term asks \`lobes.coat>0.0\`) and the base
 // goes through whole: 1-0*F is exactly 1.
 if(lobes.coat>0.0){
  lobes.through=1.0-lobes.coat*fresnelScalar(DIELECTRIC_F0.x,max(dot(lobes.coatN,V),0.0));
  lobes.coatSurface=lobeSurface(vec3f(0.0),0.0,coatRough,coatN,V);
 }else{lobes.through=1.0;}
}
/** What the coat lets through of the base: one without lobes. */
fn lobeThrough()->f32{return select(1.0,lobes.through,lobes.on);}
/** The mirror term \`m\` of the surface under the coat, and the coat's own reflection on its
 *  normal at its roughness (\`surfaceMirrorLighting\`); as it is on a pixel without lobes. */
fn lobeMirror(m:vec3f,V:vec3f,P:vec3f)->vec3f{
 if(!lobes.on){return m;}
 var coat=vec3f(0.0);
 if(lobes.coat>0.0){coat=lobes.coat*surfaceMirrorLighting(vec3f(0.0),0.0,lobes.coatRough,lobes.coatN,V,P);}
 return m*lobes.through+coat;
}
/** The anisotropic lobe of one light past its direction \`L\`, half-vector \`H\` and \`NdotL\` above
 *  zero, on surface \`s\`, as \`standardLobe\` is the standard one's. */
fn anisotropicLobe(s:LobeSurface,N:vec3f,V:vec3f,L:vec3f,H:vec3f,NdotL:f32,energy:f32)->vec3f{
 let direct=energy*NdotL;
 let T=lobes.T;let B=lobes.B;let at=lobes.at;let ab=lobes.ab;
 let h=vec3f(dot(T,H)*lobes.invAt,dot(B,H)*lobes.invAb,max(dot(N,H),0.0));
 let q=dot(h,h);
 let D=lobes.dScale/(q*q);
 let gV=NdotL*lobes.viewLength;
 let gL=s.NdotV*length(vec3f(at*dot(T,L),ab*dot(B,L),NdotL));
 let Vis=0.5/(gV+gL+1e-7);
 let F=fresnelSchlick(s.f0,max(dot(V,H),0.0));
 return s.diffuse*direct+D*Vis*F*direct;
}
/** One light on surface \`s\` (\`lobeSurface\`): \`surfaceLight\` without lobes, else its
 *  anisotropic lobe where it has a strength — the surface the lobes were set for, or the water's
 *  null albedo, a dielectric's (\`declaredLightingPair\`) —, under the coat, and the coat's own lobe
 *  (\`standardLobe\` on the coat's surface). The light's direction and half-vector serve both. */
fn lobeLight(s:LobeSurface,N:vec3f,V:vec3f,light:vec4f)->vec3f{
 if(!lobes.on){return surfaceLight(s,N,V,light);}
 let L=normalize(light.xyz);
 let NdotL=max(dot(N,L),0.0);
 var coatNdotL=0.0;
 if(lobes.coat>0.0){coatNdotL=max(dot(lobes.coatN,L),0.0);}
 // Facing away from the base and the coat, both terms are zeros, which the light's sum keeps as
 // they are: returned before the half-vector is paid, as \`surfaceLight\`.
 if(NdotL==0.0&&coatNdotL==0.0){return vec3f(0.0);}
 let H=normalize(L+V);
 var coat=vec3f(0.0);
 if(coatNdotL>0.0){coat=lobes.coat*standardLobe(lobes.coatSurface,lobes.coatN,V,H,coatNdotL,light.w);}
 var base=vec3f(0.0);
 if(NdotL>0.0){
  if(lobes.strength>0.0){base=anisotropicLobe(s,N,V,L,H,NdotL,light.w);}
  else{base=standardLobe(s,N,V,H,NdotL,light.w);}
 }
 return base*lobes.through+coat;
}
/** A rectangle's fitted lobe of reflectance \`f0\` at the normal \`N\` (\`rectLtc\`), its polygon
 *  and the view stretched by the anisotropy (\`strength\` along \`T\`) as αt stretches the
 *  distribution. */
fn rectLobe(r:RectView,N:vec3f,V:vec3f,f0:vec3f,rough:f32,strength:f32,T:vec3f)->vec3f{
 if(!(strength>0.0)){return rectLtc(r,N,V,f0,rough);}
 let alpha=rough*rough;let k=alpha/mix(alpha,1.0,strength*strength)-1.0;
 let s=RectView(r.a+k*T*dot(T,r.a),r.b+k*T*dot(T,r.b),r.c+k*T*dot(T,r.c),r.d+k*T*dot(T,r.d),r.window);
 return rectLtc(s,N,normalize(V+k*T*dot(T,V)),f0,rough);
}
/** A rectangle light on the surface: \`rectLight\` without lobes, or on a diffuse or toon model;
 *  \`f0\` as \`lobeLight\`'s. Its view of the rectangle serves the coat and the base. */
fn lobeRectLight(light:DirectLight,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,f0:vec3f)->vec3f{
 if(!lobes.on||surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){return rectLight(light,rgb,metal,rough,N,V,P,ao);}
 let r=rectView(light,P);
 let tint=light.colorIntensity.rgb;
 var coat=vec3f(0.0);
 if(lobes.coat>0.0&&r.window>0.0){coat=lobes.coat*rectLtc(r,lobes.coatN,V,DIELECTRIC_F0,lobes.coatRough)*light.colorIntensity.w*r.window*tint;}
 let incident=rectIrradianceOf(r,N);
 if(incident.w<=0.0){return coat;}
 let E=light.colorIntensity.w*incident.w;
 let specular=rectLobe(r,N,V,f0,rough,lobes.strength,lobes.T)*light.colorIntensity.w*r.window;
 return (lambertAlbedoMul(rgb,metal)*E+specular)*tint*lobes.through+coat;
}`,
)

/** A lobeless program's stand-ins (`LOBES_LIGHTING_WGSL`'s): no lobe is ever set, so the coat
 *  lets the whole base through, an exact one, and the mirror term is the surface's — every term
 *  they weigh keeps its bits. */
export const LOBELESS_LIGHTING_WGSL = wgslBlock(
  'LOBELESS_LIGHTING_WGSL',
  [],
  `fn lobeThrough()->f32{return 1.0;}
fn lobeMirror(m:vec3f,V:vec3f,P:vec3f)->vec3f{return m;}`,
)

/** The read of a pixel's lobes from the lobes target, a read-only storage texture: no sampled
 *  texture of the sixteen a stage is guaranteed (`../deferred/setup.ts`). `lobesAt` decodes a
 *  texel `w`, its coat normal turned by `side` (-1 where the water composite turned the stored
 *  normal to face the eye, `../../webgpu/water/waterLobesWgsl.ts`); `readLobes`, the opaque
 *  resolve's, reads the pixel's texel as it is stored. */
export const LOBES_TARGET_WGSL = wgslBlock(
  'LOBES_TARGET_WGSL',
  [LOBE_PACK_WGSL],
  `
${PHYSICAL_LOBES_TARGET.wgsl}
fn lobesAt(w:vec4u,side:f32,N:vec3f,V:vec3f,rough:f32){
 let s=unpack2x16unorm(w.z);
 setLobes(lobeOctDecode(w.x),s.x,s.y,bitcast<f32>(w.w),lobeOctDecode(w.y)*side,N,V,rough);
}
fn readLobes(coord:vec2i,N:vec3f,V:vec3f,rough:f32){lobesAt(textureLoad(physicalLobes,coord),1.0,N,V,rough);}`,
)

/** A lobeless resolve's stand-in (`LOBES_TARGET_WGSL`'s): no pixel carries the flag, none is read. */
export const LOBELESS_TARGET_WGSL = wgslBlock(
  'LOBELESS_TARGET_WGSL',
  [],
  `fn readLobes(coord:vec2i,N:vec3f,V:vec3f,rough:f32){}`,
)

/** The surface reads its lobes where its flag says so (`contractSurfaceBody`), at its roughness. */
export const readLobesStatement = (flag: number) =>
  `if((surfaceFlag&${flag}u)!=0u){readLobes(coord,N,V,normal.a);}`
