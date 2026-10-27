import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { VIS_BINDINGS } from '../../../../gpu/bind/bindLayout.ts'
import {
  SHADOW_TILE_POOL_WGSL,
  dataSampleWgsl,
  maskAlphaWgsl,
  tileDeclarations,
} from '../../../../materials/virtual/wgsl.ts'
import {
  PAGE_GEOMETRY_WGSL,
  PAGE_NORMAL_WGSL,
  UV_READ,
} from '../../../../visibility/shader/pageGeometryWgsl.ts'
import {
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  maskKeepWgsl,
} from '../../../../visibility/shader/pageWgsl.ts'
import { PAGE_UV_OR_FIRST_WGSL, maskUvWgsl } from '../../../../visibility/shader/pageUvSetWgsl.ts'
import { FLAG_MASK } from '../../../../visibility/types.ts'
import { TESS_BINDINGS as B } from '../../../../visibility/tessellation/bindings.ts'
import {
  ARG_VISIBLE,
  ARG_VISIBLE_TWO_SIDED,
  PATCH_WORDS,
} from '../../../../visibility/tessellation/contract.ts'
import {
  DICE_CUTOUT_WGSL,
  DICE_PATCH_WGSL,
} from '../../../../visibility/tessellation/diceSetupWgsl.ts'
import { pointDisplacement } from '../../../../visibility/tessellation/domainWgsl.ts'
import { PATTERN_PLAIN_WGSL } from '../../../../visibility/tessellation/patchWgsl.ts'
import { TESS_READ_PLAIN_WGSL } from '../../../../visibility/tessellation/queueWgsl.ts'
import { visTriangle } from '../../../../visibility/visWords.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_PROJECTION_DATA_WGSL } from '../projection/projectionDataWgsl.ts'
import { VSM_CASTER_PROJECTION_WGSL } from '../render/renderCasterWgsl.ts'
import {
  VSM_RENDER_OUT_WGSL,
  VSM_RENDER_RASTER_SHARED_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
} from '../render/renderRasterWgsl.ts'
import { vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { NO_MASKS, type MaskSet } from '../../../../materials/graph/maskProgram.ts'
import { VSM_TESS_VIEW_WGSL } from './shadowViewWgsl.ts'
import { NO_WPO, type WpoSet } from '../../../../materials/graph/wpoProgram.ts'
import { materialTableWgsl } from '../../../../materials/table/materialWgsl.ts'
import { wpoGraphWgsl } from '../../../../visibility/shader/wpoGraphWgsl.ts'

const tessellatedDeclarations = (
  vertexCut: boolean,
) => /* wgsl */ `/** The rows the draw takes: 1 the two-sided rows', 0 the one-sided rows' (\`createShadowPrograms\`): their list. */
override VSM_TESS_TWO_SIDED:u32=0u;
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
@group(0) @binding(${VIS_BINDINGS.uv}) var<storage,read> uvs:array<f32>;
@group(1) @binding(0) var<storage,read> vsmRenderRecords:array<vec4u>;
@group(2) @binding(${B.tessUniform}) var<uniform> tu:TessUni;
@group(2) @binding(${B.tess}) var<storage,read> tess:array<u32>;
${tileDeclarations(B.data, 'data', 2)}
${vertexCut ? tileDeclarations(B.color, 'color', 2) : ''}
@group(2) @binding(${B.sampler}) var mapsSampler:sampler;`

const tessellatedVertexBody = (vertexCut: boolean, wpo: WpoSet) => /* wgsl */ `
@vertex fn vsmTessellatedVs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instance:u32)->VsmRenderOut{
 var out:VsmRenderOut;
 out.position=vsmRenderNan();out.row=0u;out.uv=vec2f(0.0);out.window=vec3u(0u);out.clip=vec4f(0.0);out.masked=0u;
 // The patches of the rows of this draw's kind, in their own list.
 let twoSided=VSM_TESS_TWO_SIDED!=0u;
 if(instance>=min(tw(tu.args+select(${ARG_VISIBLE}u,${ARG_VISIBLE_TWO_SIDED}u,twoSided)),tu.maxVisible)){return out;}
 let piece=loadPatch(select(tu.visible,tu.visibleTwoSided,twoSided)+instance*${PATCH_WORDS}u);
 let record=vsmRenderRecords[piece.x>>8u];
 let page=pages[record.x];
 let h=pageHeaderFor(page,true);
 let rec=displacementOf(page);
 let corners=pageTriangle(page,h,visTriangle(piece.x));
 let raw=vsmProjectionData[vsmRecordMap(record)];
${wpo.programs.length ? ' wpoThreshold=raw.wpoThreshold;\n' : ''} let view=vsmTessView(raw,vsmRecordMip(record));
 let d=dicePatch(page,rec,piece,view,pageTrianglePositions(page,h,corners),
  mat3x3f(pageNormal(page,h,corners.x),pageNormal(page,h,corners.y),pageNormal(page,h,corners.z)),
  mat3x2f(pageUvOrFirst(page,h,corners.x,rec.map.y),pageUvOrFirst(page,h,corners.y,rec.map.y),pageUvOrFirst(page,h,corners.z,rec.map.y)));
 let t=vertexIndex/3u;
 if(t>=patternTriangles(d.pattern)){return out;}
 var corner=vertexIndex%3u;
 if(corner!=0u&&vsmRecordSwapped(record)){corner=3u-corner;}
 let c=patternCorners(d.pattern,t);${
   vertexCut
     ? `
 // A masked row's cutout is judged at the three vertices of the micro-triangle: it is drawn only
 // where every one is kept, each vertex stage invocation reading all three.
 if((page.flags&${FLAG_MASK}u)!=0u){
  let uv=mat3x2f(pageMaskUv(page,h,corners.x),pageMaskUv(page,h,corners.y),pageMaskUv(page,h,corners.z));
  let alpha=vec3f(pageMaskAlpha(page,h,corners.x),pageMaskAlpha(page,h,corners.y),pageMaskAlpha(page,h,corners.z));
  for(var k=0u;k<3u;k++){
   if(!dicedKept(page,d,view,diceVertex(d,rec,view,c[k]),uv,alpha)){return out;}
  }
 }`
     : ''
 }
 let at=diceVertex(d,rec,view,select(select(c.z,c.y,corner==1u),c.x,corner==0u));${
   vertexCut
     ? ''
     : `
 // Where the colour atlas is not bound here, the fragment judges a masked row's cutout, at the
 // coordinate of the point just diced.
 if((page.flags&${FLAG_MASK}u)!=0u){
  out.masked=1u;
  if((page.flags&${UV_READ}u)==${UV_READ}u){
   out.uv=mat3x2f(pageMaskUv(page,h,corners.x),pageMaskUv(page,h,corners.y),pageMaskUv(page,h,corners.z))*at.b;
  }
 }`
 }
 let world=at.point.world+at.point.normal*pointDisplacement(at.point,at.height,rec.scale,d.fade,true);
 let shifted=vsmRenderShifted(raw,world);
 out.row=record.x;
 out.window=vsmRenderWindowOf(record);
 let clip=vsmRenderClip(raw,shifted);
 out.position=vsmRenderRasterPosition(clip,record);out.clip=clip;
 return out;
}`

/**
 * THE SHADOW MAPS' DRAW OF THE PATCHES, the vertex stage of a hardware raster into the same dummy
 * attachment as the casters' tiers (`../render/renderRasterWgsl.ts`), its fragment stage theirs
 * (`vsmRenderFs`, a module of its own: `VsmRenderOut` is the one interface). One instance a visible
 * patch (`vsmTessSplit` listed them), `3 × the most triangles of a pattern of the draw's rows`
 * vertices an instance (`vsmTessDrawArgs`): vertex k of an instance is corner `k % 3` of triangle
 * `k / 3` of the pattern
 * the patch's edge factors pick — the factors, the pattern and the dicing are the image's
 * (`dicePatch`, `diceVertex`) over the map's view —, a triangle past the pattern's dropped. Each
 * vertex dices on its own: the same barycentric point of the same patch is the same displaced point
 * whichever triangle asks for it, so neighbours meet. The point is pushed along its normal by the
 * displacement, the least one where the fade has not left it whole (`pointDisplacement`), then
 * placed on the record's window as a caster's corner is (`vsmRenderVs`): same swap of a back face, same
 * depth. Two draws share the stage (`VSM_TESS_TWO_SIDED`): the one-sided rows' culls the back
 * faces, the two-sided rows' culls none and draws the pattern once; each reads the list of its rows'
 * patches alone (`listVisible`, `listVisibleTwoSided`). A masked row is cut out
 * at the vertices of its micro-triangles, as the image's dicing does (`dicedKept`), where the
 * vertex stage may also bind the colour atlas's page table, a ninth storage buffer, which a device
 * that grants it takes (`vertexCut`, `vsmMaskedPatches`); on the eight WebGPU guarantees every
 * device, the row is drawn all the same and its cutout judged by the fragment, which the stage
 * tells the row's coordinate at the point it dices (the casters' own `maskKeep`, `vsmRenderFs`).
 * A surface whose graph wires an `opacityMask` is cut by the graph's mask (`masks`), and one that
 * wires a `worldPositionOffset` is diced on the triangle its offset moves, where the map's level shows
 * the motion (`wpo`, `wpoThreshold`).
 *
 * Group 0 the shadow page group (`../../casters/pageGroup.ts`), 1 the records and the projections
 * (`makeRaster`), 2 the tessellation's: its uniform, its `tess` buffer, the data atlas and its
 * sampler (`TESS_PROGRAMS.shadowRaster`).
 */
export const vsmTessellatedVertexWgsl = (
  layout: VsmLayout,
  vertexCut = false,
  masks: MaskSet = NO_MASKS,
  wpo: WpoSet = NO_WPO,
) =>
  wgslProgram(
    /* wgsl */ `
${tessellatedDeclarations(vertexCut)}${tessellatedVertexBody(vertexCut, wpo)}
`,
    [
      VSM_RENDER_OUT_WGSL,
      PAGE_INFO_WGSL,
      VSM_CASTER_PROJECTION_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_VERTEX_SPECS, layout),
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_SHARED_SPECS, layout),
      PAGE_GEOMETRY_WGSL,
      PAGE_NORMAL_WGSL,
      maskUvWgsl(VIS_BINDINGS.normals),
      PAGE_UV_OR_FIRST_WGSL,
      SHADOW_TILE_POOL_WGSL,
      dataSampleWgsl(SHADOW_TILE_POOL_WGSL),
      TESS_READ_PLAIN_WGSL,
      PATTERN_PLAIN_WGSL,
      DICE_PATCH_WGSL,
      ...(vertexCut
        ? [DICE_CUTOUT_WGSL, maskKeepWgsl(maskAlphaWgsl(true, SHADOW_TILE_POOL_WGSL), masks)]
        : []),
      pointDisplacement,
      VSM_TESS_VIEW_WGSL,
      visTriangle,
      ...(wpo.programs.length ? [materialTableWgsl(wpo.table), wpoGraphWgsl(wpo)] : []),
    ],
  )
