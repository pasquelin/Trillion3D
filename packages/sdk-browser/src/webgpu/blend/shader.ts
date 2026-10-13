import { declaredLightingWgsl } from '../../lighting/direct/lightingWgsl.ts'
import * as surfaceModel from '../../scene/surfaceModel.ts'
import { bounceApplyWgsl } from '../../bounce/applyWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../../lighting/standardLighting.ts'
import { tileDeclarations } from '../tile/wgsl.ts'
import { BLEND_BINDINGS, BLEND_TRACE_BINDINGS, BLEND_VSM_BINDINGS } from '../core/bindLayout.ts'
import { blendRequestWgsl } from './requestWgsl.ts'
import * as itemFlags from '../../visibility/types.ts'
import { blendSurfaceWgsl } from './shaderSurface.ts'
import { DIAGNOSTIC_PALETTE_WGSL } from '../../diagnostic/colors.ts'
import { TRIANGLE_PALETTE_WGSL } from '../../diagnostic/trianglePalette.ts'
import { DISPLAY_ROUTE_WGSL, displayMaskWgsl } from './displayFilter.ts'
import { blendVertexWgsl } from './vertexWgsl.ts'
import { BLEND_LOBELESS_WGSL, BLEND_PHYSICAL_WGSL } from './physicalWgsl.ts'
import { type ContractKey, variantLabel } from '../../lighting/deferred/contractCuts.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { type WgslDecl, wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wireframeEdge } from '../../../../math/src/wgsl/barycentric.ts'
import { REFLECTION_FRONT_WGSL } from '../../reflections/frontDepth.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from '../../reflections/viewLayout.ts'
import { f0Of } from '../../../../math/src/wgsl/lighting.ts'
import { forwardReflectionWgsl } from '../../reflections/weight.ts'

/** The blend module; its light loop without the shadow or the rectangle code `key` leaves out
 *  (`declaredLightingWgsl`), the program of a scene that holds none (`pipelines.ts`). Without
 *  `lobeless`, a scene whose blend carries an anisotropic or clear-coat lobe: its fragment sets
 *  them (`physicalWgsl.ts`), its lights, environment, bounce and reflection go through them, a
 *  fragment
 *  without them summing the very same terms (`../../lighting/direct/lobesWgsl.ts`). */
const blendProgram = (key: Partial<ContractKey>) => {
  const lobes = !key.lobeless
  const bindings = {
    proxy: BLEND_BINDINGS.proxy,
    transmittance: BLEND_BINDINGS.shadowTransmittance,
    vsm: BLEND_VSM_BINDINGS,
    trace: BLEND_TRACE_BINDINGS,
  }
  return wgslBlock(
    `blendProgram(${variantLabel(key)})`,
    [
      blendVertexWgsl(lobes),
      STANDARD_LIGHTING_WGSL,
      declaredLightingWgsl(bindings, key),
      bounceApplyWgsl(BLEND_BINDINGS.bounceGrid, BLEND_BINDINGS.probes),
      blendSurfaceWgsl(lobes),
      forwardReflectionWgsl(REFLECTION_GROUP, lobes),
      reflectionLightViewWgsl(REFLECTION_GROUP),
      REFLECTION_FRONT_WGSL,
      f0Of,
      ...(lobes ? [BLEND_PHYSICAL_WGSL] : []),
      blendFragmentWgsl(lobes),
    ],
    `${tileDeclarations(BLEND_BINDINGS.color, 'color')}
@group(0) @binding(${BLEND_BINDINGS.sampler}) var mapsSampler:sampler;
${tileDeclarations(BLEND_BINDINGS.data, 'data')}
@group(0) @binding(${BLEND_BINDINGS.directLights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${BLEND_BINDINGS.tileLights}) var<storage,read> tileLights:array<u32>;
// The blended colour, the tile rank this pixel asks of the virtual textures, in its own target
// (no memory write: early reject kept), the as-is share and the display layers (\`displayFilter.ts\`).
struct BlendOut{@location(0) color:vec4f,@location(1) request:u32,@location(2) asIs:vec4f,@location(3) tint:vec4f,@location(4) add:vec4f,@location(5) front:vec4f,}`,
  )
}

/** The blend module's text (`blendProgram`), with what a pass adds to it: the water's surface
 *  stage (`stage`, `../water/surfaceWgsl.ts`), a diagnostic variant's entries (`diagnostic`). */
export const blendShader = (
  key: Partial<ContractKey> = {},
  { stage, diagnostic }: { stage?: WgslDecl; diagnostic?: WgslDecl } = {},
) => wgslModule(blendProgram(key), ...(stage ? [stage] : []), ...(diagnostic ? [diagnostic] : []))

