import { PI } from '../../../../math/src/wgsl/constants.ts'
import { LOBE_PACK_WGSL, PHYSICAL_LOBES_TARGET } from '../../materials/surface/physicalLobes.ts'
import { LOBE_AXIS_WGSL } from '../lobeAxisWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SURFACE_LIGHT_WGSL } from '../standardLighting.ts'
import { RECT_SURFACE_LIGHT_WGSL } from './rectLightWgsl.ts'
import { DIELECTRIC_F0, fresnelScalar, fresnelSchlick } from '../../../../math/src/wgsl/lighting.ts'

/**
 * The lighting of the physical material's anisotropic and clear-coat lobes
 * (`../../materials/surface/physicalLobes.ts`), from the Khronos material extension equations: in the opaque
 * resolve's program that has them (`contractLightingProgram`, `key.lobeless` false), which reads a
 * pixel's lobes from the lobes target (`LOBES_TARGET_WGSL`), in the blend pass's lobed programs,
 * which compute them in place (`../../blend/physicalWgsl.ts`).
 * Each sets them once a pixel (`setLobes`) where it carries them, and every term below falls back
 * on the standard one, operand for operand, on a pixel that does not.
 *
 * Anisotropic GGX: αt = mix(α, 1, s²) along the direction T, αb = α across it, the distribution
 * 1 / (π αt αb |(T·H/αt, B·H/αb, N·H)|⁴) and its height-correlated visibility. The coat: a
 * dielectric GGX lobe (F0 0.04) on the coat normal at the coat roughness, weighted by the coat,
 * above a base that the coat's Fresnel at the view, 1 − coat·F(N_c·V), lets through — on every
 * light, the environment and bounced light alike. What a pixel's lights share is
 * taken once: αt, αb, their reciprocals and the distribution's scale 1/(π αt αb) (a light's T·H/αt
 * is a product, its D a quotient by q², the same 8-bit image, `lobeLight.test.ts`), the view's
 * length in the stretched frame and, under a coat, the coat's own surface (`lobeSurface`) when its
 * lobes are set, the base's surface before its light loop (`sliceLighting`), a light's direction
 * and half-vector once for the base and the coat (`standardLobe`). A rectangle stretches its polygon in the direction's frame before its fitted
 * lobe, and lights the coat with that lobe on the coat normal.
 */
export const LOBES_LIGHTING_WGSL = wgslBlock(
  'LOBES_LIGHTING_WGSL',
  [PI, DIELECTRIC_F0, fresnelScalar, fresnelSchlick, SURFACE_LIGHT_WGSL],
  `
struct Lobes{on:bool,skewed:bool,T:vec3f,B:vec3f,coat:f32,coatRough:f32,coatN:vec3f,through:f32,at:f32,ab:f32,invAt:f32,invAb:f32,dScale:f32,view:vec2f,viewLength:f32,coatSurface:LobeSurface,}
var<private> lobes:Lobes;
/** A pixel's lobes: its lobe axis \`axis\` at its width \`alpha\` (\`lobeAxis\`: the direction kept
 *  orthogonal to the normal the lighting reads and αt along it, or the round lobe), and what its
 *  lights share of them. */
fn setLobes(axis:vec4f,coat:f32,coatRough:f32,coatN:vec3f,N:vec3f,V:vec3f,alpha:f32){
 lobes.on=true;
 lobes.skewed=any(axis.xyz!=vec3f(0.0));
 lobes.T=axis.xyz;
 lobes.B=cross(N,lobes.T);
 lobes.coat=coat;lobes.coatRough=coatRough;lobes.coatN=coatN;
 lobes.at=axis.w;lobes.ab=alpha;
 lobes.invAt=1.0/lobes.at;lobes.invAb=1.0/lobes.ab;lobes.dScale=1.0/(PI*lobes.at*lobes.ab);
 lobes.view=vec2f(lobes.at*dot(lobes.T,V),lobes.ab*dot(lobes.B,V));
 // Without a coat, its surface is never read (every coat term asks \`lobes.coat>0.0\`) and the base
 // goes through whole: 1-0*F is exactly 1.
 if(lobes.coat>0.0){
  lobes.through=1.0-lobes.coat*fresnelScalar(DIELECTRIC_F0.x,max(dot(lobes.coatN,V),0.0));
  lobes.coatSurface=lobeSurface(vec3f(0.0),0.0,coatRough,coatN,V);
 }else{lobes.through=1.0;}
}
/** The view's length in the stretched frame, finished once a pixel on its surface's N·V
 *  (\`lobeSurface\`), which the light loop hands it (\`sliceLighting\`): one N·V a pixel. */
fn lobeView(s:LobeSurface){if(lobes.on){lobes.viewLength=length(vec3f(lobes.view,s.NdotV));}}
/** What the coat lets through of the base: one without lobes. */
fn lobeThrough()->f32{return select(1.0,lobes.through,lobes.on);}
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
 return lobeSum(s,D,gV,gL,max(dot(V,H),0.0),direct);
}
/** The hooks of the one \`surfaceLight\` and \`rectLight\` (\`../standardLighting.ts\`,
 *  \`rectLightWgsl.ts\`) on a pixel whose lobes are set: the base's lobe, anisotropic where it is
 *  skewed, on the surface the lobes were set for, and the coat's own lobe (\`standardLobe\` on the coat's surface) at
 *  its cosine; a pixel without lobes answers the standard lobe and no coat. The light's direction
 *  and half-vector serve both. */
fn coatCosine(L:vec3f)->f32{if(lobes.on&&lobes.coat>0.0){return max(dot(lobes.coatN,L),0.0);}return 0.0;}
fn baseLobe(s:LobeSurface,N:vec3f,V:vec3f,L:vec3f,H:vec3f,NdotL:f32,energy:f32)->vec3f{
 if(lobes.on&&lobes.skewed){return anisotropicLobe(s,N,V,L,H,NdotL,energy);}
 return standardLobe(s,N,V,H,NdotL,energy);
}
fn coatLobe(V:vec3f,H:vec3f,NdotL:f32,energy:f32)->vec3f{
 if(NdotL>0.0){return lobes.coat*standardLobe(lobes.coatSurface,lobes.coatN,V,H,NdotL,energy);}
 return vec3f(0.0);
}`,
)

