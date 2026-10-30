import { layerBody, layerEntry } from './sceneEntry.ts'
import { FRONT_MARK } from '../lighting/manyLightsSampled/frontLightWgsl.ts'
import { translucentMarksFrom } from '../lighting/direct/shadowWgsl.ts'
import { MODEL_FLAG, fogFreeFlag, modelFlag } from '../materials/surface/surfaceModelWord.ts'
import { lightlessLane } from '../materials/surface/translucencyLighting.ts'
import { catcherAlpha } from '../materials/surface/surfaceModel.ts'
import { BLEND_LIGHTING, BLEND_LIGHTING_CODES_WGSL } from '../materials/surface/blendLightSource.ts'
import { PIXEL_MODEL, pixelModelOf } from '../materials/surface/pixelModel.ts'
import { blendRequestWgsl } from './requestWgsl.ts'
import * as itemFlags from '../visibility/types.ts'
import { BLEND_TO_EYE_WGSL, blendLit } from './shaderSurface.ts'
import { DIAGNOSTIC_PALETTE_WGSL } from '../diagnostic/colors.ts'
import { DIAGNOSTIC_VIEWS } from '../visibility/shader/shadeMode.ts'
import { DISPLAY_MASK_GROUP, DISPLAY_ROUTE_WGSL, displayMaskWgsl } from './display/displayFilter.ts'
import type { CloudVertexText } from './cloudVertexText.ts'
import { TRI_CHANNELS_SHIFT, WORDS } from './vertexReadsWgsl.ts'
import {
  stageImports,
  stageLabel,
  stageLobes,
  stagePrologue,
  type StageOptions,
} from './stageOptions.ts'
import { BLEND_LOBELESS_WGSL } from './physicalWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wireframeEdge } from '../../../math/src/wgsl/barycentric.ts'
import { BLEND_PRE_EXPOSED_WGSL } from './viewLayout.ts'
import {
  TRANSLUCENCY_LIGHTING_CODES_WGSL,
  translucencyLightingOf,
  translucencyMedium,
} from '../lighting/translucency/modeWgsl.ts'
import { holdoutStageText } from './holdoutWgsl.ts'
import { COVERED, coverageStageText, marked, responsiveStageText } from './layerStagesWgsl.ts'
import { modeIs } from '../materials/surface/materialBlending.ts'
import { BLEND_PUSHED_DEPTH_WGSL } from './pushedDepthWgsl.ts'
import { oitCollectWgsl } from './oit/oitWgsl.ts'
import { OIT_DEPTH_FOLDED_WGSL } from './objectShadow/objectShadowSelfWgsl.ts'

/** A blend layer's prologue and the lights it reads (`blendLayer`, `blendLightsSet`, `blendLights`). */
const blendLayerText = (o: StageOptions) => `${BLEND_DIAGNOSTIC}
// A blend layer's surface, its stages' one prologue after their derivatives \`g\`: \`kept\` false for
// a fragment the material rejects (\`blendKeeps\`), or a dashed line's gap (\`lineDash\`: its distance
// along the line rides the first coordinate), which the stage discards before anything else is
// read; else its lobes begun and its surface (\`blendSurface\`).
struct BlendLayer{kept:bool,s:BlendSurface,}
fn blendLayer(in:VSOut,front:bool,g:BlendGrads)->BlendLayer{
 var l:BlendLayer;
 let base=blendBase(in,g);
 if(!blendKeeps(in,base,front)||!lineDash(in.uv.x,in.alphaAo.zw)){return l;}
 blendPhysicalBegin(in,g);
${stageLobes(o) && o.graphs ? ' blendGraphLobes(g.graph);\n' : ''} l.kept=true;
 l.s=blendSurface(in,front,g,base);
 return l;
}
// The layer's surface model, thin back, merged coat, declared specular and lobes, set before any light, bounce or
// reflection of it is read.
fn blendLightsSet(in:VSOut,front:bool,g:BlendGrads,s:BlendSurface,V:vec3f){
 surfaceModel=modelFlag(in.ids.y);
 ${stagePrologue(o, ' ')}${o.marks ? `\n ${translucentMarksFrom('in.ids.y')}` : ''}
 thinSubsurface=s.subsurface;
${o.graphs ? ' surfaceSpecular=s.specular;\n' : ''}${stageLobes(o) ? ' if(physicalOn&&blendLobeValues.specular>=0.0){surfaceSpecular=blendLobeValues.specular;}\n' : ''} blendLobes(in,front,g,s,V,s.rough);
}
// The layer's declared lights, each read for the pixel, its surface set first.
fn blendLights(in:VSOut,front:bool,g:BlendGrads,s:BlendSurface,V:vec3f)->vec3f{
 blendLightsSet(in,front,g,s,V);
 return declaredLighting(s.rgb,s.metal,s.rough,s.N,V,in.view,in.position.xy,in.position.z);
}
`

