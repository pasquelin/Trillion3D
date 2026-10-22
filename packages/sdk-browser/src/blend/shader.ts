import { declaredLightingWgsl } from '../lighting/direct/declaredLightingWgsl.ts'
import * as surfaceModel from '../materials/surface/surfaceModel.ts'
import { bounceApplyWgsl } from '../lighting/bounce/applyWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../lighting/standardLighting.ts'
import {
  BLEND_BINDINGS,
  BLEND_FOG_BINDINGS,
  BLEND_TRACE_BINDINGS,
  BLEND_VSM_BINDINGS,
} from '../gpu/bind/bindLayout.ts'
import { blendRequestWgsl } from './requestWgsl.ts'
import * as itemFlags from '../visibility/types.ts'
import { BLEND_TO_EYE_WGSL, blendLit, blendSurfaceWgsl } from './shaderSurface.ts'
import { DIAGNOSTIC_PALETTE_WGSL } from '../diagnostic/colors.ts'
import { DIAGNOSTIC_VIEWS } from '../visibility/shader/shadeMode.ts'
import { DISPLAY_MASK_GROUP, DISPLAY_ROUTE_WGSL, displayMaskWgsl } from './display/displayFilter.ts'
import { blendVertexWgsl, cutBlendByPixel } from './vertexWgsl.ts'
import { TRI_CHANNELS_SHIFT } from './vertexReadsWgsl.ts'
import { BLEND_LOBELESS_WGSL, BLEND_PHYSICAL_WGSL } from './physicalWgsl.ts'
import { type ContractKey, variantLabel } from '../lighting/deferred/contractCuts.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { type WgslDecl, wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wireframeEdge } from '../../../math/src/wgsl/barycentric.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from '../lighting/reflections/viewLayout.ts'
import { f0Of } from '../../../math/src/wgsl/lighting.ts'
import { forwardIndirectWgsl } from '../lighting/reflections/forward.ts'
import { BLEND_MAPS_WGSL } from './mapsWgsl.ts'
import { clipDirective, type Clipping } from '../gpu/core/clipDistances.ts'

/** The blend module; its light loop without the shadow or the rectangle code `key` leaves out
 *  (`declaredLightingWgsl`), the program of a scene that holds none (`pipelines.ts`). Without
 *  `lobeless`, a scene whose blend carries an anisotropic or clear-coat lobe: its fragment sets
 *  them (`physicalWgsl.ts`), its lights, environment, bounce and reflection go through them, a
 *  fragment
 *  without them summing the very same terms (`../lighting/direct/lobesWgsl.ts`). */
const blendProgram = (key: Partial<ContractKey>, subgroups: boolean, clipping?: Clipping) => {
  const lobes = !key.lobeless
  const bindings = {
    transmittance: BLEND_BINDINGS.shadowTransmittance,
    vsm: BLEND_VSM_BINDINGS,
    trace: { ...BLEND_TRACE_BINDINGS, subgroups },
    fog: BLEND_FOG_BINDINGS,
  }
  return wgslBlock(
    `blendProgram(${variantLabel(key)}, ${subgroups}${clipping ? `, ${clipping}` : ''})`,
    [
      blendVertexWgsl(lobes, clipping),
      STANDARD_LIGHTING_WGSL,
      declaredLightingWgsl(bindings, key),
      bounceApplyWgsl(BLEND_BINDINGS.bounceGrid, BLEND_BINDINGS.probes),
      blendSurfaceWgsl(lobes),
      forwardIndirectWgsl(REFLECTION_GROUP, lobes, BLEND_BINDINGS.frontTraced),
      reflectionLightViewWgsl(REFLECTION_GROUP),
      f0Of,
      ...(lobes ? [BLEND_PHYSICAL_WGSL] : []),
      blendFragmentWgsl(lobes),
      BLEND_MAPS_WGSL,
    ],
    `@group(0) @binding(${BLEND_BINDINGS.directLights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${BLEND_BINDINGS.tileLights}) var<storage,read> tileLights:array<u32>;
// The blended colour, the tile rank this pixel asks of the virtual textures, in its own target
// (no memory write: early reject kept), the as-is share, the display layers (\`displayFilter.ts\`)
// and what the layer gives up of the temporal history (\`blendGivenUp\`).
struct BlendOut{@location(0) color:vec4f,@location(1) request:u32,@location(2) asIs:vec4f,@location(3) tint:vec4f,@location(4) add:vec4f,@location(5) givenUp:f32,}`,
  )
}

