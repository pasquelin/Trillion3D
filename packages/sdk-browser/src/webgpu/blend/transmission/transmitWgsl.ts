import { LOBE_AXIS_WGSL } from '../../../lighting/lobeAxisWgsl.ts'
import { FLAG_DIAGNOSTIC_VIEW, FLAG_UNLIT_VIEW } from '../../../visibility/types.ts'
import { declaredLightingSplitWgsl } from '../../../lighting/direct/declaredLightingWgsl.ts'
import { type ContractKey, variantLabel } from '../../../lighting/deferred/contractCuts.ts'
import { FOG_FREE_MODEL_BIT, MODEL_SHIFT, modelFlag } from '../../../scene/surfaceModel.ts'
import { FOG_WGSL } from '../../../lighting/fogShader.ts'
import { BLEND_TO_EYE_WGSL, blendSurfaceWgsl } from '../shaderSurface.ts'
import { FACING_MATERIAL_MASK } from '../facing.ts'
import { DISPLAY_MASK_GROUP, DISPLAY_ROUTE_WGSL, displayMaskWgsl } from '../displayFilter.ts'
import { DISTORTION_WGSL } from './distortionWgsl.ts'
import { FULLSCREEN_VERTEX } from '../../../lighting/deferred/shaders.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { f0Of, fresnelSchlickOccludedF90 } from '../../../../../math/src/wgsl/lighting.ts'

/**
 * A transmissive layer as a thin translucent surface leaves it — an infinitely thin absorbing
 * sheet under a lit coat —, its lights aside: what the blend multiplies the destination by. It reads the fragment's surface (`blendSurface`) and its record's volume (`materialAt`, the
 * rank the vertex stage passes in `VSOut.material`), the blend module's view and lights' fog.
 */
const THIN_LAYER_WGSL = wgslBlock(
  'THIN_LAYER_WGSL',
  [f0Of, fresnelSchlickOccludedF90, LOBE_AXIS_WGSL, FOG_WGSL, BLEND_TO_EYE_WGSL],
  `struct Thin{N:vec3f,V:vec3f,rough:f32,metal:f32,top:f32,specularColor:vec3f,transmittance:vec3f,fog:vec4f,alpha:f32,unlit:bool,}
fn thinLayer(in:VSOut,s:BlendSurface)->Thin{
 let flags=in.ids.y;
 let m=materialAt(in.material&${FACING_MATERIAL_MASK}u);
 let V=blendToEye(in);
 // The normal of the side we look from: a single-sided surface, or a mesh with no normal
 // attribute, can arrive turned the wrong way, and Fresnel would turn black.
 let N=faceForward(s.N,-V,s.N);
 let metal=clamp(s.metal,0.0,1.0);
 let unlit=(flags&${FLAG_UNLIT_VIEW}u)!=0u;
 let t=clamp(m.transmission,0.0,1.0);
 // The glTF transmission mapped on the thin layer: the lit layer covers by
 // max(1-t, metallic, roughness) — a metal transmits nothing, a rough surface scatters —,
 // the transmittance colour is baseColor·t.
 let top=max(1.0-t,max(metal,clamp(s.rough,0.0,1.0)));
 // Thin translucency: N·V of either side; the colour absorbed over a path of rcp(N·V), the
 // sheet's thickness seen at a slant; Fresnel at entry and again at exit (Schlick 1994, its
 // grazing value occluded under 2% specular) on the surface's specular colour (\`f0Of\`),
 // which follows its base colour and metal.
 let NoV=clamp(abs(dot(N,V))+1e-5,0.0,1.0);
 let specularColor=f0Of(s.rgb,metal);
 let F=fresnelSchlickOccludedF90(specularColor,NoV);
 let absorbed=pow(max(s.rgb*t,vec3f(1e-6)),vec3f(1.0/NoV));
 // The fog between the eye and the surface; a fog-free material, or the unlit view, takes none.
 let fogFree=unlit||(flags&${FOG_FREE_MODEL_BIT << MODEL_SHIFT}u)!=0u;
 let fog=select(fogOver(in.view,uni.eye.xyz),vec4f(0.0,0.0,0.0,1.0),fogFree);
 return Thin(N,V,lobeRoughness(s.rough),metal,top,specularColor,(1.0-F)*(1.0-F)*absorbed*(1.0-top),fog,clamp(s.alpha,0.0,1.0),unlit);
}
// What the destination is multiplied by: the transmittance faded to one by the glTF
// opacity, the surface coverage, and dimmed by the fog.
fn thinMul(l:Thin)->vec3f{return mix(vec3f(1.0),l.fog.a*l.transmittance,l.alpha);}
// The fallback without dual-source blending: the multiply as one grey coverage.
fn greyCoverage(mul:vec3f)->f32{return saturate(1.0-dot(mul,vec3f(1.0/3.0)));}
`,
)

