/**
 * THE PAGE MARKS FROM THE FROXELS (`vsmMarkPagesFromFroxels`), in place of the marks from the pixels
 * (`../markingWgsl.ts`) where the view asks them (`shadowMarkPagesUseFroxels`): a thread a froxel of the
 * list the build made (`froxelBuildWgsl.ts`), 64 a group, over the indirect arguments the count sized.
 * It marks, as the reference's froxel marking does:
 * - in each sun's clipmap, the level its centre's distance asks (the level of the pixel marks, the depth of
 *   field's bias added), every page the froxel's box overlaps there: the box carried to the map's
 *   clip space (`vsmBoxInView`, as an instance is invalidated) and its rect of pixels (`vsmRectPixels`)
 *   taken to pages; a map that uses the receiver cover has the cells of the rect marked in it;
 * - in each local light's map of the cell of the light grid it lies in (at the tile's middle pixel and the
 *   centre's depth), the lights it reaches (the light's radius, its cone, a rectangle's front), at the
 *   mip its centre asks (the depth of field's bias added) — the face of a point or rectangle light its
 *   centre lies in —, the pages the box overlaps there. A distant light (a map of one page) is left to the
 *   coarse marking.
 * It culls no pixel that faces away from a light, takes no page dilation, and marks no page for the
 * translucent front layer: the reference's froxel marking replaces the pixel marks of the deferred
 * buffers whole.
 *
 * Group 0: the VSM tables, as the pixel pass's (`VSM_PIXELS_SPECS`). Group 1: 0 the grid (uniform), 1
 * the list of froxels (its held count at word 1), 3 the deferred `View`, 4 the lights, 5 the light grid,
 * 6 each light's VSM id, 7 the suns' map ids, 8 the marking parameters.
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { ceilDivWgsl } from '../../../../../../math/src/wgsl/integer.ts'
import { FLAT_INDEX_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { VIEW_WGSL } from '../../../deferred/worldAtWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../../direct/lightWgsl.ts'
import { localLightReaches } from '../../../direct/lightReachWgsl.ts'
import { TILE_SLICE_WGSL, pixelCellWgsl } from '../../../direct/lightingWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_HANDLE_WGSL } from '../pageTableWgsl.ts'
import {
  VSM_PROJECTION_DATA_READ_WGSL,
  VSM_PROJECTION_DATA_WGSL,
} from '../projection/projectionDataWgsl.ts'
import { vsmBindingsWgsl } from '../resources.ts'
import { VSM_PIXELS_SPECS, VSM_MARKING_PARAMS_WGSL, VSM_PAGE_MARKING_WGSL } from '../markingWgsl.ts'
import { NO_MIN_LEVEL } from '../markingWgsl.ts'
import { SHADOW_SLICE_WGSL } from '../../../direct/shadowSlice.ts'
import { VSM_BOX_VIEW_WGSL } from '../invalidation/boxCullWgsl.ts'
import type { VsmLayout } from '../layout.ts'
import { FROXEL_LIST_HEADER_WORDS, FROXEL_MARK_GROUP, VSM_FROXEL_GRID_WGSL } from './froxelGrid.ts'

export const FROXEL_MARK_ENTRY = 'vsmMarkPagesFromFroxels'

const froxelMarkDeclarationsText = /* wgsl */ `@group(1) @binding(0) var<uniform> froxelGrid:VsmFroxelGrid;
@group(1) @binding(1) var<storage,read> froxelList:array<u32>;
@group(1) @binding(3) var<uniform> view:View;
@group(1) @binding(4) var<storage,read> directLights:DirectLights;
// The light grid the marking pruned (\`vsmPruneLightGrid\`), read as the engine's.
@group(1) @binding(5) var<storage,read> tileLights:array<u32>;
@group(1) @binding(6) var<storage,read> vsmLightIds:array<i32>;
@group(1) @binding(7) var<storage,read> vsmDirectionalLightIds:array<u32>;
@group(1) @binding(8) var<uniform> vsmMarking:VsmMarkingParams;
/** The cells of a 4 x 4 sub-mask from \`lo\` to \`hi\` (inclusive), one bit each, row after row. */
fn vsmMakeMask4x4(lo:vec2u,hi:vec2u)->u32{
 let xMask=((1u<<(hi.x-lo.x+1u))-1u)<<lo.x;
 let yMask=((1u<<(hi.y*4u-lo.y*4u+4u))-1u)<<(lo.y*4u);
 return xMask*(0x1111u&yMask);
}
/** The receiver cover of the pages of a rect of pixels (\`pixels\`, inclusive) of map \`handle\`'s mip. */
fn vsmMarkCoverRect(handle:VsmHandle,mip:u32,pixels:vec4u){
 // The rect in the cover's cells (8 x 8 a page) and in its sub-masks (4 x 4 cells, 2 x 2 a page).
 let cells=pixels>>vec4u(VSM_LOG2_PAGE-VSM_LOG2_COVER_CELLS);
 let subs=pixels>>vec4u(VSM_LOG2_PAGE-1u);
 for(var y=subs.y;y<=subs.w;y++){
  for(var x=subs.x;x<=subs.z;x++){
   let sub=vec2u(x,y);
   let lo=clamp(vec2i(cells.xy)-vec2i(sub*4u),vec2i(0),vec2i(3));
   let hi=clamp(vec2i(cells.zw)-vec2i(sub*4u),vec2i(0),vec2i(3));
   let mask=vsmMakeMask4x4(vec2u(lo),vec2u(hi));
   if(mask!=0u){
    let t=vsmTableEntryOf(handle,mip,sub>>vec2u(1u)).tableXY*2u+(sub&vec2u(1u));
    if(vsmCoverInBounds(t,0u)){_=vsmReceiverCoverOr(vsmCoverIndex(t,0u),mask);}
   }
  }
 }
}`