/** The nearest translucent layer lit by the sampled lighting (\`sampledLightsFrontLayer\`): the light the sampled lighting left for the pixel lies in the second half of the front's traced radiance
 *  (\`frontTraced\`, twice the view tall while the layer is lit by it, \`frontLayer.ts\`), as three half floats and a mark in two words; a fragment of the front's depth reads it where the mark is set,
 *  un-exposed to go through the blend's pre-exposure again. */
const frontLitText =
  () => `fn frontLitRow(position:vec4f)->vec2i{return vec2i(i32(position.x),i32(position.y)+i32(textureDimensions(frontTraced).y/2u));}
fn frontLitHere(position:vec4f)->bool{
 return textureDimensions(frontTraced).y>=2u*u32(uni.viewport.y)&&frontDepthMatches(vec2i(position.xy),position.z)&&textureLoad(frontTraced,frontLitRow(position)).y!=0u;
}
fn frontLitLight(position:vec4f)->vec3f{
 let t=textureLoad(frontTraced,frontLitRow(position));
 return vec3f(unpack2x16float(t.x),unpack2x16float(t.y).x)/max(uni.preExposure,1e-20);
}
/** What the mark of a lit texel says (\`FRONT_MARK\`): the sampled light holds no diffuse light, or no sun. */
fn frontLitMark(position:vec4f)->u32{return u32(unpack2x16float(textureLoad(frontTraced,frontLitRow(position)).y).y+0.5);}
/** The suns' light of the layer by the forward loop, where the sampled light holds none (the directional lights are not part of it): the lights of the cell the fragment stands in that are suns. */
fn frontSunLighting(s:BlendSurface,V:vec3f,P:vec3f,pixel:vec2f,z:f32)->vec3f{
 vsmTraceAt(pixel);
 let slice=cellSlice(gridCell(pixel,z,vec2u(uni.lightTiles)));
 var result=vec3f(0.0);
 let shading=clothSurface(lobeSurface(s.rgb,s.metal,s.rough,s.N,V));lobeView(shading);
 for(var index=0u;index<slice.y;index++){
  let rank=listedLight(slice,index);
  if(!listedDrawn(slice,rank)||!isSun(directLights.items[rank])){continue;}
  result+=declaredLight(rank,s.rgb,s.metal,s.rough,s.N,V,P,1.0,shading);
 }
 return result;
}
`

/** The call that reads the translucency lighting volume for the fragment `in`: the plain read, or, in a program that reads its object's shadow, the read less the sun's part its own object
 *  shadows (`translucencyVolumeLightSelf`, `selfShadowRecordOf`). */
const volumeLightCall = (selfShadow: boolean) =>
  selfShadow
    ? `translucencyVolumeLightSelf(s.rgb,s.metal,s.N,in.view,translucencyLightingOf(flags),in.position.xy,V,s.subsurface,pixelModelOf(flags)==${PIXEL_MODEL.subsurface}u,selfShadowRecordOf(in))`
    : 'translucencyVolumeLight(s.rgb,s.metal,s.N,in.view,translucencyLightingOf(flags),in.position.xy)'

/** The light of a layer by how its material is lit (`blendLightsOf`): the mode alone says it, whatever the layer's blend mode, and the
 *  plan puts each layer in the pipeline of its lighting (`BLEND_LIGHTINGS`, `blendLightingOf`), so the pipeline's constant `BLEND_LIGHTING`
 *  folds the other lightings' code away. Forward, each declared light read for the pixel, and a shadow catcher always; in a volume mode no
 *  declared light, and, with `volume`, the translucency lighting volume's at the point (`translucencyVolumeLight`) in a normal or
 *  additive layer of a surface the volume lights (`volumeLightsShading`, `LIGHTLESS_MODEL`) in the volume pipeline alone; a medium has no
 *  reflection (`blendMedium`). */