/** The fragment stage of the runs, its surface and lobes those of `lobes`, and its entry points. */
const blendFragmentWgsl = (lobes: boolean) =>
  wgslBlock(
    `blendFragmentWgsl(${lobes})`,
    [
      blendRequestWgsl(lobes),
      DISPLAY_ROUTE_WGSL,
      displayMaskWgsl(2),
      ...(lobes ? [] : [BLEND_LOBELESS_WGSL]),
      wireframeEdge,
      DIAGNOSTIC_PALETTE_WGSL,
      TRIANGLE_PALETTE_WGSL,
    ],
    `fn blendFragment(in:VSOut,front:bool,masked:f32)->BlendOut{
 let flags=in.ids.y;
 // Every derivative wants uniform control flow: taken before the coverage test returns.
 let width=fwidth(in.bary);
 let g=blendGrads(in);
 let base=blendBase(in,g);
 // A fragment the material rejects (\`blendKeeps\`), or a dashed line's gap (\`lineDash\`: its
 // distance along the line rides the first coordinate), reads and lights nothing more.
 if(!blendKeeps(in,base,front)||!lineDash(in.uv.x,in.alphaAo.zw)){discard;return BlendOut(vec4f(0.0),0u,vec4f(0.0),vec4f(0.0),vec4f(0.0),vec4f(0.0));}
 blendPhysicalBegin(in,g);
 let s=blendSurface(in,front,g,base);
${BLEND_DIAGNOSTIC}
 var rgb=s.rgb;
 // No declared lamp, or an unlit view requested: the raw albedo and its emission, exactly like
 // the opaque resolve. Neither ambient, nor sky, nor a default sun (P6).
 let unlit=(flags&${itemFlags.FLAG_UNLIT_VIEW}u)!=0u;
 let V=normalize(uni.camPos.xyz-in.view*uni.camPos.w);
 let clamped=s.rough;
 if(!unlit){
  if((flags&${itemFlags.FLAG_LIT}u)!=0u){
   let m=s.metal;
   let model=(flags>>${surfaceModel.MODEL_SHIFT}u)&7u;
   surfaceModel=select(select(${surfaceModel.MODEL_FLAG.physical}u,${surfaceModel.MODEL_FLAG.diffuse}u,model==${surfaceModel.SURFACE_MODEL.diffuse}u),${surfaceModel.MODEL_FLAG.toon}u,model==${surfaceModel.SURFACE_MODEL.toon}u);
   thinSubsurface=s.subsurface;
   shadowFootprint=blendShadowFootprint(in.view);
   shadowSetView(uni.camPos.xyz,uni.viewport.x,shadowFootprint,in.view);
   blendLobes(in,front,g,s,V,clamped);
   rgb=litSurface(declaredLighting(rgb,m,clamped,s.N,V,in.view,s.ao,in.position.xy,in.position.z),bounceLighting(rgb,m,s.N,in.view,s.ao),environmentLighting(rgb,m,s.N,s.ao),surfaceReflection(f0Of(rgb,m),clamped,s.N,V,in.view),s.emissive);
   if(any(thinSubsurface>vec3f(0.0))){rgb+=bounceLighting(thinSubsurface,0.0,-s.N,in.view,s.ao)+environmentLighting(thinSubsurface,0.0,-s.N,s.ao);}
  }
  // Lit, the surface is seen through the fog; unlit, it keeps what it emits.
  if((flags&${surfaceModel.FOG_FREE_MODEL_BIT << surfaceModel.MODEL_SHIFT}u)==0u){rgb=fogged(rgb,in.view,uni.eye.xyz);}
 }else{rgb+=s.emissive;}
 let r=displayRoute(rgb,uni.exposure,uni.toneCurve,unlit,s.alpha,masked);
 // The nearest surface of the pixel a ray can meet, a target's \`max\` blend (\`frontDepth.ts\`).
 return BlendOut(vec4f(rgb,s.alpha*r.keep),s.request,vec4f(0.0,1.0,0.0,s.alpha*r.keep),r.tint,r.add,reflectionFrontOut(in.position,s.alpha*r.keep));
}
// The reflection's resources are group 1 (\`REFLECTION_GROUP\`); a filtered image's pipelines read
// the display mask (group 2), every other one reads none.
@fragment fn fs(in:VSOut,@builtin(front_facing) front:bool)->BlendOut{return blendFragment(in,front,0.0);}
@fragment fn fsFiltered(in:VSOut,@builtin(front_facing) front:bool)->BlendOut{return blendFragment(in,front,maskAt(in.position));}
`,
  )

/** A diagnostic view's colour (`FLAG_DIAGNOSTIC_VIEW`): the wireframe, the clusters, the levels or
 *  the screen error, in place of the lit surface. */
const BLEND_DIAGNOSTIC = ` if((flags&${itemFlags.FLAG_DIAGNOSTIC_VIEW}u)!=0u){
  if(s.alpha<=0.01){discard;}
  var color=diagnosticFlat();
  if((flags&${itemFlags.FLAG_DIAGNOSTIC_WIREFRAME}u)!=0u){
   let edge=wireframeEdge(in.bary,width);
   color=diagnosticWire(hashColor(in.tri),edge);
  }else if((flags&${itemFlags.FLAG_DIAGNOSTIC_CLUSTERS}u)!=0u){color=select(vec3f(0.5,0.55,0.6),hashColor(in.diagId&0x00ffffffu),in.diagId!=0u);}
  else if((flags&${itemFlags.FLAG_DIAGNOSTIC_LOD}u)!=0u){color=diagnosticLevel((in.diagId&0x80000000u)!=0u);}
  else if((flags&${itemFlags.FLAG_DIAGNOSTIC_SCREEN_ERROR}u)!=0u){let ratio=f32((in.diagId>>24u)&127u)/127.0;color=diagnosticError(ratio);}
  return BlendOut(vec4f(color,1.0),s.request,vec4f(0.0,1.0,0.0,1.0),vec4f(1.0),vec4f(0.0),vec4f(0.0));
 }`
