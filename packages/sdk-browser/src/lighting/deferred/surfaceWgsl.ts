import { DEFERRED_BINDINGS } from './bindings.ts'
import { SUBSURFACE_FLAG } from '../../materials/surface/subsurface.ts'
import {
  AS_IS_FLAG,
  FOG_FREE_SURFACE_FLAG,
  MODEL_FLAG,
  SURFACE_MODEL_MASK,
} from '../../materials/surface/surfaceModel.ts'
import { SURFACE_EMISSIVE_AO_WGSL } from '../../materials/surface/surfaceEmission.ts'
import { receiverTargetReadWgsl } from '../../visibility/shader/receiverTargetWgsl.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'
import { readLobesStatement } from '../direct/lobesWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { RESOLVED_INDIRECT_WGSL } from '../reflections/weight.ts'
import { FOG_WGSL } from '../fogShader.ts'
import { WORLD_AT_WGSL } from './worldAtWgsl.ts'

/** The lighting's entry and its camera fog. */
export const LIGHT_SURFACE_ENTRY =
  '@fragment fn lightSurface(@builtin(position) pixel:vec4f)->@location(0) vec4f{'
const CAMERA_FOG = `if((surfaceFlag&${FOG_FREE_SURFACE_FLAG}u)==0u){rgb=fogged(rgb,P,view.display.yzw);}`

/**
 * A pixel no surface drew, where no sky is drawn (an atmosphere draws it, `../atmosphere/skyWgsl.ts`):
 * a height fog lies over it as over any pixel (`fogBeyond`, `../fogShader.ts`), as a layer of the
 * fog's inscattering whose coverage is what the fog's transmittance leaves, which the composition lays
 * over the background colour (`composeAt`, `shaders.ts`); the pixel is empty, and shows that colour as
 * it is, anywhere else: without a height fog, in the raw output of a diagnostic view, and under an
 * orthographic camera, whose rays meet no horizon.
 */
const BACKGROUND_FOG_WGSL = wgslBlock(
  'BACKGROUND_FOG_WGSL',
  [WORLD_AT_WGSL, FOG_WGSL],
  `fn backgroundFog(pixel:vec2f)->vec4f{
 if(view.viewport.z!=0.0||view.camera.w==0.0||!fogsBackground()){return vec4f(0.0);}
 let eye=view.display.yzw;
 let beyond=fogBeyond(normalize(worldAt(pixel,0.5)-eye),eye);
 return vec4f(beyond.rgb,1.0-beyond.a);
}`,
)

/**
 * What a shadow read needs of its pixel: the pixel the frame's shadow mask and its transmission are
 * read at (`vsmMaskPixel`). The mask carries the opaque shadow and the panes' colour from the
 * receiver the projection read (`lighting/shadows/vsm/projection/projectionWgsl.ts`). Set only where the pixel's cell lists a
 * shadowed light, or has no list and walks every light (`cellShadowed`): nothing else reads it.
 */
const SHADOW_SETUP_WGSL = wgslBlock(
  'SHADOW_SETUP_WGSL',
  [],
  `fn shadowSetup(coord:vec2i){
 vsmMaskAt(coord);
}`,
)

/** The indirect light a program adds to the direct sum, its bounce and its reflection a column each,
 *  and its diagnostic view of the bounced light alone: the bounce program's gathers the probes once
 *  for both (`resolvedIndirect`); the direct program adds no bounce, and the reflection as the trace
 *  wrote it. */
const SURFACE_TERMS = {
  bounce: {
    indirect: 'resolvedIndirect(coord,albedo,base.a,normal.a,N,V,P,emissive.a)',
    diagnostic: 'if(bounceOnly()){return vec4f(bounceIrradiance(N,P,view.lightParams.w),1.0);}',
    blocks: [RESOLVED_INDIRECT_WGSL],
  },
  direct: { indirect: 'mat2x3f(vec3f(0.0),resolvedReflection(coord))', diagnostic: '', blocks: [] },
}