const blendLightsOfText = (
  volume: boolean,
  sampledFront: boolean,
  selfShadow = false,
) => `// The lighting program this pipeline draws (\`BLEND_LIGHTINGS\`), one constant of the pipeline: the code of the other lightings is folded away.
override ${BLEND_LIGHTING}:u32=0u;
// The layer's light, by its material's lighting mode (\`translucencyLightingOf\`): forward lights it with the declared lights, a shadow
// catcher always; a volume mode lights it with no declared light${volume ? ", but, in a normal or additive layer of a surface the volume lights, the translucency lighting volume's at its point" : ''}.
fn blendLightsOf(in:VSOut,front:bool,g:BlendGrads,s:BlendSurface,V:vec3f,flags:u32)->vec3f{
 if(${BLEND_LIGHTING}==L_FORWARD&&(translucencyLightingOf(flags)==TL_FORWARD||modelFlag(flags)==${MODEL_FLAG.shadow}u)){${
   sampledFront
     ? `
  if(frontLitHere(in.position)){
   blendLightsSet(in,front,g,s,V);
   let mark=frontLitMark(in.position);
   var lit=frontLitLight(in.position);${
     volume
       ? `
   // The layer that keeps the specular light alone takes the diffuse light of the translucency volume (and not its specular).
   if((mark&${FRONT_MARK.specularOnly}u)!=0u){lit+=${volumeLightCall(selfShadow)};}`
       : ''
   }
   if((mark&${FRONT_MARK.sunsApart}u)!=0u){lit+=frontSunLighting(s,V,in.view,in.position.xy,in.position.z);}
   return lit;
  }
 `
     : ''
 }return blendLights(in,front,g,s,V);}
 blendLightsSet(in,front,g,s,V);
${
  volume
    ? ` if(${BLEND_LIGHTING}==L_VOLUME&&(${modeIs('normal', 'additive')})&&!lightlessLane(flags)){
  return ${volumeLightCall(selfShadow)};
 }
`
    : ''
} return vec3f(0.0);
}
// Whether the material is lit as a medium, which reflects nothing: the volume's two media modes, whatever the blend mode.
fn blendMedium(flags:u32)->bool{return translucencyMedium(flags);}
// Whether the layer reflects nothing: a hair (the vertex stage carries its pixel model in the flags, \`blendShadingFlags\`), or a medium.
fn blendUnreflecting(flags:u32)->bool{return pixelModelOf(flags)==${PIXEL_MODEL.hair}u||blendMedium(flags);}
`

