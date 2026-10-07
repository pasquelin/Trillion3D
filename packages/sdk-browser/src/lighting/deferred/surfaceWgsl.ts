import { SUBSURFACE_FLAG } from '../../scene/subsurface.ts'
import { AS_IS_FLAG, FOG_FREE_SURFACE_FLAG, SURFACE_MODEL_MASK } from '../../scene/surfaceModel.ts'
import { PIXEL_FOOTPRINT_WGSL } from './footprintWgsl.ts'
import { SURFACE_EMISSIVE_AO_WGSL } from '../../scene/surfaceEmission.ts'
import { receiverOffsetWgsl } from '../../visibility/shader/receiverOffsetWgsl.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../scene/physicalLobes.ts'
import { readLobesStatement } from '../direct/lobesWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** First binding of what the resolve's receiver offset reads (`RECEIVER_BINDINGS`). */
export const LIGHTING_RECEIVER_BINDING = 23

/** The lighting's entry, its camera fog and its mirror term: the texts the reflection source
 *  output finds in it (`reflections/sourceOutputWgsl.ts`). */
export const LIGHT_SURFACE_ENTRY =
  '@fragment fn lightSurface(@builtin(position) pixel:vec4f)->@location(0) vec4f{'
export const CAMERA_FOG = `if((surfaceFlag&${FOG_FREE_SURFACE_FLAG}u)==0u){rgb=fogged(rgb,P,view.display.yzw);}`
export const MIRROR_TERM = '+mirrorLighting(base.rgb,base.a,normal.a,N,V,P)'

/**
 * What a shadow read needs of its pixel: the pixel the frame's shadow mask is read at
 * (`vsmMaskPixel`), and, where the frame holds translucent casters, what their transmission's
 * point read takes (`vsmShadowFactor`, its one reader in the resolve): the pixel's footprint at its
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
  shadowSetView(view.camera.xyz,view.viewport.x,pixel.xy,u32(view.jitter.w),shadowFootprint,worldAt(view.viewport.xy*0.5,z));
  let receiver=shadowReceiver(pixel.xy);shadowReceiverOffset=receiver.offset;shadowReceiverPlane=receiver.plane;
 }
}`,
)

/** The surface of the contract programs: it reads its lobes where its flag says so, and the
 *  environment goes under their coat (`../direct/lobesWgsl.ts`) — in a lobeless program, or on a
 *  pixel without lobes, a call that reads nothing and a multiplication by one, which changes no
 *  bit. */
export const contractSurfaceBody = (bounce: string, diagnostic = '') =>
  wgslBlock(
    `contractSurfaceBody(${bounce}, ${diagnostic})`,
    [
      receiverOffsetWgsl(LIGHTING_RECEIVER_BINDING),
      PIXEL_FOOTPRINT_WGSL,
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
 let V=normalize(view.camera.xyz-P*view.camera.w);let N=normalize(normal.xyz);
 surfaceModel=flag;
 thinSubsurface=vec3f(0.0);
 if((surfaceFlag&${SUBSURFACE_FLAG}u)!=0u){thinSubsurface=textureLoad(subsurfaceColor,coord).rgb;}
 ${readLobesStatement(PHYSICAL_SURFACE_FLAG)}
 ${diagnostic}
 let lit=contractLighting(base.rgb,base.a,normal.a,N,V,P,emissive.a,pixel.xy,cell,shadowed);
 var ambient=environmentLighting(base.rgb,base.a,N,emissive.a)*lobeThrough();
 if(any(thinSubsurface>vec3f(0.0))){ambient+=environmentLighting(thinSubsurface,0.0,-N,emissive.a);}
 var rgb=lit+ambient+emissive.rgb${bounce};${CAMERA_FOG}
 return vec4f(rgb,1.0);
}`,
  )