const froxelMarkBoxText = () => /* wgsl */ `
/** Marks every page of map \`handle\`'s mip that the froxel box (\`box\`, in the view's space) overlaps. */
fn vsmMarkFroxel(handle:VsmHandle,mip:u32,box:VsmFroxelBox,directional:bool){
 let pd=vsmProjectionOf(handle);
 let nearClip=!directional;
 let toClip=vsmShiftedToClip(pd.shiftedToMapUv);
 let toMapShift=vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,vsmMarking.originShiftHigh,vsmMarking.originShiftLow);
 let m=froxelGrid.viewToShifted;
 let centre=(box.hi+box.lo)*0.5;
 let extent=(box.hi-box.lo)*0.5;
 // The box's axes (the view's) and the point it is culled from, in the map's shifted space.
 let axisX=m[0].xyz;let axisY=m[1].xyz;let axisZ=m[2].xyz;
 let point=vsmBoxCullPoint(centre,extent,directional,nearClip);
 let at=vec4f(axisX*point.x+axisY*point.y+axisZ*point.z+m[3].xyz+toMapShift,1.0);
 let cull=vsmBoxInView(toClip*at,toClip*vec4f(axisX,0.0),toClip*vec4f(axisY,0.0),toClip*vec4f(axisZ,0.0),extent,pd.lightViewToClip,directional,nearClip);
 if(!cull.inMapView){return;}
 let dim=i32(VSM_LEVEL0_TEXELS>>mip);
 let pixels=vec4u(vsmRectPixels(vec4i(0,0,dim,dim),cull));
 let pages=pixels>>vec4u(VSM_LOG2_PAGE);
 // A page marked from the depth is fine, as one marked from a pixel.
 let flags=VSM_PAGE_WANTED|VSM_PAGE_FINE;
 for(var y=pages.y;y<=pages.w;y++){
  for(var x=pages.x;x<=pages.z;x++){
   vsmRequestPage(vsmTableEntryOf(handle,mip,vec2u(x,y)),flags);
  }
 }
 if(pd.useCover){vsmMarkCoverRect(handle,mip,pixels);}
}
/** A sun's clipmap: the level the froxel's centre asks, the pages its box overlaps there. */
fn vsmMarkClipmapFroxel(handle:VsmHandle,centreShifted:vec3f,box:VsmFroxelBox,extraBias:f32){
 let pd=vsmProjectionOf(handle);
 let mapLevel=max(pd.mapLevel,max(${NO_MIN_LEVEL},vsmMarkedLevel(pd,centreShifted,extraBias)));
 let levelIndex=mapLevel-pd.mapLevel;
 if(levelIndex<pd.levelsLeft){vsmMarkFroxel(vsmHandleOffset(pd.handle,levelIndex),0u,box,true);}
}`

