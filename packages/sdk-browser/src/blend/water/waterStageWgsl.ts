import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FLAG_DIAGNOSTIC_VIEW, FLAG_UNLIT_VIEW } from '../../visibility/types.ts'
import { declaredLightingSplitWgsl } from '../../lighting/direct/declaredLightingWgsl.ts'
import { translucentMarksFrom } from '../../lighting/direct/shadowWgsl.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { DEFAULT_TRANSLUCENT_SCENE, translucentLitKey, type TranslucentScene } from '../shader.ts'
import {
  stageImports,
  stageLabel,
  stageLobes,
  stageOptions,
  stagePrologue,
  stageSurface,
  type StageOptions,
} from '../stageOptions.ts'
import { fogFreeFlag, modelFlag } from '../../materials/surface/surfaceModelWord.ts'
import { SURFACE_F0_WGSL } from '../../materials/surface/surfaceSpecular.ts'
import { BLEND_TO_EYE_WGSL } from '../shaderSurface.ts'
import { GRAPH_FLAG } from '../graphWgsl.ts'
import type { SurfaceProgram } from '../../materials/graph/surfaceProgram.ts'
import { BLEND_PRE_EXPOSED_WGSL } from '../viewLayout.ts'
import { NO_VERTEX_READS, type CloudVertexText, type VertexReads } from '../cloudVertexText.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { ENVIRONMENT_BRDF_WGSL } from '../../lighting/direct/environmentBrdfWgsl.ts'
import { envBrdfF90 } from '../../../../math/src/wgsl/lighting.ts'
import { WATER_VOLUME_WGSL } from './waterVolumeWgsl.ts'
import { WATER_REFLECTION_CODE } from './waterLayout.ts'
import { WATER_EXCLUSION_WGSL } from './waterExclusionTable.ts'

/** The sun and reflection helpers of the water's shading: the forward sun's light, the
 *  reflection by mode and the split sun. */
const WATER_LIGHT_HELPERS_TEXT = `fn waterSunOf(P:vec3f,N:vec3f)->WaterSun{
 var sun=WaterSun(vec3f(0.0),vec3f(0.0,1.0,0.0),1.0,vec3f(0.0));
 let rank=directLights.forwardRank;
 if(rank==0u){return sun;}
 let index=rank-1u;
 let light=directLights.items[index];
 sun.toward=-light.directionCone.xyz;
 var color=light.colorIntensity.rgb*lightFunctionOf(light,P)*airTintOf(index,light,P);
 if(water.modes.z!=0u){color*=cloudShadowOnSurface(index,P);}
 sun.illuminance=color*lightStrength(light);
 sun.shadow=select(1.0,shadowFactor(i32(light.params.y),light,P,N,true),castsShadow(light));
 return sun;
}
fn waterReflection(f0:vec3f,rough:f32,N:vec3f,V:vec3f,P:vec3f,position:vec4f)->vec3f{
 let mode=water.modes.x;
 if(mode==${WATER_REFLECTION_CODE.disabled}u){return vec3f(0.0);}
 if(mode==${WATER_REFLECTION_CODE.captures}u){return reflectionShare(forwardTrace(P,N,V,rough,position,false),f0,rough,N,V);}
 return surfaceReflection(f0,rough,N,V,P,position);
}
struct WaterOut{@location(0) color:vec4f,@location(1) request:u32,@location(2) normal:vec4f,@location(3) specular:vec4f,@location(4) sun:vec4f,}
const WATER_NONE=WaterOut(vec4f(0.0),0u,vec4f(0.0),vec4f(0.0),vec4f(0.0));
// The forward directional light alone, lit as the walk of the lights lights it (\`sliceLightingSplit\`), for the
// water that keeps its sun apart: the walk's sum less this, and this written beside.
fn waterSunSplit(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f)->LightSplit{
 let rank=directLights.forwardRank;
 if(rank==0u){return LightSplit(vec3f(0.0),vec3f(0.0));}
 let shading=clothSurface(lobeSurface(rgb,metal,rough,N,V));lobeView(shading);
 return declaredLightSplit(rank-1u,rgb,metal,rough,N,V,P,shading);
}
`

