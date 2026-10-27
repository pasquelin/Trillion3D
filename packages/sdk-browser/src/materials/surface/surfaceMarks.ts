import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import {
  PLACEMENT_FIRST_PERSON,
  PLACEMENT_NO_CONTACT_SHADOW,
} from '../../geometry/dag/info/placementInfoLayout.ts'
import { channelsFlag } from './surfaceChannels.ts'
import { FIRST_PERSON_SURFACE_FLAG, NO_CONTACT_SHADOW_SURFACE_FLAG } from './surfaceModel.ts'

/**
 * THE SURFACE FLAGS OF A PAGE'S MARKS (`PageInfo.marks`, `PLACEMENT_PAGE_MARKS`): the opaque resolve ORs them into the
 * flags of every surface it writes (`withPageMarks`) — the first-person flag, the contact shadow's bit and the lighting
 * channels —, the one place a mark becomes a flag.
 */
export const surfaceFlagsOfMarks = wgslFn(
  'surfaceFlagsOfMarks',
  [channelsFlag],
  `fn surfaceFlagsOfMarks(marks:u32)->u32{
 return select(0u,${FIRST_PERSON_SURFACE_FLAG}u,(marks&${PLACEMENT_FIRST_PERSON}u)!=0u)|select(0u,${NO_CONTACT_SHADOW_SURFACE_FLAG}u,(marks&${PLACEMENT_NO_CONTACT_SHADOW}u)!=0u)|channelsFlag(marks);
}`,
)
