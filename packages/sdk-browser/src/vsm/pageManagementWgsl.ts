/**
 * Page table hierarchy kernels: the hierarchical page marks generation with the page rect bounds,
 * and the mapped mips propagation.
 *
 * Each page-mark / receiver-cover mip is not its own texture: the mips are concatenated in one
 * storage buffer (`vsmPageMarkIndex(t, m)`, `vsmCoverIndex(t, m)`), so one atomic binding
 * covers mip 0 (read) and the hierarchy (atomicOr).
 */
import type { VsmBindingSpec } from './resources.ts'
import { type VsmPmKernel, vsmPmModule } from './physicalPagesWgsl.ts'
import { VSM_PER_PAGE_GROUP_XY } from './markingWgsl.ts'
import type { VsmLayout } from './layout.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/** Mask mips: 8x4 bits → 4x4, 8x8 (gathered 2x2) → 4x4, 4x4 → placed 2x2. */
const VSM_MIP_MASK_WGSL = wgslBlock(
  'VSM_MIP_MASK_WGSL',
  [],
  `
fn vsmFoldMask8x4(mask2x1:vec2u)->u32{
 // Two 4x4 16-bit masks at once.
 var packed=mask2x1.x|(mask2x1.y<<16u);
 packed|=packed>>4u;
 packed|=packed>>1u;
 packed&=0x5050505u;
 packed|=packed>>1u;
 packed&=0x3030303u;
 packed|=packed>>4u;
 packed|=packed>>14u;
 packed&=0xFFu;
 return packed;
}
/** Gather layout x (-,+), y (+,+), z (+,-), w (-,-). */
fn vsmFoldMask8x8(mask2x2:vec4u)->u32{
 return (vsmFoldMask8x4(vec2u(mask2x2.x,mask2x2.y))<<8u)|vsmFoldMask8x4(vec2u(mask2x2.w,mask2x2.z));
}
fn vsmFoldMask4x4(mask4x4:u32,oddCell:vec2u)->u32{
 let mask2x2=vsmFoldMask8x4(vec2u(mask4x4,0u))&0x33u;
 let shift=oddCell.y*8u+oddCell.x*2u;
 return mask2x2<<shift;
}
`,
)