/** A lobed program's hooks of the one \`rectLight\` (\`rectLightWgsl.ts\`), where the image holds a
 *  rectangle: the base's fitted lobe, its polygon and view stretched by the anisotropy (αt along \`T\`)
 *  as αt stretches the distribution — the view's stretch a pixel's, so its frame is the pixel's too
 *  (\`pixelRectFrame\`) —, and the coat's on the coat's normal and roughness, its frame taken once
 *  a pixel too (\`coatRectFrame\`). */
export const LOBES_RECT_WGSL = wgslBlock(
  'LOBES_RECT_WGSL',
  [LOBES_LIGHTING_WGSL, RECT_SURFACE_LIGHT_WGSL],
  `
fn rectBase(r:RectView,N:vec3f,V:vec3f,f0:vec3f,rough:f32)->vec3f{
 if(!(lobes.on&&lobes.skewed)){return rectLtc(r,pixelRectFrame(N,V,rough),f0);}
 let T=lobes.T;let k=lobes.ab/lobes.at-1.0;
 let s=RectView(r.a+k*T*dot(T,r.a),r.b+k*T*dot(T,r.b),r.c+k*T*dot(T,r.c),r.d+k*T*dot(T,r.d),r.window);
 return rectLtc(s,pixelRectFrame(N,normalize(V+k*T*dot(T,V)),rough),f0);
}
var<private> coatFrameHeld:bool=false;
var<private> coatFrameKept:RectFrame;
fn coatRectFrame(V:vec3f)->RectFrame{
 if(!coatFrameHeld){coatFrameKept=rectFrameOf(lobes.coatN,V,lobes.coatRough);coatFrameHeld=true;}
 return coatFrameKept;
}
/** The coat's fitted lobe of a rectangle's view \`r\`, of intensity \`energy\`, before its colour. */
fn rectCoat(r:RectView,V:vec3f,energy:f32)->vec3f{
 if(lobes.on&&lobes.coat>0.0&&r.window>0.0){return lobes.coat*rectLtc(r,coatRectFrame(V),DIELECTRIC_F0)*energy*r.window;}
 return vec3f(0.0);
}`,
)

/** A lobeless program's hooks of the one \`surfaceLight\` (\`LOBES_LIGHTING_WGSL\`'s): no lobe is ever
 *  set, so the base is the standard lobe, the coat lets it through whole, an exact one, and adds an
 *  exact zero — every term it weighs keeps its bits. What a program that lights a surface without
 *  a lobe lists: it brings \`surfaceLight\` (\`SURFACE_LIGHT_WGSL\`). */
export const LOBELESS_LIGHTING_WGSL = wgslBlock(
  'LOBELESS_LIGHTING_WGSL',
  [SURFACE_LIGHT_WGSL],
  `fn lobeThrough()->f32{return 1.0;}
fn lobeView(s:LobeSurface){}
fn coatCosine(L:vec3f)->f32{return 0.0;}
fn baseLobe(s:LobeSurface,N:vec3f,V:vec3f,L:vec3f,H:vec3f,NdotL:f32,energy:f32)->vec3f{return standardLobe(s,N,V,H,NdotL,energy);}
fn coatLobe(V:vec3f,H:vec3f,NdotL:f32,energy:f32)->vec3f{return vec3f(0.0);}`,
)

/** The same of the one \`rectLight\` (\`rectLightWgsl.ts\`): the plain fitted lobe and no coat. */
export const LOBELESS_RECT_WGSL = wgslBlock(
  'LOBELESS_RECT_WGSL',
  [RECT_SURFACE_LIGHT_WGSL],
  `fn rectBase(r:RectView,N:vec3f,V:vec3f,f0:vec3f,rough:f32)->vec3f{return rectLtc(r,pixelRectFrame(N,V,rough),f0);}
fn rectCoat(r:RectView,V:vec3f,energy:f32)->vec3f{return vec3f(0.0);}`,
)

/** The decode of a texel of the lobes target into a pixel's lobes (`lobesAt`), at its roughness
 *  `rough`, its coat normal turned by `side` (-1 where a reader turned the stored normal to face the
 *  eye): the one reading of the opaque resolve and the opaque reflection
 *  (`../reflections/trace/trace.ts`). */
export const LOBES_DECODE_WGSL = wgslBlock(
  'LOBES_DECODE_WGSL',
  [LOBE_PACK_WGSL, LOBE_AXIS_WGSL],
  `
fn lobesAt(w:vec4u,side:f32,N:vec3f,V:vec3f,rough:f32){
 let alpha=lobeAlpha(rough);
 let coat=packedCoat(w);
 setLobes(packedLobeAxis(w,N,alpha),coat.x,coat.y,lobeOctDecode(w.y)*side,N,V,alpha);
}`,
)

/** The read of a pixel's lobes from the lobes target, a read-only storage texture: no sampled
 *  texture of the sixteen a stage is guaranteed (`../deferred/layoutEntries.ts`). `readLobes`, the opaque
 *  resolve's, reads the pixel's texel as it is stored. */
export const LOBES_TARGET_WGSL = wgslBlock(
  'LOBES_TARGET_WGSL',
  [LOBES_DECODE_WGSL],
  `
${PHYSICAL_LOBES_TARGET.wgsl}
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