/**
 * The transmissive layer lit in forward, as every translucent layer is (`blendFragment`,
 * `../shader.ts`): its diffuse layer under its coverage, its own specular — the declared
 * lights' and what it reflects (`surfaceReflection`, the blends' read) — kept apart from the
 * diffuse, the transmittance its blend multiplies the destination by, the fog over both. Its
 * shadows are the blends' (`declaredLightingSplit` on the blend's maps). No lobe: a glTF material
 * that transmits is shaded as a thin translucent surface, its transmission taking precedence over
 * a clear coat, and that thin model holds no clear coat nor anisotropy.
 */
const TRANSMIT_WGSL = wgslBlock(
  'TRANSMIT_WGSL',
  [THIN_LAYER_WGSL, modelFlag, FULLSCREEN_VERTEX],
  `// What the blend adds: the base colour and the emission a layer over the absorbing
// medium, under the specular: (diffuse + emissive)·top + specular,
// at the coverage, dimmed by the fog that adds its own.
fn thinAdd(in:VSOut,s:BlendSurface,l:Thin)->vec3f{
 var diffuse=s.rgb;
 var specular=vec3f(0.0);
 if(!l.unlit){
  let P=in.view;
  // One walk of the lights, their diffuse and specular shares apart (\`declaredLightingSplit\`).
  let lit=declaredLightingSplit(s.rgb,l.metal,l.rough,l.N,l.V,P,s.ao,in.position.xy,in.position.z);
  specular=lit.specular+surfaceReflection(l.specularColor,l.rough,l.N,l.V,P,in.position);
  // The diffuse layer only where it covers.
  if(l.top>0.0){diffuse=litSurface(lit.diffuse,bounceLighting(s.rgb,l.metal,l.N,P,s.ao),environmentLighting(s.rgb,l.metal,l.N,s.ao),vec3f(0.0),s.emissive,l.N,P,s.ao);}
 }
 return l.alpha*l.fog.rgb+l.fog.a*l.alpha*(diffuse*l.top+specular);
}
// Every transmissive stage's one prologue, after its derivatives \`g\`: the base map's sample, the
// material's coverage test (\`blendKeeps\`), then the surface (\`blendSurface\`); \`kept\` false where
// the test rejects the fragment, which the stage then discards before anything else is read.
struct TransmitIn{kept:bool,s:BlendSurface,}
fn transmitSurface(in:VSOut,front:bool,g:BlendGrads)->TransmitIn{
 var t:TransmitIn;
 let base=blendBase(in,g);
 if(!blendKeeps(in,base,front)){return t;}
 t.kept=true;
 t.s=blendSurface(in,front,g,base);
 return t;
}
// The dual blend's two sources: \`add\` laid on the destination,
// which is multiplied by \`mul\`; a diagnostic view's colour laid over at its coverage.
struct Transmit{add:vec3f,mul:vec3f,request:u32,}
fn transmitFragment(in:VSOut,front:bool)->Transmit{
 let flags=in.ids.y;
 // Every derivative wants uniform control flow: taken before the coverage test returns.
 let deltas=fwidth(in.bary);
 let t=transmitSurface(in,front,blendGrads(in));
 if(!t.kept){discard;return Transmit(vec3f(0.0),vec3f(1.0),0u);}
 let s=t.s;
 if((flags&${FLAG_DIAGNOSTIC_VIEW}u)!=0u){
  let d=blendDiagnosticOut(in,s,deltas);
  return Transmit(d.color.rgb*d.color.a,vec3f(1.0-d.color.a),s.request);
 }
 let l=thinLayer(in,s);
 if(!l.unlit){
  surfaceModel=modelFlag(flags);
  thinSubsurface=s.subsurface;
 }
 return Transmit(thinAdd(in,s,l),thinMul(l),s.request);
}
// The fallback without dual-source blending, the colour premultiplied, blended over by its grey
// coverage, with the request, the reactive value at that coverage, and the
// display layers left as they are.
@fragment fn fsTransmit(in:VSOut,@builtin(front_facing) front:bool)->BlendOut{
 let t=transmitFragment(in,front);
 let a=greyCoverage(t.mul);
 return BlendOut(vec4f(t.add,a),t.request,vec4f(0.0,1.0,0.0,a),vec4f(1.0),vec4f(0.0));
}
// With display layers (\`../displayFilter.ts\`): masked, tint and added value as a normal
// layer's, of the fallback's premultiplied colour.
@fragment fn fsTransmitFiltered(in:VSOut,@builtin(front_facing) front:bool)->BlendOut{
 let t=transmitFragment(in,front);
 let a=greyCoverage(t.mul);
 let unlit=(in.ids.y&${FLAG_UNLIT_VIEW}u)!=0u;
 let r=displayRoute(t.add/max(a,1e-4),uni.exposure,uni.toneCurve,unlit,a,maskAt(in.position));
 return BlendOut(vec4f(t.add,a)*r.keep,t.request,vec4f(0.0,1.0,0.0,a),r.tint,r.add);
}
// The companion pass: the same layers drawn again for what the colour pass's single
// target cannot hold — here the tile rank the pixel asks of the virtual textures, and the reactive
// value at the layer's grey coverage, which composes in any order (\`asIsShare.ts\`): a diagnostic
// view's colour coverage, else the fallback's (\`greyCoverage\`).
fn transmitCoverage(in:VSOut,s:BlendSurface,deltas:vec3f)->f32{
 if((in.ids.y&${FLAG_DIAGNOSTIC_VIEW}u)!=0u){return blendDiagnosticOut(in,s,deltas).color.a;}
 return greyCoverage(thinMul(thinLayer(in,s)));
}
struct Covered{@location(1) request:u32,@location(2) reactive:vec4f,}
@fragment fn fsTransmitCoverage(in:VSOut,@builtin(front_facing) front:bool)->Covered{
 let deltas=fwidth(in.bary);
 let t=transmitSurface(in,front,blendGrads(in));
 if(!t.kept){discard;return Covered(0u,vec4f(0.0));}
 return Covered(t.s.request,vec4f(0.0,1.0,0.0,transmitCoverage(in,t.s,deltas)));
}
// The distortion accumulation: the offset of a refracting
// fragment, positive and negative apart, of the inverse ior \`invIor\` its material declares.
fn transmitOffset(in:VSOut,s:BlendSurface,invIor:f32)->vec4f{
 let V=blendToEye(in);
 return distortionOffset(1.0/invIor,faceForward(s.N,-V,s.N),V,in.view,in.position.xy);
}
// A surface that declares no ior bends nothing (\`refracts\`, \`invIor\` one): the plan draws none
// here (\`REFRACT_BASE\`), and a material written since is dropped before its surface is read; an
// offset under a pixel adds nothing either.
@fragment fn fsDistortion(in:VSOut,@builtin(front_facing) front:bool)->@location(0) vec4f{
 let g=blendGrads(in);
 let invIor=materialAt(in.material&${FACING_MATERIAL_MASK}u).invIor;
 if(invIor==1.0){discard;return vec4f(0.0);}
 let t=transmitSurface(in,front,g);
 if(!t.kept){discard;return vec4f(0.0);}
 let offset=transmitOffset(in,t.s,invIor);
 if(all(offset==vec4f(0.0))){discard;}
 return offset;
}
// The accumulation and the companion pass in one draw of every transmissive layer, where the image
// refracts and the companion pass is wanted (\`encodeDistortion\`): the offset — zero, added, where
// the layer bends nothing — beside the request and the reactive value (\`fsTransmitCoverage\`).
struct DistortedCovered{@location(0) offset:vec4f,@location(1) request:u32,@location(2) reactive:vec4f,}
@fragment fn fsDistortionCoverage(in:VSOut,@builtin(front_facing) front:bool)->DistortedCovered{
 let deltas=fwidth(in.bary);
 let t=transmitSurface(in,front,blendGrads(in));
 if(!t.kept){discard;return DistortedCovered(vec4f(0.0),0u,vec4f(0.0));}
 let invIor=materialAt(in.material&${FACING_MATERIAL_MASK}u).invIor;
 var offset=vec4f(0.0);
 if(invIor!=1.0){offset=transmitOffset(in,t.s,invIor);}
 return DistortedCovered(offset,t.s.request,vec4f(0.0,1.0,0.0,transmitCoverage(in,t.s,deltas)));
}
// The distortion application, a full-screen pass whose pixels with no accumulated offset are
// dropped (\`distortedScene\`) — nothing bent them, the scene stays as it is —, on the full-screen
// triangle (\`FULLSCREEN_VERTEX\`).
@fragment fn fsDistortionApply(@builtin(position) position:vec4f)->@location(0) vec4f{return distortedScene(position.xy);}
`,
)