/** Builds the hierarchical page marks, one thread per physical page. */
function pageFlagPyramid(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'poolPageInfo', binding: 1 },
    { resource: 'projectionData', binding: 2 },
    { resource: 'pageMarks', binding: 3, access: 'atomic' },
    { resource: 'receiverCover', binding: 4, access: 'atomic' },
    { resource: 'staleRects', binding: 5, access: 'atomic' },
    { resource: 'mappedRects', binding: 6, access: 'atomic' },
  ]
  const body = wgslBlock(
    'pageFlagPyramid',
    [VSM_MIP_MASK_WGSL],
    `
/** True when this hierarchical texel already held Flag (someone else continues). */
fn pmOrMarkAtLevel(flag:u32,entryCell:VsmTableCell,pyramidLevel:u32)->bool{
 let pyramidTexel=entryCell.tableXY>>vec2u(pyramidLevel);
 let heldBefore=vsmPageMarksOr(vsmPageMarkIndex(pyramidTexel,pyramidLevel),flag);
 return heldBefore==flag;
}
@compute @workgroup_size(VSM_GROUP_WIDTH)
fn vsmPageFlagPyramid(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=vsm.poolPages){return;}
 let pageInfo=vsmPoolPageInfo[id.x];
 if(pageInfo.flags==0u){return;}
 let handle=vsmHandleFromId(pageInfo.mapId);
 let tableAt=vsmTableEntryOf(handle,pageInfo.mipLevel,pageInfo.pageAddress);
 let flag=vsmPageMarksLoad(vsmPageMarkIndex(tableAt.tableXY,0u))&VSM_PAGE_MARK_MASK;
 if(flag==0u){return;}
 let projectionData=vsmProjectionOf(handle);
 var mipLevel=pageInfo.mipLevel;
 let pageAddress=pageInfo.pageAddress;
 // A single-page map is only valid at the last mip: its rect bounds go there.
 if(handle.isSinglePage){mipLevel=VSM_MIPS-1u;}
 // Min/max rect of active pages.
 let b=(handle.id*VSM_MIPS+mipLevel)*4u;
 atomicMin(&vsmMappedRects[b+0u],pageAddress.x);
 atomicMin(&vsmMappedRects[b+1u],pageAddress.y);
 atomicMax(&vsmMappedRects[b+2u],pageAddress.x);
 atomicMax(&vsmMappedRects[b+3u],pageAddress.y);
 // Rendering rect: only pages with something uncached.
 if((flag&VSM_PAGE_ANY_STALE)!=0u){
  atomicMin(&vsmStaleRects[b+0u],pageAddress.x);
  atomicMin(&vsmStaleRects[b+1u],pageAddress.y);
  atomicMax(&vsmStaleRects[b+2u],pageAddress.x);
  atomicMax(&vsmStaleRects[b+3u],pageAddress.y);
 }
 if(handle.isSinglePage){return;}
 // H levels over each page-table mip; level 0 of this hierarchy is the page-table mip itself.
 // Up to the first level that already held the flag: another page carries it on from there.
 let levelsAbove=min(VSM_MIPS-mipLevel,6u);
 for(var level=0u;level<levelsAbove;level++){
  if(pmOrMarkAtLevel(flag,tableAt,level+1u)){break;}
 }
 // A page past the receiver cover (the directional-only mask holds the clipmaps allocated first;
 // an unreferenced one allocated after the local maps can lie beyond it) has none: the
 // write is dropped there: a linear index would land in another map's row.
 if(projectionData.useCover&&vsmCoverInBounds(tableAt.tableXY*2u,0u)){
  // 2x2 masks per page.
  var coverCell=tableAt.tableXY*2u;
  let mask8x8=vsmGatherCover(coverCell,0u);
  var mask4x4=vsmFoldMask8x8(mask8x8);
  coverCell=coverCell>>vec2u(1u);
  _=vsmReceiverCoverOr(vsmCoverIndex(coverCell,1u),mask4x4);
  // Self-similar from here: 4x4 → 2x2 into the next mip (mips 2..7).
  for(var mip=2u;mip<VSM_MIPS;mip++){
   mask4x4=vsmFoldMask4x4(mask4x4,coverCell&vec2u(1u));
   coverCell=coverCell>>vec2u(1u);
   _=vsmReceiverCoverOr(vsmCoverIndex(coverCell,mip),mask4x4);
  }
 }
}
`,
  )
  return {
    label: 'PageFlagPyramid',
    entryPoint: 'vsmPageFlagPyramid',
    specs,
    perPage: false,
    code: vsmPmModule(layout, specs, body, { coverGather: true }),
  }
}