/** The cut of the variant for a world with an exclusion volume: the fragment lies in a volume that excludes its body, so neither its colour
 *  nor its depth is drawn (`fsWater`, `fsWaterDepth` ask the same). The body's rank is read from the vertex stage's lane (`waterBodyRank`, `waterBodyLane.ts`). */
const WATER_CUT_TEXT = `fn waterCut(in:VSOut)->bool{return waterExcluded(in.view,waterBodyRank(in));}
`

/** The head of the water's fragment, up to its lit section. */
const waterFragmentHeadText = (
  exclusion: boolean,
) => `fn waterFragment(in:VSOut,front:bool)->WaterOut{
 let flags=in.ids.y;
 // Every derivative wants uniform control flow: taken before the coverage test returns.
 let deltas=fwidth(in.bary);
 let surfaceDepth=dot(water.clipW,vec4f(in.view,1.0));
 let slope=max(abs(dpdxFine(surfaceDepth)),abs(dpdyFine(surfaceDepth)));
 let g=blendGrads(in);
 let layer=blendLayer(in,front,g);
 if(!layer.kept${exclusion ? '||waterCut(in)' : ''}){discard;return WATER_NONE;}
 let s=layer.s;
 if((flags&${FLAG_DIAGNOSTIC_VIEW}u)!=0u){return WaterOut(blendDiagnosticOut(in,s,deltas).color,s.request,vec4f(0.0),vec4f(0.0),vec4f(0.0));}
 let V=blendToEye(in);
 let unlit=(flags&${FLAG_UNLIT_VIEW}u)!=0u;
 let coverage=clamp(s.alpha,0.0,1.0);
 var rgb=s.emissive;
 var sunLuminance=vec3f(0.0);
 // A held-out object's water is black and no water to the composite: nothing of it is lit.
 let held=holdoutPrimitive(in);
 if(!unlit&&!held){
`

/** What the water graph adds to the volume: its scattering, absorption and refraction. */
const WATER_GRAPH_VOLUME_WGSL = ` if((g.graph.flags&${GRAPH_FLAG.water}u)!=0u){scatter=g.graph.scatter;absorb=g.graph.absorb;phaseG=g.graph.phaseG;colorScale=g.graph.colorScale;}
  if((g.graph.flags&${GRAPH_FLAG.refraction}u)!=0u){graphIor=g.graph.refraction;}
`

/** The lit section of the water's fragment: the lights, the ambient light and the volume. */
const waterLitWgsl = (o: StageOptions) => `  surfaceModel=modelFlag(flags);
  ${stagePrologue(o, '  ', 'water')}${o.marks ? `\n  ${translucentMarksFrom('flags')}` : ''}
  // The projection of the shadow maps lays the sun's shadow on the separated sun afterwards, where the image projects it (water.filters.x).
  shadowSkipSun=water.filters.x!=0u;
  ${o.graphs ? 'surfaceSpecular=s.specular;' : ''}
  let f0=surfaceF0(s.rgb,s.metal);
  var lit=declaredLightingSplit(s.rgb,s.metal,s.rough,s.N,V,in.view,in.position.xy,in.position.z);
  let separate=water.filters.y!=0u;
  if(separate){
   let sun=waterSunSplit(s.rgb,s.metal,s.rough,s.N,V,in.view);
   lit=LightSplit(max(lit.diffuse-sun.diffuse,vec3f(0.0)),max(lit.specular-sun.specular,vec3f(0.0)));
   sunLuminance=coverage*sun.diffuse+sun.specular;
  }
  // The base material's diffuse, over the water, and what it takes of the ambient light.
  let indirect=translucentGiIrradiance(in.view,s.N,false);
  rgb+=coverage*(lit.diffuse+lambertDiffuse(s.rgb,s.metal,indirect,s.ao)+environmentLighting(s.rgb,s.metal,s.N,s.ao))+lit.specular;
  let ambient=indirect+environmentIrradiance(s.N);
  let fresnel=environmentBrdf(f0,envBrdfF90(f0),s.rough,max(0.0,dot(s.N,V)));
  var scatter=vec3f(0.0);var absorb=vec3f(0.0);var phaseG=0.0;var colorScale=vec3f(1.0);var graphIor=0.0;
${o.graphs ? WATER_GRAPH_VOLUME_WGSL : ''}  let volume=waterVolume(in,surfaceDepth,slope,s.N,V,${o.graphs ? 's.specular' : '0.5'},graphIor,scatter,absorb,phaseG,colorScale,waterSunOf(in.view,s.N),ambient,fresnel,1.0-coverage,separate);
  rgb+=volume.luminance;
  sunLuminance+=volume.sunLuminance;
 }
`