/** The dual blend enabled (`fsTransmitDual`, `./transmission/transmitWgsl.ts`). */
const DUAL_SOURCE_WGSL = wgslBlock('DUAL_SOURCE_WGSL', [], 'enable dual_source_blending;')

/** The blend module's text (`blendProgram`), with what a pass adds to it: the transmissive stages
 *  (`stage`, `./transmission/transmitWgsl.ts`), the dual blend enabled for them where the device
 *  grants it (`dual`), a diagnostic variant's entries (`diagnostic`); its shadow traces vote over
 *  the subgroup where the device grants subgroups (`subgroups`); made to cut at the view's plane
 *  (`clipping`: by the vertex stage's clip distance, or by each fragment stage's pixel, the module
 *  the project switch makes, `../gpu/core/clipDistances.ts`), the plain module holding none of that
 *  code. */
export const blendShader = (
  key: Partial<ContractKey> = {},
  {
    stage,
    diagnostic,
    dual = false,
    subgroups = false,
    clipping,
  }: {
    stage?: WgslDecl
    diagnostic?: WgslDecl
    dual?: boolean
    subgroups?: boolean
    clipping?: Clipping
  } = {},
) => {
  const code = wgslModule(
    blendProgram(key, subgroups, clipping),
    ...(dual ? [DUAL_SOURCE_WGSL] : []),
    ...clipDirective(clipping),
    ...(stage ? [stage] : []),
    ...(diagnostic ? [diagnostic] : []),
  )
  return cutBlendByPixel(code, clipping)
}

/** The fragment stage of the runs, its surface and lobes those of `lobes`, and its entry points. */
const blendFragmentWgsl = (lobes: boolean) =>
  wgslBlock(
    `blendFragmentWgsl(${lobes})`,
    [
      blendRequestWgsl(lobes),
      DISPLAY_ROUTE_WGSL,
      displayMaskWgsl(DISPLAY_MASK_GROUP),
      ...(lobes ? [] : [BLEND_LOBELESS_WGSL]),
      blendLit,
      BLEND_TO_EYE_WGSL,
      surfaceModel.modelFlag,
      surfaceModel.catcherAlpha,
      wireframeEdge,
      DIAGNOSTIC_PALETTE_WGSL,
    ],
    `${BLEND_DIAGNOSTIC}
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
 l.kept=true;
 l.s=blendSurface(in,front,g,base);
 return l;
}
// The layer's declared lights, its surface model, thin back and lobes set first.
fn blendLights(in:VSOut,front:bool,g:BlendGrads,s:BlendSurface,V:vec3f)->vec3f{
 surfaceModel=modelFlag(in.ids.y);
 thinSubsurface=s.subsurface;
 blendLobes(in,front,g,s,V,s.rough);
 return declaredLighting(s.rgb,s.metal,s.rough,s.N,V,in.view,s.ao,in.position.xy,in.position.z);
}
fn blendFragment(in:VSOut,front:bool,masked:f32)->BlendOut{
 let flags=in.ids.y;
 // Every derivative wants uniform control flow: taken before the coverage test returns.
 let deltas=fwidth(in.bary);
 let g=blendGrads(in);
 let layer=blendLayer(in,front,g);
 if(!layer.kept){discard;return BlendOut(vec4f(0.0),0u,vec4f(0.0),vec4f(0.0),vec4f(0.0),0.0);}
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
  if(blendLit(flags)){
   let m=s.metal;
   let lights=blendLights(in,front,g,s,V);
   // A shadow catcher keeps its colour and is seen as far as the shadows fall on it.
   if(surfaceModel==${surfaceModel.MODEL_FLAG.shadow}u){alpha=catcherAlpha(alpha,lights);}
   else{
    // The bounce and the reflection, the probes gathered once for both (\`forwardIndirect\`).
    let indirect=forwardIndirect(rgb,m,f0Of(rgb,m),clamped,s.N,V,in.view,in.position,s.ao);
    rgb=litSurface(lights,indirect[0],environmentLighting(rgb,m,s.N,s.ao),indirect[1],s.emissive,s.N,in.view,s.ao);
   }
  }
  // Lit, the surface is seen through the fog; unlit, it keeps what it emits.
  if((flags&${surfaceModel.FOG_FREE_MODEL_BIT << surfaceModel.MODEL_SHIFT}u)==0u){rgb=fogged(rgb,in.view,uni.eye.xyz);}
 }else{rgb+=s.emissive;}
 let r=displayRoute(rgb,uni.exposure,uni.toneCurve,unlit,alpha,masked);
 return BlendOut(vec4f(rgb,alpha*r.keep),s.request,vec4f(0.0,1.0,0.0,alpha*r.keep),r.tint,r.add,blendGivenUp(in,alpha*r.keep));
}
// The reflection's resources are group 1 (\`REFLECTION_GROUP\`); a filtered image's pipelines read
// the display mask (group 2), every other one reads none.
@fragment fn fs(in:VSOut,@builtin(front_facing) front:bool)->BlendOut{return blendFragment(in,front,0.0);}
@fragment fn fsFiltered(in:VSOut,@builtin(front_facing) front:bool)->BlendOut{return blendFragment(in,front,maskAt(in.position));}
// The layer's outputs past its colour, for the dual blend's companion pass (\`drawCompanion\`), where
// the colour pass holds the HDR target alone: \`blendFragment\`'s request, share — its coverage, a
// shadow catcher's lit (\`catcherAlpha\`), a diagnostic view's its colour's — and history given up,
// no other light read.
struct BlendCovered{@location(1) request:u32,@location(2) asIs:vec4f,@location(3) givenUp:f32,}
@fragment fn fsBlendCoverage(in:VSOut,@builtin(front_facing) front:bool)->BlendCovered{
 let flags=in.ids.y;
 let deltas=fwidth(in.bary);
 let g=blendGrads(in);
 let layer=blendLayer(in,front,g);
 if(!layer.kept){discard;return BlendCovered(0u,vec4f(0.0),0.0);}
 let s=layer.s;
 if((flags&${itemFlags.FLAG_DIAGNOSTIC_VIEW}u)!=0u){return BlendCovered(s.request,blendDiagnosticOut(in,s,deltas).asIs,0.0);}
 var alpha=s.alpha;
 if((flags&${itemFlags.FLAG_UNLIT_VIEW}u)==0u&&blendLit(flags)&&modelFlag(flags)==${surfaceModel.MODEL_FLAG.shadow}u){
  alpha=catcherAlpha(alpha,blendLights(in,front,g,s,blendToEye(in)));
 }
 return BlendCovered(s.request,vec4f(0.0,1.0,0.0,alpha),blendGivenUp(in,alpha));
}
`,
  )

