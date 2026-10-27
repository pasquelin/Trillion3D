import { FLAG_DIAGNOSTIC_VIEW, FLAG_UNLIT_VIEW } from '../../visibility/types.ts'
import { translucentMarksFrom } from '../../lighting/direct/shadowWgsl.ts'
import { modelFlag } from '../../materials/surface/surfaceModelWord.ts'
import { GRAPH_FLAG } from '../graphWgsl.ts'
import { BLEND_PUSHED_DEPTH_WGSL } from '../pushedDepthWgsl.ts'
import { BLEND_PRE_EXPOSED_WGSL } from '../viewLayout.ts'
import type { CloudVertexText } from '../cloudVertexText.ts'
import { FACING_MATERIAL_MASK, FACING_SHIFT } from '../facing.ts'
import { WORDS } from '../vertexReadsWgsl.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { stageImports, stageLabel, stagePrologue, type StageOptions } from '../stageOptions.ts'
import { thinLayerWgsl } from './transmitThinWgsl.ts'
import { COVERED, coverageStageText, marked, responsiveStageText } from '../layerStagesWgsl.ts'

/** The lit colour pass's functions and its prologue, up to where a program's shadow marks are set:
 *  the thin layer's addition, the stage prologue and the transmit fragment. */
const colourHeadText = (
  o: StageOptions,
) => `// What the blend adds: the base colour and the emission a layer over the absorbing
// medium, under the specular: (diffuse + emissive)·top + specular,
// at the coverage, dimmed by the fog that adds its own.
fn thinAdd(in:VSOut,s:BlendSurface,l:Thin)->vec3f{
 var diffuse=s.rgb;
 var specular=vec3f(0.0);
 if(!l.unlit){
  let P=in.view;
  ${stagePrologue(o, '  ')}
  // One walk of the lights, their diffuse and specular shares apart (\`declaredLightingSplit\`).
  let lit=declaredLightingSplit(s.rgb,l.metal,l.rough,l.N,l.V,P,in.position.xy,in.position.z);
  specular=lit.specular+surfaceReflection(l.specularColor,l.rough,l.N,l.V,P,in.position);
  // The diffuse layer only where it covers.
  if(l.top>0.0){diffuse=litSurface(lit.diffuse,lambertDiffuse(s.rgb,l.metal,translucentGiIrradiance(P,l.N,translucentGiSingle),s.ao),environmentLighting(s.rgb,l.metal,l.N,s.ao),vec3f(0.0),s.emissive,l.N,P,s.ao);}
 }
 return l.coverage*l.fog.rgb+l.fog.a*l.coverage*(diffuse*l.top+specular);
}
// Every transmissive stage's one prologue, after its derivatives \`g\`: the base map's sample, the
// facing test (\`facingDiscarded\`; no alpha cut), then the surface (\`blendSurface\`); \`kept\` false where
// the test rejects the fragment, which the stage then discards before anything else is read.
struct TransmitIn{kept:bool,s:BlendSurface,g:BlendGrads,mapAlpha:f32,}
fn transmitSurface(in:VSOut,front:bool,g:BlendGrads)->TransmitIn{
 var t:TransmitIn;
 let base=blendBase(in,g);
 // No alpha cut: a translucent material is cut by no opacity, a masked one is shaped by its mask (\`thinLayer\`).
 if(facingDiscarded(in.${WORDS.material}>>${FACING_SHIFT}u,front)){return t;}
 t.kept=true;
 t.g=g;
 t.mapAlpha=base.w;
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
 let l=thinLayer(in,t);
 if(!l.unlit){
  surfaceModel=modelFlag(flags);`

/** The colour pass's entry points, the fallback's and its display-layer variant, from the
 *  end of the transmit fragment. */
const colourStagesText = (shade: CloudVertexText) => `
  thinSubsurface=s.subsurface;
 }
 // A held-out object adds no colour, its coverage the transmittance alone (\`holdoutPrimitive\`).
 return Transmit(select(preExposedClipped(thinAdd(in,s,l)),vec3f(0.0),holdoutPrimitive(in)),thinMul(l),s.request);
}
// The fallback without dual-source blending, the colour premultiplied, blended over by its grey
// coverage, with the request, and the display layers left as they are.
@fragment fn fsTransmit(in:VSOut,@builtin(front_facing) front:bool)->BlendOut{${shade.entry}
 let t=transmitFragment(in,front);
 let a=greyCoverage(t.mul);
 return BlendOut(vec4f(t.add,a),t.request,vec4f(1.0),vec4f(0.0));
}
// With display layers (\`../displayFilter.ts\`): masked, tint and added value as a normal
// layer's, of the fallback's premultiplied colour.
@fragment fn fsTransmitFiltered(in:VSOut,@builtin(front_facing) front:bool)->BlendOut{${shade.entry}
 let t=transmitFragment(in,front);
 let a=greyCoverage(t.mul);
 let unlit=(in.ids.y&${FLAG_UNLIT_VIEW}u)!=0u;
 let r=displayRoute(t.add/max(a,1e-4),uni.exposure,uni.toneCurve,unlit,a,maskAt(in.position),uni.bake);
 return BlendOut(vec4f(t.add,a)*r.keep,t.request,r.tint,r.add);
}
`

