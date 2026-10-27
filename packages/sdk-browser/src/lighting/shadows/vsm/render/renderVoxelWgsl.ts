import { VSM_CASTER_PROJECTION_WGSL } from './renderCasterWgsl.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { PAGE_BINDING, PAGE_INFO_WGSL } from '../../../../visibility/shader/pageWgsl.ts'
import { VIS_BINDINGS } from '../../../../gpu/bind/bindLayout.ts'
import { VOXEL_HIT_WGSL } from '../../../../visibility/shader/voxelHitWgsl.ts'
import { VOXEL_BRICK_CORNERS } from '../../../../../../sdk-core/src/page/voxelPage.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_PROJECTION_DATA_WGSL } from '../projection/projectionDataWgsl.ts'
import { vsmBindingsWgsl } from '../resources.ts'
import {
  VSM_RENDER_JOIN_WGSL,
  VSM_RENDER_OUT_WGSL,
  VSM_RENDER_RASTER_FRAGMENT_SPECS,
  VSM_RENDER_RASTER_SHARED_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
} from './renderRasterWgsl.ts'
import type { VsmLayout } from '../layout.ts'
import { NO_WPO, type WpoSet } from '../../../../materials/graph/wpoProgram.ts'
import { materialTableWgsl } from '../../../../materials/table/materialWgsl.ts'
import { wpoGraphWgsl } from '../../../../visibility/shader/wpoGraphWgsl.ts'

const voxelVertex = (wpo: WpoSet) => /* wgsl */ `${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
@group(0) @binding(${VIS_BINDINGS.uv}) var<storage, read> uvs:array<f32>;
@group(1) @binding(0) var<storage,read> vsmRenderRecords:array<vec4u>;
/** The corners a record of this pipeline's voxel tier draws (\`vsmRenderTierCorners\`). */
override VSM_RENDER_CORNERS:u32=768u;
struct VsmVoxelOut{
 @builtin(position) position:vec4f,
 /** The window (\`vsmRenderWindowOf\`). */
 @location(0) @interpolate(flat) window:vec4u,
 /** The light's ray through the box point (\`voxelRay\`). */
 @location(1) start:vec3f,
 @location(2) dir:vec3f,
 @location(3) depth:vec4f,
 @location(4) @interpolate(flat) cells:vec3u,
}
@vertex fn vsmRenderVs(@builtin(vertex_index) vertexIndex:u32)->VsmVoxelOut{
 let record=vsmRenderRecords[vertexIndex/VSM_RENDER_CORNERS];
 let recordCorner=vertexIndex%VSM_RENDER_CORNERS;
 var out:VsmVoxelOut;
 out.window=vsmRenderWindowOf(record);
 let page=pages[record.x];
 if(recordCorner>=page.indexCount){out.position=vsmRenderNan();return out;}
 let raw=vsmProjectionData[vsmRecordMap(record)];
${wpo.programs.length ? ' wpoThreshold=raw.wpoThreshold;\n' : ''} var corner=recordCorner%3u;
 if(corner!=0u&&vsmRecordSwapped(record)){corner=3u-corner;}
 let v=voxelBoxVertex(recordCorner-recordCorner%3u+corner);let brick=v/${VOXEL_BRICK_CORNERS}u;
 let mask=voxelBrickMask(page.pageOffset,brick);let box=voxelMaskBox(mask);
 let o=voxelBoxPoint(box,v);
 let shift=raw.originShiftHigh+raw.originShiftLow;
 let toShifted=mat4x4f(1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,shift.x,shift.y,shift.z,1.0);
 let cells=page.world*voxelCarry(page,brick)*voxelCells(page,brick);
 let shifted=vsmRenderShifted(raw,(cells*vec4f(o,1.0)).xyz);
 let clip=vsmRenderClip(raw,shifted);
 let r=voxelRay(mask,box,o,raw.shiftedToMapUv*toShifted*cells);
 out.start=r.start;out.dir=r.dir;out.depth=r.depth;out.cells=r.cells;
 // Placed on the record's window, as the raster places every corner.
 out.position=vsmRenderRasterPosition(clip,record);
 return out;
}`

const voxelFragment = () => /* wgsl */ `
/** The depth fragment: the first voxel's depth on the light's ray, an atomic max into the pool. */
@fragment fn vsmRenderFs(in:VsmVoxelOut){
 var texel:vec2u;
 if(!vsmRenderPoolTexel(in.window,in.position.xy,&texel)){discard;}
 let hit=voxelPixel(in.start,in.dir,in.cells);
 if(!hit.found){discard;}
 vsmRenderJoin(in.window,texel,voxelDepth(in.depth,hit.t));
}`

/**
 * The shadow raster's voxel tiers (`VSM_RENDER_FAMILY.voxel`), a module of their own beside the
 * raster (`renderRasterWgsl.ts`), whose text the other tiers compile as they did before voxels: the
 * same records, groups and pool, a voxel row's records alone, made the first time a table holds a
 * voxel row (`renderPipes.ts`). Its vertex draws a corner of a brick's box, carried by its joint, on
 * the record's window as the raster places every corner, and hands its pixels
 * the light's ray through it (`voxelRay`, the camera's one sequence); its fragment traces it
 * (`voxelPixel`) and joins the first voxel's depth to the pool, which clamps it to [0,1], or nothing;
 * a sun level's boxes are given the rasterizer at z = w / 2, as the raster's corners are. A
 * voxel row draws one side of its boxes, no cutout, and reads no page in its fragment. With `wpo`, a
 * brick whose surface wires a `worldPositionOffset` is carried by it where the map's level shows the
 * motion (`wpoThreshold`), as the raster moves a vertex.
 */
export const vsmRenderVoxelWgsl = (layout: VsmLayout, wpo: WpoSet = NO_WPO) =>
  wgslProgram(
    /* wgsl */ `
${voxelVertex(wpo)}${voxelFragment()}
`,
    [
      VSM_RENDER_OUT_WGSL,
      VSM_RENDER_JOIN_WGSL,
      PAGE_INFO_WGSL,
      VSM_CASTER_PROJECTION_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_VERTEX_SPECS, layout),
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_FRAGMENT_SPECS, layout),
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_SHARED_SPECS, layout),
      VOXEL_HIT_WGSL,
      ...(wpo.programs.length ? [materialTableWgsl(VIS_BINDINGS.material), wpoGraphWgsl(wpo)] : []),
    ],
  )
