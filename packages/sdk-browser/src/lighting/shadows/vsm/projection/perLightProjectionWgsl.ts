/**
 * THE PER-LIGHT PROJECTION (`perLightPass.ts`), the kernel of the path `shadowOnePassProjection` false
 * takes: one shadowed local light's shadow at each pixel it reaches, the receiver's trace
 * (`../trace/receiverTraceWgsl.ts`) of that light alone, written as the light's mask itself: the square root
 * of the share (a light attenuation buffer's encoding, which gives the darks more of an eight-bit channel) in
 * every channel of the light's layer of the mask. The light is the record of the dispatch
 * (`perLightRecord.ts`: its record in the view uniform, the rectangle of pixels it reaches, over which the groups
 * are laid, and its layer), a pixel of the rectangle that the light does not shade writing 1: the kernel
 * writes the whole rectangle, so no clear precedes it. The pass is the suns' and the one-pass local lights' as
 * to flow: 8×8 groups, pixels in Z-order, the adaptive ray count voted by the 32-pixel halves, every lane
 * tracing in uniform flow. The share is the trace's as it comes: none of the dither the one-pass projection's
 * packed shares take (`vsmFilterShadow`).
 */
import { VSM_PROJECTION_GROUP_SIZE } from '../constants.ts'
import { SUBGROUP_ALL_WGSL } from '../../../../gpu/core/subgroups.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import type { VsmLayout } from '../layout.ts'
import { vsmPixelOfWgsl } from './projectionEntryWgsl.ts'
import { PER_LIGHT_MASK_FORMAT } from './maskFormat.ts'
import { PER_LIGHT_RECORD_WGSL } from './perLightRecord.ts'
import {
  VSM_PROJECTION_OPAQUE_WGSL,
  VSM_PROJECTION_PIXEL_WGSL,
  vsmProjectionVoteWgsl,
} from './projectionPixelWgsl.ts'
import {
  VSM_PROJECTION_REGION_WGSL,
  VSM_PROJECTION_SUBSURFACE_WGSL,
} from './projectionRegionWgsl.ts'
import {
  BINDINGS_WGSL,
  HAIR_SHADOW_BINDING_WGSL,
  PROJECTION_VIEW,
  projectionCommon,
  traceDeps,
  VSM_PROJECTION_BINDING,
} from './projectionWgsl.ts'
import { VSM_TRACE_KINDS_LOCAL } from '../trace/traceWgsl.ts'

/** The entry point of the kernel. */
export const VSM_PER_LIGHT_ENTRY = 'vsmProjectPerLight'

/** The pixel of a group, inside the rectangle of the light's record. */
const PER_LIGHT_PIXEL_OF_WGSL = vsmPixelOfWgsl('VSM_PER_LIGHT_PIXEL_OF_WGSL', 'vsmPerLight.rect')

const entry = (hair: boolean) => /* wgsl */ `
@compute @workgroup_size(${VSM_PROJECTION_GROUP_SIZE * VSM_PROJECTION_GROUP_SIZE})
fn ${VSM_PER_LIGHT_ENTRY}(@builtin(workgroup_id) groupId:vec3u,@builtin(local_invocation_index) groupIndex:u32){
 vsmLaneInit(groupIndex);
 let pixel=vsmPixelOf(groupId.xy,groupIndex);
 let k=vsmPerLight.record;
 let receiver=vsmReceiverOf(pixel,pixel.info.valid);
 let inLight=vsmLightParticipates(k,pixel.info,pixel.shifted);
 let r=vsmSubsurfaceShadow(vsmTraceLight(vsmView.lights[k],pixel,receiver,inLight),pixel.info);
${
  hair
    ? ` var share=select(1.0,r.shadowFactor,r.rayCount>0u);
 if(i32(k)<i32(textureNumLayers(vsmHairShadow))){share=min(share,textureLoad(vsmHairShadow,pixel.pos,i32(k),0).x);}
 if(pixel.inRect){textureStore(vsmLightMask,pixel.pos,vsmPerLight.layer,vec4f(sqrt(share)));}`
    : ' if(pixel.inRect){textureStore(vsmLightMask,pixel.pos,vsmPerLight.layer,vec4f(sqrt(select(1.0,r.shadowFactor,r.rayCount>0u))));}'
}
}
`

/** The per-light kernel for the pool `layout`; its halves vote over their subgroups with `subgroups`
 *  (`vsmProjectionVoteWgsl`), as the other passes' do. */
export function vsmPerLightProjectionWgsl(layout: VsmLayout, subgroups = false, hair = false) {
  return wgslProgram(
    [
      PROJECTION_VIEW,
      BINDINGS_WGSL,
      `@group(1) @binding(${VSM_PROJECTION_BINDING.mask}) var vsmLightMask:texture_storage_2d_array<${PER_LIGHT_MASK_FORMAT},write>;
@group(1) @binding(${VSM_PROJECTION_BINDING.perLight}) var<uniform> vsmPerLight:PerLightRecord;${hair ? HAIR_SHADOW_BINDING_WGSL : ''}`,
      vsmProjectionVoteWgsl(subgroups),
      VSM_PROJECTION_PIXEL_WGSL,
      VSM_PROJECTION_OPAQUE_WGSL,
      VSM_PROJECTION_REGION_WGSL,
      VSM_PROJECTION_SUBSURFACE_WGSL,
      entry(hair),
    ].join('\n'),
    [
      ...projectionCommon(layout, PER_LIGHT_PIXEL_OF_WGSL),
      ...traceDeps(layout, VSM_TRACE_KINDS_LOCAL),
      ...(subgroups ? [SUBGROUP_ALL_WGSL] : []),
      PER_LIGHT_RECORD_WGSL,
    ],
  )
}