/** The fragment function of the blend stage: unlit, lit, lit from the volume, diagnostic; the pipeline of the unlit lighting holds no light, bounce or reflection. */
const blendFragmentBodyText = (
  volume: boolean,
  graphs: boolean,
  shade: CloudVertexText,
) => `// The share of the fog's inscattering a layer takes: none for an additive one, its \`alpha\` for one whose
// colour is already weighed by it, all for the others.
fn inscatterShare(alpha:f32)->f32{
 if(${modeIs('additive')}){return 0.0;}
 if(${modeIs('alphaComposite', 'alphaHoldout')}){return alpha;}
 return 1.0;
}
fn blendFragment(in:VSOut,front:bool,masked:f32)->BlendOut{
 // Every derivative wants uniform control flow: taken before the coverage test returns.
 let deltas=fwidth(in.bary);
 let g=blendGrads(in);
 // The item's flags, the shading model its graph picks per pixel (\`blendGraphFlags\`) read into them.
 let flags=${graphs ? 'blendGraphFlags(in.ids.y,g.graph)' : 'in.ids.y'};
 let layer=blendLayer(in,front,g);
 if(!layer.kept){discard;return BlendOut(vec4f(0.0),0u,vec4f(0.0),vec4f(0.0));}
 let s=layer.s;
 if((flags&${itemFlags.FLAG_DIAGNOSTIC_VIEW}u)!=0u){return blendDiagnosticOut(in,s,deltas);}
 var rgb=s.rgb;
 var alpha=s.alpha;
 // No declared lamp, or an unlit view requested: the raw albedo and its emission, exactly like
 // the opaque resolve. Neither ambient, nor sky, nor a default sun (P6).
 let unlit=(flags&${itemFlags.FLAG_UNLIT_VIEW}u)!=0u;
 let V=blendToEye(in);
 let clamped=s.rough;
 if(!unlit){
  if(${BLEND_LIGHTING}!=L_UNLIT&&blendLit(flags)){
   let m=s.metal;
   let lights=blendLightsOf(in,front,g,s,V,flags);
   // A shadow catcher keeps its colour and is seen as far as the shadows fall on it.
   if(surfaceModel==${MODEL_FLAG.shadow}u){alpha=catcherAlpha(alpha,lights);}
   else{
    // The bounce, one fetch of the translucency global illumination volume, and the reflection (\`forwardIndirect\`); only the non-directional mode takes the volume's constant band.
    translucentGiSingle=translucencyLightingOf(flags)==TL_NON_DIRECTIONAL;
    let indirect=forwardIndirect(rgb,m,indirectF0(rgb,m),clamped,s.N,V,in.view,in.position,s.ao,!blendUnreflecting(flags));
    rgb=litSurface(lights,indirect[0],environmentLighting(rgb,m,s.N,s.ao),indirect[1],s.emissive,s.N,in.view,s.ao);
   }
  }
  // Lit, the surface is seen through the fog; unlit, it keeps what it emits.
  // The fog's inscattering is laid whole over a normal layer, at the layer's opacity over one composed
  // premultiplied or one that holds out (the colour is already weighed by it), and not at all over an
  // additive one, which the fog only dims. A layer that multiplies the scene fades to what leaves it as
  // it is by the square of the fog's transmittance: one for multiply, nothing subtracted for subtractive.
  if(!(${fogFreeFlag('flags')})){
   let fog=blendFog(in);
   if(${modeIs('subtractive', 'multiply')}){
    let t2=fog.a*fog.a;
    rgb=select(mix(vec3f(1.0),rgb,t2),rgb*t2,${modeIs('subtractive')});
   }else{
    rgb=rgb*fog.a+fog.rgb*inscatterShare(alpha);
   }
   ${shade.apply}
  }
 }else{rgb+=s.emissive;}
 // The light is written multiplied by the image's pre-exposure, as the opaque resolve writes it.
 // A held-out object (\`holdoutPrimitive\`) writes black at its coverage.
 let hdr=select(preExposedClipped(rgb),vec3f(0.0),holdoutPrimitive(in));
 let r=displayRoute(hdr,uni.exposure,uni.toneCurve,unlit,alpha,masked,uni.bake);
 return BlendOut(vec4f(hdr,alpha*r.keep),s.request,r.tint,r.add);
}
`

/** The holdout stage and the colour entry points (`fs`, `fsFiltered`). */
const blendEntriesText = (shade: CloudVertexText) => `${holdoutStageText(shade)}
// The reflection's resources are group 1 (\`REFLECTION_GROUP\`); a filtered image's pipelines read
// the display mask (group 2), every other one reads none.
${layerEntry('fs', 'BlendOut', shade.entry)}
${layerBody('fs', 'BlendOut')}{return blendFragment(in,front,0.0);}
${layerEntry('fsFiltered', 'BlendOut', shade.entry)}
${layerBody('fsFiltered', 'BlendOut')}{return blendFragment(in,front,maskAt(in.position));}
`

/** The fragment stage of the runs, its surface, lobes, channel test and contact shadows those of its options
 *  (`StageOptions`) and its entry points; with `graphs`, the lobes and the specular of the items' graphs are set before it
 *  lights a fragment; `shade`, the words of the clouds per vertex (`cloudVertexText.ts`); with `volume`, the light of a
 *  surface whose material is lit from the translucency lighting volume is the volume's
 *  (`blendLightsOf`), and a medium has no reflection; with `oit`, it holds the stage that collects the layers a pixel sorts
 *  (`oit/oitWgsl.ts`). */