/** The mapped mip propagator, per-page dispatch. */
function fillCoarserFallbacks(layout: VsmLayout): VsmPmKernel {
  const specs: VsmBindingSpec[] = [
    { resource: 'uniforms', binding: 0 },
    { resource: 'pageTable', binding: 1, access: 'read_write' },
    { resource: 'projectionData', binding: 2 },
  ]
  const g = VSM_PER_PAGE_GROUP_XY
  const body = wgslBlock(
    'fillCoarserFallbacks',
    [],
    `
fn pmFallbacksDirectional(setup:VsmMapWalk,projectionData:VsmProjectionData){
 let loopEnd=vsmPagesAcross(0u);
 for(var pageY=setup.walkStart.y;pageY<loopEnd;pageY+=setup.walkStep){
  for(var pageX=setup.walkStart.x;pageX<loopEnd;pageX+=setup.walkStep){
   let firstLevelPage=vec2u(pageX,pageY);
   // Clipmap levels are separate maps: gather the first mapped coarser level, write only our own entry.
   let firstEntryIndex=vsmTableIndex(vsmTableEntryOf(setup.handle,0u,firstLevelPage).tableXY);
   let firstEntry=vsmUnpackTableEntry(vsmPageTableLoad(firstEntryIndex));
   if(!firstEntry.thisLevelMapped){
    let quarterPages=i32(VSM_LEVEL0_PAGES>>2u);
    let firstShift=quarterPages*projectionData.cornerSteps;
    let levelZeroPage=vec2i(firstLevelPage)-firstShift;
    let levelsAfter=u32(projectionData.levelsLeft);
    for(var levelHop=1u;levelHop<levelsAfter;levelHop++){
     let levelHandle=vsmHandleOffset(setup.handle,i32(levelHop));
     let levelInfo=vsmProjectionOf(levelHandle);
     let levelOffset=quarterPages*levelInfo.cornerSteps;
     let levelPage=(levelZeroPage+(levelOffset<<vec2u(levelHop)))>>vec2u(levelHop);
     if(vsmPageInRange(levelPage,0u)){
      let levelEntry=vsmUnpackTableEntry(vsmPageTableLoad(vsmTableIndex(vsmTableEntryOf(levelHandle,0u,vec2u(levelPage)).tableXY)));
      if(levelEntry.thisLevelMapped){
       vsmPageTableStore(firstEntryIndex,vsmPackFallbackEntry(levelEntry.physicalAddress,levelHop));
       break;
      }
     }
    }
   }
  }
 }
}
fn pmFallbacksLocal(setup:VsmMapWalk){
 let minLevel=i32(setup.firstMip);
 let loopEnd=vsmPagesAcross(setup.firstMip);
 for(var pageY=setup.walkStart.y;pageY<loopEnd;pageY+=setup.walkStep){
  for(var pageX=setup.walkStart.x;pageX<loopEnd;pageX+=setup.walkStep){
   let finestPage=vec2u(pageX,pageY);
   // Local lights propagate mapped pages to their finer unmapped mips.
   var mappedLevel=-1i;
   var mappedPool=vec2u(0u);
   for(var level=i32(VSM_MIPS)-1i;level>=minLevel;level--){
    let levelDelta=u32(level-minLevel);
    let vPage=finestPage>>vec2u(levelDelta);
    let entryIndex=vsmTableIndex(vsmTableEntryOf(setup.handle,u32(level),vPage).tableXY);
    let page=vsmUnpackTableEntry(vsmPageTableLoad(entryIndex));
    if(page.thisLevelMapped){
     mappedLevel=level;
     mappedPool=page.physicalAddress;
    }else if(mappedLevel>=0i){
     // One writer per entry; readers ignore it (never thisLevelMapped).
     if(all((vPage<<vec2u(levelDelta))==finestPage)){
      let mipOffset=u32(mappedLevel-level);
      vsmPageTableStore(entryIndex,vsmPackFallbackEntry(mappedPool,mipOffset));
     }
    }
   }
  }
 }
}
@compute @workgroup_size(${g},${g})
fn vsmFillCoarserFallbacks(@builtin(global_invocation_id) dispatchThreadId:vec3u,@builtin(num_workgroups) numWorkgroups:vec3u){
 let setup=vsmMapWalkOf(dispatchThreadId,numWorkgroups);
 if(!setup.valid||setup.handle.isSinglePage){return;}
 let projectionData=vsmProjectionOf(setup.handle);
 if(projectionData.lightKind==LIGHT_KIND_DIRECTIONAL){
  pmFallbacksDirectional(setup,projectionData);
 }else{
  pmFallbacksLocal(setup);
 }
}
`,
  )
  return {
    label: 'FillCoarserFallbacks',
    entryPoint: 'vsmFillCoarserFallbacks',
    specs,
    perPage: true,
    code: vsmPmModule(layout, specs, body, { perPage: true }),
  }
}

/** Every PM kernel for `layout`. */
export function vsmPageManagementKernels(layout: VsmLayout) {
  return {
    pageFlagPyramid: pageFlagPyramid(layout),
    fillCoarserFallbacks: fillCoarserFallbacks(layout),
  }
}