/** The dual blend, one pass for the thin layer's two effects on the destination: what is added,
 *  then the destination's per-channel multiply; the alpha takes the layer's grey coverage over the
 *  target's (`greyCoverage`, the fallback's rule): a layer over the background leaves its pixel
 *  covered, which the composition lays the background under (`composeAt`). */
const TRANSMIT_DUAL_WGSL = wgslBlock(
  'TRANSMIT_DUAL_WGSL',
  [TRANSMIT_WGSL],
  `struct TransmitDual{@location(0) @blend_src(0) add:vec4f,@location(0) @blend_src(1) mul:vec4f,}
@fragment fn fsTransmitDual(in:VSOut,@builtin(front_facing) front:bool)->TransmitDual{
 let t=transmitFragment(in,front);
 return TransmitDual(vec4f(t.add,greyCoverage(t.mul)),vec4f(t.mul,1.0));
}
`,
)

/**
 * The transmissive stages of the blend module of `key` (`../shader.ts`), its lights split
 * (`declaredLightingSplitWgsl`), imported with transmission's code (`family.ts`): the
 * layer lit and composed under the single-source fallback (`fsTransmit`, `fsTransmitFiltered`), its
 * companion pass (`fsTransmitCoverage`), the distortion's accumulation — alone or with the
 * companion pass's outputs (`fsDistortion`, `fsDistortionCoverage`) — and full-screen application
 * (`FULLSCREEN_VERTEX`, `fsDistortionApply`), and with `dual` — a device granted
 * `dual-source-blending` — the dual blend itself (`fsTransmitDual`). Everything is read on the imported material —
 * `KHR_materials_transmission`, `KHR_materials_ior` — and the scene's declared sources, with the
 * engine's only lighting formula. No light of its own, no constant tuned to a scene.
 */
export const transmitWgsl = (key: Partial<ContractKey>, dual: boolean) =>
  wgslBlock(
    `transmitWgsl(${variantLabel(key)},${dual})`,
    [
      blendSurfaceWgsl(!key.lobeless),
      declaredLightingSplitWgsl(key),
      DISPLAY_ROUTE_WGSL,
      displayMaskWgsl(DISPLAY_MASK_GROUP),
      DISTORTION_WGSL,
      dual ? TRANSMIT_DUAL_WGSL : TRANSMIT_WGSL,
    ],
    '',
  )