/** The cloud shade, the surface the composite reads, and the entry `fsWater`. The water is laid unfogged: the fog is laid over the image after the water, as the sequence of the sky and the fog has it (`encodeAfterWater`). */
const waterFragmentTailWgsl = (shade: CloudVertexText) => ` // The unlit view keeps what it emits.
 if(!unlit&&!held&&!(${fogFreeFlag('flags')})){${shade.apply}}
 // What the composite reads of the water: its surface, and that there is water (specular alpha). Only the surface colour is held
 // to the greatest emission; the separated sun and the reflection are written whole, as they are added. The water
 // is an opaque surface of the image: its alpha, the share of the background it leaves visible, is 0 — 1 and
 // black where its object is held out (\`holdoutPrimitive\`), where it is no water for the composite either.
 let f0=surfaceF0(s.rgb,s.metal);
 return WaterOut(vec4f(select(preExposedClipped(rgb),vec3f(0.0),held),select(0.0,1.0,held)),s.request,vec4f(s.N,s.rough),vec4f(f0,select(1.0,0.0,unlit||held)),vec4f(preExposed(sunLuminance),1.0));
}
@fragment fn fsWater(in:VSOut,@builtin(front_facing) front:bool)->WaterOut{${shade.entry}
 return waterFragment(in,front);
}
`

/** The reflection composite entry `fsWaterComposite`. */
const waterCompositeWgsl =
  () => `// The reflection composite (fsWaterComposite), drawn over the water's tiles or the whole target: the
// reflection of the water's surface — its normal, roughness and reflectance as the shading wrote
// them —, weighed on its reflectance (\`surfaceReflection\`), faded in over the first 50 cm of water
// above the scene (to hide the triangles at the shore), added over the water, with the separated sun. A
// pixel that is no water, or whose scene without the water is not behind it, draws nothing.
@fragment fn fsWaterComposite(@builtin(position) position:vec4f)->@location(0) vec4f{
 let size=uni.viewport;
 let at=vec2i(position.xy);
 let z=textureLoad(waterDepthTexture,at,0);
 let surfaceDepth=waterLinearDepth(position.xy,size,z);
 let slope=max(abs(dpdxFine(surfaceDepth)),abs(dpdyFine(surfaceDepth)));
 let specular=textureLoad(waterSpecular,at,0);
 if(specular.a<0.5||(uni.viewFlags&${FLAG_UNLIT_VIEW | FLAG_DIAGNOSTIC_VIEW}u)!=0u){discard;}
 let surface=textureLoad(waterNormals,at,0);
 let P=waterWorldAt(position.xy,size,surfaceDepth);
 let V=normalize(uni.camPos.xyz-P*uni.camPos.w);
 let behind=waterBehind(clamp(position.xy/size,water.bounds.xy,water.bounds.zw),surfaceDepth,slope);
 let delta=(behind.depth-surfaceDepth)*WATER_CM;
 if(delta<=0.0){discard;}
 let reflection=waterReflection(specular.rgb,surface.w,normalize(surface.xyz),V,P,vec4f(position.xy,z,1.0));
 // The separated sun, already multiplied by its shadow (waterSunShadow.ts).
 let sun=textureLoad(waterSun,at,0).rgb;
 return vec4f(preExposed(reflection*saturate(delta*0.02))+sun,1.0);
}
`