const froxelMarkKernelText = () => /* wgsl */ `
@compute @workgroup_size(${FROXEL_MARK_GROUP})
fn ${FROXEL_MARK_ENTRY}(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=flatIndex(wid,nwg,1u)*${FROXEL_MARK_GROUP}u+lane;
 if(index>=froxelList[1]){return;}
 let froxel=VsmFroxel(froxelList[${FROXEL_LIST_HEADER_WORDS}u+2u*index],bitcast<i32>(froxelList[${FROXEL_LIST_HEADER_WORDS}u+2u*index+1u]));
 let centre=vsmFroxelCentre(froxel);
 let box=vsmFroxelBounds(froxel);
 let centreShifted=(froxelGrid.viewToShifted*vec4f(centre,1.0)).xyz;
 // Where the depth of field blurs the image the maps are asked at a lower resolution.
 let extraBias=vsmDofResolutionBias(centre.z);
 // Directional lights.
 for(var index=0u;index<vsmMarking.sunMapCount;index++){
  vsmMarkClipmapFroxel(vsmHandleFromId(vsmDirectionalLightIds[index]),centreShifted,box,extraBias);
 }
 // Local lights, over the cell of the light grid the froxel lies in: that of the tile's middle pixel at its depth.
 let middle=vec2f(vsmFroxelTile(froxel)*${8}u+vec2u(${4}u));
 let slice=cellSlice(pixelCell(middle,vsmFroxelDeviceZ(centre.z)));
 for(var k=0u;k<slice.y;k++){
  let lightIndex=listedLight(slice,k);
  let light=directLights.items[lightIndex];
  // The pruned list holds the shadowed lights, those with a map of one page last, and the coarse marking marks their page; a cell without a grid walks every light.
  if(shadowSliceDistant(i32(light.params.y))){if(slice.x==TILE_NO_SLICE){continue;}break;}
  var handle=vsmHandleFromId(bitcast<u32>(vsmLightIds[lightIndex]));
  if(!vsmHandleIsValid(handle)){continue;}
  if(isSun(light)){continue;}
  let lightShifted=(light.positionRange.xyz+vsmMarking.originShiftHigh)+vsmMarking.originShiftLow;
  let d=lightShifted-centreShifted;
  let rect=isRect(light);
  if(!localLightReaches(d,light.positionRange.w,light.directionCone.w,light.directionCone.xyz,rect)){continue;}
  // A point or rectangle light: the face the centre lies in.
  if(!isSpot(light)){handle=vsmHandleOffset(handle,i32(vsmCubeFace(-d)));}
  let pd=vsmProjectionOf(handle);
  vsmMarkFroxel(handle,vsmMarkLocalMipLevel(pd,centreShifted,centre.z,extraBias),box,false);
 }
}`

export const vsmFroxelPageMarkingWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
${froxelMarkDeclarationsText}${froxelMarkBoxText()}${froxelMarkKernelText()}
`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_MARKING_PARAMS_WGSL,
      VSM_FROXEL_GRID_WGSL,
      VIEW_WGSL,
      vsmBindingsWgsl(0, VSM_PIXELS_SPECS, layout),
      DIRECT_LIGHT_WGSL,
      localLightReaches,
      TILE_SLICE_WGSL,
      pixelCellWgsl(),
      SHADOW_SLICE_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      VSM_PAGE_MARKING_WGSL,
      VSM_BOX_VIEW_WGSL,
      FLAT_INDEX_WGSL,
      ceilDivWgsl,
    ],
  )