/** A diagnostic view's colour (`FLAG_DIAGNOSTIC_VIEW`), the view's code beside it
 *  (`blendDiagnosticCode`), in place of the lit surface: the wireframe's edges, every other view's
 *  colour the opaque resolve's (`diagnosticColor`), of the cluster word and triangle the vertex
 *  stage passed. Every fragment stage of the runs that colours a diagnostic view reads it. */
const BLEND_DIAGNOSTIC = `fn blendDiagnosticOut(in:VSOut,s:BlendSurface,deltas:vec3f)->BlendOut{
  let flags=in.ids.y;
  if(s.alpha<=0.01){discard;}
  let mode=blendDiagnosticCode(flags);
  // The wireframe and the x-ray view: the wire colour at the coverage of the barycentrics' edges,
  // nothing where it is 0; a transparent item carries no mobility here, so it wears the still
  // colour, premultiplied by its coverage as the pass blends it. The opaque edges are drawn over the
  // image after this pass (\`../visibility/xray.ts\`).
  if(mode==${DIAGNOSTIC_VIEWS.wireframe.code}u||mode==${DIAGNOSTIC_VIEWS.xray.code}u){
   let coverage=wireframeEdge(in.bary,deltas);
   if(coverage==0.0){discard;}
   return BlendOut(vec4f(diagnosticWireColor(false)*coverage,coverage),s.request,vec4f(0.0,1.0,0.0,coverage),vec4f(1.0),vec4f(0.0),0.0);
  }
  // The screen-error view's word is the cluster's world error (\`diagnosticWorldError\`), measured at
  // this pixel's clip w.
  let depth=(uni.viewProj*vec4f(in.view,1.0)).w;
  var screenError=0.0;
  if(mode==${DIAGNOSTIC_VIEWS['screen-error'].code}u){screenError=diagnosticScreenError(bitcast<f32>(in.diagId),depth,uni.viewProj,uni.viewport,uni.pixelRatio,uni.pixelError);}
  let shown=diagnosticColor(mode,DiagnosticPixel(in.diagId,in.tri&${(1 << TRI_CHANNELS_SHIFT) - 1}u,in.diagId,0u,s.rgb+s.emissive,s.geometric,screenError));
  return BlendOut(vec4f(shown,1.0),s.request,vec4f(0.0,1.0,0.0,1.0),vec4f(1.0),vec4f(0.0),0.0);
}`