/** The depth-only entry `fsWaterDepth`. */
const waterDepthWgsl = (
  shade: CloudVertexText,
  exclusion: boolean,
) => `// The water's depth alone (\`singleLayerWaterDepthPrepass\`): the fragments the shading keeps.
@fragment fn fsWaterDepth(in:VSOut,@builtin(front_facing) front:bool){${shade.entry}
 let g=blendGrads(in);
 let base=blendBase(in,g);
 if(!blendKeeps(in,base,front)${exclusion ? '||waterCut(in)' : ''}){discard;}
}
`

/**
 * THE WATER'S FRAGMENT (`fsWater`), the colour of a pixel of single-layer water, written over the
 * scene (no blend: the scene behind is read from its copy, `waterVolume`): the surface lit by the
 * declared lights as a physical surface (its diffuse share under the coverage the base material has
 * over the water, `s.alpha`, its specular share whole), its ambient light and emission, the volume
 * (`waterVolume`, over the visibility the coverage leaves) over all; and writes the surface
 * the reflection composite reads (`WaterOut`). The reflection is no part of it: no image-based light of the
 * water is added here, the composite adds it (`fsWaterComposite`) from the transparents' front
 * layer (`surfaceReflection`: the traced radiance where the water is the front surface of its pixel,
 * else the field's), weighed on the surface's reflectance as every reflection is; `singleLayerWaterReflection`
 * picks it (`water.modes.x`): none, the field alone (the captures and the sky), or the front layer. The sun of the volume is the
 * forward directional light (`directLights.forwardRank`), its colour times its light function and
 * the air's transmittance toward it, its shadow the shadow maps' (laid on the separated sun, `waterSunShadow.ts`).
 */
const waterStage = (o: StageOptions, exclusion: boolean) =>
  wgslBlock(
    `WATER_STAGE_WGSL(${stageLabel(o)})`,
    [
      ...stageImports(o),
      WATER_VOLUME_WGSL,
      ENVIRONMENT_BRDF_WGSL,
      envBrdfF90,
      FULLSCREEN_VERTEX,
      SURFACE_F0_WGSL,
      BLEND_TO_EYE_WGSL,
      BLEND_PRE_EXPOSED_WGSL,
      modelFlag,
      ...(exclusion ? [WATER_EXCLUSION_WGSL] : []),
    ],
    (exclusion ? WATER_CUT_TEXT : '') +
      WATER_LIGHT_HELPERS_TEXT +
      waterFragmentHeadText(exclusion) +
      waterLitWgsl(o) +
      waterFragmentTailWgsl(o.shade) +
      waterCompositeWgsl() +
      waterDepthWgsl(o.shade, exclusion),
  )

/**
 * The water stage of the blend module of `key` (`../shader.ts`): `fsWater`, the water's fragment
 * (`waterStage`), on the lights split as the transmissive layers' are, and the surface read as theirs
 * (`stageSurface`). Only a scene with single-layer water holds it; the module's text is otherwise
 * what it was. The water casts no contact shadow ray of its own, it is no translucent blend mode in the reference: its prologue is the
 * water's (`stagePrologue`), which sets no ask (`asksContact`), so its ray never marches, while its lights are
 * the module's (`scene`, as the transmissive stages' are, one text of the split term's functions in a module that holds
 * both); where the scene holds contact shadows, the water's light block holds the code.
 */
export const waterWgsl = (
  key: Partial<ContractKey>,
  graphs?: readonly SurfaceProgram[],
  reads: VertexReads = NO_VERTEX_READS,
  marks = false,
  scene: TranslucentScene = DEFAULT_TRANSLUCENT_SCENE,
  exclusion = false,
) => {
  const lit = translucentLitKey(key, scene)
  const o = stageOptions(lit, graphs, reads, marks)
  return wgslBlock(
    `waterWgsl(${stageLabel(o)}${exclusion ? ', exclusion volumes' : ''})`,
    [stageSurface(stageLobes(o), graphs), declaredLightingSplitWgsl(lit), waterStage(o, exclusion)],
    '',
  )
}
