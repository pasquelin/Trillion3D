/**
 * THE PREFILTERED DISTANT SHADOW'S PROPAGATION OF REQUESTS: the first pass of the page allocations
 * (`encodeVsmPageMapping`), after the marking. It runs over the suns' maps alone, per page.
 */
import { VSM_COVER_GATHER_WGSL } from './pageGatherWgsl.ts'
import type { VsmBindingSpec } from './resources.ts'
import { type VsmPmKernel, vsmPmKernel } from './physicalPagesWgsl.ts'
import { VSM_PER_PAGE_DISPATCH_WGSL, VSM_PER_PAGE_GROUP_XY } from './markingWgsl.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { VSM_MIP_MASK_WGSL } from './pageManagementWgsl.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_TABLE_ORIGIN_WGSL } from './pageTableWgsl.ts'
import { VSM_PREFILTERED_WGSL } from './prefilteredWgsl.ts'
import {
  VSM_COARSER_LEVEL_CELL_WGSL,
  VSM_PROJECTION_DATA_READ_WGSL,
} from './projection/projectionDataWgsl.ts'
import type { VsmLayout } from './layout.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

const propagateText = /* wgsl */ `
/** The requests of a sun's clipmap level, passed on to every coarser level of its clipmap: each page the
 *  view asked (or a finer level passed on) asks the page that covers it in each coarser level for the
 *  filter — secondary and fine —, with the receiver cover's quarter of the page folded down a mip at a
 *  hop. A hop that changed nothing ends the walk: another page's thread carries it from there. */
fn pmPropagateFilterable(setup:VsmMapWalk,projectionData:VsmProjectionData){
 let loopEnd=vsmPagesAcross(0u);
 for(var pageY=setup.walkStart.y;pageY<loopEnd;pageY+=setup.walkStep){
  for(var pageX=setup.walkStart.x;pageX<loopEnd;pageX+=setup.walkStep){
   let entryCell=vsmTableEntryOf(setup.handle,0u,vec2u(pageX,pageY));
   if(vsmPageRequestsLoad(vsmTableIndex(entryCell.tableXY))==0u){continue;}
   var mask4x4=0u;
   if(projectionData.useCover){
    mask4x4=vsmFoldMask8x8(vsmGatherCover(entryCell.tableXY*2u,0u));
   }
   for(var hop=1u;hop<u32(projectionData.levelsLeft);hop++){
    let levelHandle=vsmHandleOffset(setup.handle,i32(hop));
    // The cell in halves of a page: the receiver cover is twice as fine.
    let levelCell=vsmCoarserLevelCell(vec2i(vec2u(pageX,pageY)),projectionData.cornerSteps,vsmProjectionOf(levelHandle).cornerSteps,hop,hop-1u);
    let oddCell=vec2u(levelCell)&vec2u(1u);
    let levelPage=levelCell>>vec2u(1u);
    if(!vsmPageInRange(levelPage,0u)){continue;}
    let levelEntry=vsmTableEntryOf(levelHandle,0u,vec2u(levelPage));
    let heldBefore=vsmPageRequestsOr(vsmTableIndex(levelEntry.tableXY),VSM_PAGE_SECONDARY|VSM_PAGE_FINE);
    var unchanged=(heldBefore&VSM_PAGE_SECONDARY)!=0u;
    if(projectionData.useCover){
     let coverCell=levelEntry.tableXY*2u+oddCell;
     if(vsmCoverInBounds(coverCell,0u)){
      let maskBefore=vsmReceiverCoverOr(vsmCoverIndex(coverCell,0u),mask4x4);
      unchanged=unchanged&&maskBefore==mask4x4;
     }
     mask4x4=vsmFoldMask4x4(mask4x4,oddCell);
    }
    if(unchanged){break;}
   }
  }
 }
}
@compute @workgroup_size(${VSM_PER_PAGE_GROUP_XY},${VSM_PER_PAGE_GROUP_XY})
fn vsmPropagateFilterable(@builtin(global_invocation_id) dispatchThreadId:vec3u,@builtin(num_workgroups) numWorkgroups:vec3u){
 let setup=vsmMapWalkOf(dispatchThreadId,numWorkgroups);
 if(!setup.valid){return;}
 let projectionData=vsmProjectionOf(setup.handle);
 if(projectionData.lightKind==LIGHT_KIND_DIRECTIONAL){pmPropagateFilterable(setup,projectionData);}
}`

/** The requests of a sun's levels passed on to the levels coarser, per page, over the dispatcher's
 *  directional bins. */
export function propagateFilterable(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'projectionData', binding: 1 },
    { resource: 'pageRequests', binding: 2, access: 'atomic' },
    { resource: 'receiverCover', binding: 3, access: 'atomic' },
  ]
  const body = wgslBlock(
    'propagateFilterable',
    [
      VSM_MIP_MASK_WGSL,
      VSM_PREFILTERED_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_TABLE_ORIGIN_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      VSM_COARSER_LEVEL_CELL_WGSL,
      VSM_COVER_GATHER_WGSL,
      VSM_PER_PAGE_DISPATCH_WGSL,
    ],
    propagateText,
  )
  return vsmPmKernel(layout, 'PropagateFilterable', specs, body, { perPage: true })
}