export const blendFragmentWgsl = (
  o: StageOptions & {
    readonly volume: boolean
    readonly oit?: boolean
    /** The program reads its object's shadow in its volume read (`selfShadowText`). */
    readonly selfShadow?: boolean
    /** The sorted translucency reads the depth it tests against from the packed table (`OIT_DEPTH_FOLDED_WGSL`), its collect group binding none. */
    readonly foldedDepth?: boolean
  },
) => {
  const { graphs, shade, depth, volume, oit, selfShadow, foldedDepth } = o,
    lobes = stageLobes(o)
  return wgslBlock(
    `blendFragmentWgsl(${stageLabel(o)}${volume ? ', translucency volume' : ''}${volume && selfShadow ? ', self shadow' : ''}${oit ? `, sorted pixels${foldedDepth ? ', folded depth' : ''}` : ''})`,
    [
      ...stageImports(o),
      ...(oit ? [oitCollectWgsl(shade, foldedDepth ? OIT_DEPTH_FOLDED_WGSL : undefined)] : []),
      COVERED,
      marked(depth),
      ...(depth ? [BLEND_PUSHED_DEPTH_WGSL] : []),
      blendRequestWgsl(lobes),
      BLEND_PRE_EXPOSED_WGSL,
      DISPLAY_ROUTE_WGSL,
      displayMaskWgsl(DISPLAY_MASK_GROUP),
      ...(lobes ? [] : [BLEND_LOBELESS_WGSL]),
      blendLit,
      BLEND_TO_EYE_WGSL,
      modelFlag,
      lightlessLane,
      pixelModelOf,
      catcherAlpha,
      BLEND_LIGHTING_CODES_WGSL,
      TRANSLUCENCY_LIGHTING_CODES_WGSL,
      translucencyLightingOf,
      translucencyMedium,
      wireframeEdge,
      DIAGNOSTIC_PALETTE_WGSL,
    ],
    `${blendLayerText(o)}${o.sampledFront ? frontLitText() : ''}${blendLightsOfText(volume, o.sampledFront, volume && !!selfShadow)}${blendFragmentBodyText(volume, graphs, shade)}${blendEntriesText(shade)}${coverageStageText('Blend', 'blendLayer', shade)}${responsiveStageText('Blend', 'blendLayer', 'layer.s.alpha', false, shade, depth)}`,
  )
}

/** A diagnostic view's colour (`FLAG_DIAGNOSTIC_VIEW`), the view's code beside it
 *  (`blendDiagnosticCode`), in place of the lit surface: the wireframe's edges, every other view's
 *  colour the opaque resolve's (`diagnosticColor`), of the cluster word and triangle the vertex
 *  stage passed. Every fragment stage of the runs that colours a
 *  diagnostic view reads it. */
const BLEND_DIAGNOSTIC = `fn blendDiagnosticOut(in:VSOut,s:BlendSurface,deltas:vec3f)->BlendOut{
  if(s.alpha<=0.01){discard;}
  let mode=blendDiagnosticCode(uni.viewFlags);
  // The wireframe and the x-ray view: the wire colour at the coverage of the barycentrics' edges,
  // nothing where it is 0; a transparent item carries no mobility here, so it wears the still
  // colour, premultiplied by its coverage as the pass blends it. The opaque edges are drawn over the
  // image after this pass (\`../visibility/xray.ts\`).
  if(mode==${DIAGNOSTIC_VIEWS.wireframe.code}u||mode==${DIAGNOSTIC_VIEWS.xray.code}u){
   let coverage=wireframeEdge(in.bary,deltas);
   if(coverage==0.0){discard;}
   return BlendOut(vec4f(diagnosticWireColor(false)*coverage,coverage),s.request,vec4f(1.0),vec4f(0.0));
  }
  // The screen-error view's word is the cluster's world error (\`diagnosticWorldError\`), measured at
  // this pixel's clip w.
  let depth=(uni.viewProj*vec4f(in.view,1.0)).w;
  var screenError=0.0;
  if(mode==${DIAGNOSTIC_VIEWS['screen-error'].code}u){screenError=diagnosticScreenError(bitcast<f32>(in.${WORDS.diagId}),depth,uni.viewProj,uni.viewport,uni.pixelRatio,uni.pixelError);}
  let shown=diagnosticColor(mode,DiagnosticPixel(in.${WORDS.diagId},in.${WORDS.tri}&${(1 << TRI_CHANNELS_SHIFT) - 1}u,in.${WORDS.diagId},0u,s.rgb+s.emissive,s.geometric,screenError));
  return BlendOut(vec4f(shown,1.0),s.request,vec4f(1.0),vec4f(0.0));
}`
