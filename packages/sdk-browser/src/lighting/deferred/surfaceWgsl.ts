import { DEFERRED_BINDINGS } from './bindings.ts'
import { SUBSURFACE_FLAG } from '../../scene/subsurface.ts'
import { AS_IS_FLAG, FOG_FREE_SURFACE_FLAG, SURFACE_MODEL_MASK } from '../../scene/surfaceModel.ts'
import { PIXEL_FOOTPRINT_WGSL, SHADOW_VIEW_AT_WGSL } from './footprintWgsl.ts'
import { SURFACE_EMISSIVE_AO_WGSL } from '../../scene/surfaceEmission.ts'
import { receiverOffsetWgsl } from '../../visibility/shader/receiverOffsetWgsl.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../scene/physicalLobes.ts'
import { readLobesStatement } from '../direct/lobesWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** First binding of what the resolve's receiver offset reads (`RECEIVER_BINDINGS`). */
export const LIGHTING_RECEIVER_BINDING = DEFERRED_BINDINGS.receiver

/** The lighting's entry and its camera fog. */
export const LIGHT_SURFACE_ENTRY =
  '@fragment fn lightSurface(@builtin(position) pixel:vec4f)->@location(0) vec4f{'
const CAMERA_FOG = `if((surfaceFlag&${FOG_FREE_SURFACE_FLAG}u)==0u){rgb=fogged(rgb,P,view.display.yzw);}`

/**
 * What a shadow read needs of its pixel: the pixel the frame's shadow mask is read at
 * (`vsmMaskPixel`), and, where the frame holds translucent casters, what their transmission's
 * located sample takes (`vsmLocate`, its one reader in the resolve): the pixel's footprint at its
 * unjittered centre, whence its view, and its receiver, moved by its shading-point offset,
 * and its triangle's plane the bias follows (`shadowReceiver`, from the visibility buffer).
 * The mask carries the opaque shadow from the receiver the projection read
 * (`vsm/projectionWgsl.ts`): without translucent casters nothing reads the rest, so a pixel loads
 * none of its eight neighbour depths nor its receiver offset.
 * Set only where the pixel's cell lists a shadowed light (`cellShadowed`): nothing else reads
 * it.
 */
const SHADOW_SETUP_WGSL = wgslBlock(
  'SHADOW_SETUP_WGSL',
  [],
  `fn shadowSetup(coord:vec2i,pixel:vec4f,z:f32,P:vec3f){
 vsmMaskAt(coord);
 if(vsmTranslucentCasters()){
  shadowFootprint=pixelFootprint(coord,pixel.xy,z,P);
  shadowViewAt(shadowFootprint,z);
  let receiver=shadowReceiver(pixel.xy);shadowReceiverOffset=receiver.offset;shadowReceiverPlane=receiver.plane;
 }
}`,
)

/** What the bounce program adds to the direct sum, and its diagnostic view of the bounced light
 *  alone; the direct program adds nothing. */
const SURFACE_TERMS = {
  bounce: {
    bounce: 'bounceLighting(base.rgb,base.a,N,P,emissive.a)',
    thin: 'thinBounce(N,P,emissive.a)+',
    diagnostic: 'if(bounceOnly()){return vec4f(bounceIrradiance(N,P,view.lightParams.w),1.0);}',
  },
  direct: { bounce: 'vec3f(0.0)', thin: '', diagnostic: '' },
}

/** The surface of the contract programs, with `bounce` the bounce program's: it reads its lobes
 *  where its flag says so, and the environment and the reflection (`resolvedReflection`, its
 *  program's) go under their coat (`../direct/lobesWgsl.ts`) —
 *  in a lobeless program, or on a pixel without lobes, a call that reads nothing and a
 *  multiplication by one, which changes no bit. */
export const contractSurfaceBody = (bounce: boolean) => {
  const { bounce: bounced, thin, diagnostic } = SURFACE_TERMS[bounce ? 'bounce' : 'direct']
  return wgslBlock(
    `contractSurfaceBody(${bounce})`,
    [
      receiverOffsetWgsl(LIGHTING_RECEIVER_BINDING),
      PIXEL_FOOTPRINT_WGSL,
      SHADOW_VIEW_AT_WGSL,
      SURFACE_EMISSIVE_AO_WGSL,
      SHADOW_SETUP_WGSL,
    ],
    `${LIGHT_SURFACE_ENTRY}
 let coord=vec2i(pixel.xy);let surfaceFlag=textureLoad(flags,coord,0).r;let flag=surfaceFlag&${SURFACE_MODEL_MASK}u;
 if(flag==0u){return vec4f(0.0);}
 let base=textureLoad(baseMetal,coord,0);
 if(flag==${AS_IS_FLAG}u){return vec4f(base.rgb,1.0);}
 let z=textureLoad(depth,coord,0);
 let P=worldAt(pixel.xy,z);
 if(flag==1u){var rgb=base.rgb;${CAMERA_FOG}return vec4f(rgb,1.0);}
 // The emission-and-occlusion texel only where its bit says it holds something.
 let normal=textureLoad(normalRough,coord,0);let emissive=surfaceEmissiveAo(coord,surfaceFlag);
 // The pixel's cell of the light grid, read once: its shadow flag, then its list.
 let cell=pixelCell(pixel.xy,z);let shadowed=cellShadowed(cell);
 if(shadowed){shadowSetup(coord,pixel,z,P);}
 let V=viewToEye(P);let N=normalize(normal.xyz);
 surfaceModel=flag;
 thinSubsurface=vec3f(0.0);
 if((surfaceFlag&${SUBSURFACE_FLAG}u)!=0u){thinSubsurface=textureLoad(subsurfaceColor,coord).rgb;}
 ${readLobesStatement(PHYSICAL_SURFACE_FLAG)}
 ${diagnostic}
 let lit=contractLighting(base.rgb,base.a,normal.a,N,V,P,emissive.a,pixel.xy,cell,shadowed);
 var rgb=litSurface(lit,${bounced},environmentLighting(base.rgb,base.a,N,emissive.a),resolvedReflection(coord),emissive.rgb);
 if(any(thinSubsurface>vec3f(0.0))){rgb+=${thin}environmentLighting(thinSubsurface,0.0,-N,emissive.a);}${CAMERA_FOG}
 return vec4f(rgb,1.0);
}`,
  )
}