/** The alpha holdout's accumulation stage. */
const holdoutStageText = (
  shade: CloudVertexText,
) => `// The alpha holdout's accumulation (\`../holdoutWgsl.ts\`): the layer lets through what its surface
// does not cover, and holds out only a held-out object's coverage; the fog in front scales what it adds.
// A thin layer covers by its surface's coverage alone, as a translucent one by its opacity: neither its
// transmittance nor its index of refraction makes it more or less opaque.
@fragment fn fsTransmitHoldout(in:VSOut,@builtin(front_facing) front:bool)->@location(0) vec4f{${shade.entry}
 let t=transmitSurface(in,front,blendGrads(in));
 if(!t.kept){discard;return vec4f(0.0,0.0,0.0,1.0);}
 let l=thinLayer(in,t);
 let cover=saturate(l.coverage);
 return holdoutOut(select(0.0,cover,holdoutPrimitive(in)),1.0-cover,cover,l.fog.a);
}
`

/** The distortion's accumulation stage. */
const distortionStagesText = (
  shade: CloudVertexText,
  graphs: boolean,
) => `// The inverse ior of the fragment's surface: the material's (\`invIor\`, its record's), or, where its
// graph wires a refraction, the graph's — the index of refraction it gives; an index of zero says none.
fn transmitInvIor(in:VSOut,g:BlendGrads)->f32{
${graphs ? ` if((g.graph.flags&${GRAPH_FLAG.refraction}u)!=0u&&g.graph.refraction!=0.0){return 1.0/g.graph.refraction;}\n` : ''} return materialAt(in.${WORDS.material}&${FACING_MATERIAL_MASK}u).invIor;
}
// The distortion accumulation: the offset of a refracting
// fragment, positive and negative apart, of the inverse ior \`invIor\` its surface gives.
fn transmitOffset(in:VSOut,s:BlendSurface,invIor:f32)->vec4f{
 let V=blendToEye(in);
 return distortionOffset(1.0/invIor,faceForward(s.N,-V,s.N),in.view,in.position.xy);
}
// A surface that declares no ior bends nothing (\`refracts\`, \`invIor\` one): the plan draws none
// here (\`transmitBase\`), and a material written since is dropped before its surface is read; an
// offset under a pixel adds nothing either.
@fragment fn fsDistortion(in:VSOut,@builtin(front_facing) front:bool)->@location(0) vec4f{${shade.entry}
 let g=blendGrads(in);
 let invIor=transmitInvIor(in,g);
 if(invIor==1.0){discard;return vec4f(0.0);}
 let t=transmitSurface(in,front,g);
 if(!t.kept){discard;return vec4f(0.0);}
 let offset=transmitOffset(in,t.s,invIor);
 if(all(offset==vec4f(0.0))){discard;}
 return offset;
}
`

/** The distortion application, a full-screen pass. */
const DISTORTION_APPLY_TEXT = `// The distortion application, a full-screen pass whose pixels with no accumulated offset are
// dropped (\`distortedScene\`) — nothing bent them, the scene stays as it is —, on the full-screen
// triangle (\`FULLSCREEN_VERTEX\`).
@fragment fn fsDistortionApply(@builtin(position) position:vec4f)->@location(0) vec4f{return distortedScene(position.xy);}
`

/**
 * The transmissive layer lit in forward, as every translucent layer is (`blendFragment`,
 * `../shader.ts`): its diffuse layer under its coverage, its own specular — the declared
 * lights' and what it reflects (`surfaceReflection`, the blends' read) — kept apart from the
 * diffuse, the transmittance its blend multiplies the destination by, the fog over both. Its
 * shadows are the blends' (`declaredLightingSplit` on the blend's maps). No lobe: a glTF material
 * that transmits is shaded as a thin translucent surface, its transmission taking precedence over
 * a clear coat, and that thin model holds no clear coat nor anisotropy.
 */
export const transmitStagesWgsl = (o: StageOptions) => {
  const { graphs, shade, marks, depth } = o
  return wgslBlock(
    `TRANSMIT_WGSL(${stageLabel(o)})`,
    [
      ...stageImports(o),
      COVERED,
      marked(depth),
      thinLayerWgsl(o),
      modelFlag,
      FULLSCREEN_VERTEX,
      BLEND_PRE_EXPOSED_WGSL,
      ...(depth ? [BLEND_PUSHED_DEPTH_WGSL] : []),
    ],
    `${colourHeadText(o)}${marks ? `\n  ${translucentMarksFrom('flags')}` : ''}${colourStagesText(shade)}${coverageStageText('Transmit', 'transmitSurface', shade)}${responsiveStageText('Transmit', 'transmitSurface', '1.0', true, shade, depth)}${holdoutStageText(shade)}${distortionStagesText(shade, graphs)}${DISTORTION_APPLY_TEXT}`,
  )
}