/**
 * A view of the lit image (`LIT_VIEWS`, `../../visibility/shader/shadeMode.ts`), the view's word
 * `views.x`: one lighting term of the surface in place of it, unfogged — 1 the reflection the
 * lighting adds (the trace, and the probes behind it in the bounce program); 2 the visibility of
 * the shadowed lights, the lights' own sum read as a shadow catcher reads it (`MODEL_FLAG.shadow`,
 * the light they let through over all of it, `CATCHER_SHADOWED`), white where no shadowed light
 * reaches; 3 the whole lighting on a white surface (`albedo`), no emission. Zero, the surface as
 * it is: a uniform word and three branches no pixel takes. Statements of the body, no declaration.
 */
const LIGHT_VIEW_STATEMENTS = {
  head: `let lightView=u32(view.views.x);let albedo=select(base.rgb,vec3f(1.0),lightView==3u);
 if(lightView==2u){
  surfaceModel=${MODEL_FLAG.shadow}u;
  let seen=contractLighting(albedo,base.a,normal.a,N,V,P,emissive.a,cell);
  return vec4f(vec3f(select(1.0,seen.x/seen.y,seen.y>0.0)),1.0);
 }`,
  terms: `if(lightView==1u){return vec4f(indirect[1],1.0);}
 if(lightView==3u){return vec4f(litSurface(lit,indirect[0],environmentLighting(albedo,base.a,N,emissive.a),indirect[1],vec3f(0.0),N,P,emissive.a),1.0);}`,
}

/** The surface of the contract programs, with `bounce` the bounce program's: it reads its lobes
 *  where its flag says so, and the environment and the reflection (`SURFACE_TERMS`, its
 *  program's) go under their coat (`../direct/lobesWgsl.ts`), a view of the lit image showing one
 *  term of them (`LIGHT_VIEW_STATEMENTS`) —
 *  in a lobeless program, or on a pixel without lobes, a call that reads nothing and a
 *  multiplication by one, which changes no bit. */
export const contractSurfaceBody = (bounce: boolean) => {
  const { indirect, diagnostic, blocks } = SURFACE_TERMS[bounce ? 'bounce' : 'direct']
  return wgslBlock(
    `contractSurfaceBody(${bounce})`,
    [
      receiverTargetReadWgsl(0, DEFERRED_BINDINGS.receiver),
      BACKGROUND_FOG_WGSL,
      SURFACE_EMISSIVE_AO_WGSL,
      SHADOW_SETUP_WGSL,
      ...blocks,
    ],
    `${LIGHT_SURFACE_ENTRY}
 let coord=vec2i(pixel.xy);let surfaceFlag=textureLoad(flags,coord,0).r;let flag=surfaceFlag&${SURFACE_MODEL_MASK}u;
 if(flag==0u){return backgroundFog(pixel.xy);}
 let base=textureLoad(baseMetal,coord,0);
 if(flag==${AS_IS_FLAG}u){return vec4f(base.rgb,1.0);}
 let z=textureLoad(depth,coord,0);
 let P=worldAt(pixel.xy,z);
 if(flag==1u){var rgb=base.rgb;${CAMERA_FOG}return vec4f(rgb,1.0);}
 // The emission-and-occlusion texel only where its bit says it holds something.
 let normal=textureLoad(normalRough,coord,0);let emissive=surfaceEmissiveAo(coord,surfaceFlag);
 // The pixel's cell of the light grid, read once: its shadow flag, then its list.
 let cell=pixelCell(pixel.xy,z);let shadowed=cellShadowed(cell);
 if(shadowed){shadowSetup(coord);}
 let V=viewToEye(P);let N=normalize(normal.xyz);
 surfaceModel=flag;
 thinSubsurface=vec3f(0.0);
 if((surfaceFlag&${SUBSURFACE_FLAG}u)!=0u){thinSubsurface=textureLoad(subsurfaceColor,coord).rgb;}
 ${readLobesStatement(PHYSICAL_SURFACE_FLAG)}
 ${diagnostic}
 ${LIGHT_VIEW_STATEMENTS.head}
 let lit=contractLighting(albedo,base.a,normal.a,N,V,P,emissive.a,cell);
 let indirect=${indirect};
 ${LIGHT_VIEW_STATEMENTS.terms}
 var rgb=litSurface(lit,indirect[0],environmentLighting(albedo,base.a,N,emissive.a),indirect[1],emissive.rgb,N,P,emissive.a);${CAMERA_FOG}
 return vec4f(rgb,1.0);
}`,
  )
}
