import { VSM_CASTER_PROJECTION_WGSL } from './renderCasterWgsl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { bitAt, bitIsSet, byteOf } from '../../../math/src/wgsl/integer.ts'
import { PAGE_BINDING, PAGE_INFO_WGSL } from '../visibility/shader/pageWgsl.ts'
import { VIS_BINDINGS } from '../webgpu/core/bindLayout.ts'
import { VOXEL_HIT_WGSL } from '../visibility/shader/voxelHitWgsl.ts'
import { VOXEL_BRICK_CORNERS } from '../../../sdk-core/src/page/voxelPage.ts'
import { VSM_CONSTANTS_WGSL, VSM_F32_BELOW_ONE } from './constants.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { vsmBindingsWgsl } from './resources.ts'
import {
  VSM_RENDER_RASTER_FRAGMENT_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
} from './renderRasterWgsl.ts'
import type { VsmLayout } from './layout.ts'

/**
 * The shadow raster's voxel tiers (from `VSM_RENDER_VOXEL_TIER`), a module of their own beside the
 * raster (`renderRasterWgsl.ts`), whose text the other tiers compile as they did before voxels: the
 * same pairs, groups and pool, a voxel row's pairs alone, made the first time a table holds a voxel
 * row (`renderPipes.ts`). Its vertex draws a corner of a brick's box,
 * carried by its joint, on the pair's page as the raster places every corner, and hands its pixels
 * the light's ray through it (`voxelRay`, the camera's one sequence); its fragment traces it
 * (`voxelPixel`) and joins the first voxel's depth to the pool, or nothing — a sun level's hit in
 * front of its near plane flattened onto it, as the raster flattens a corner (`vsmRenderClip`). A
 * voxel row draws one side of its boxes, no cutout, and reads no page in its fragment.
 */
export const vsmRenderVoxelWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
@group(0) @binding(${VIS_BINDINGS.uv}) var<storage, read> uvs:array<f32>;
@group(1) @binding(0) var<storage,read> vsmRenderPairs:array<vec4u>;
/** The corners a pair of this pipeline's voxel tier draws (\`vsmRenderTierCorners\`). */
override VSM_RENDER_CORNERS:u32=768u;
struct VsmVoxelOut{
 @builtin(position) position:vec4f,
 /** Physical page address (x | y << 10) and pool slice. */
 @location(0) @interpolate(flat) dest:vec2u,
 /** Translated world (relative to a local light) and the emitter radius, 0 for none. */
 @location(1) fromEmitter:vec4f,
 /** The light's ray through the box point (\`voxelRay\`); \`cells.w\` whether a sun level flattens. */
 @location(2) from:vec3f,
 @location(3) dir:vec3f,
 @location(4) depth:vec4f,
 @location(5) @interpolate(flat) cells:vec4u,
}
@vertex fn vsmRenderVs(@builtin(vertex_index) vertexIndex:u32)->VsmVoxelOut{
 let pair=vsmRenderPairs[vertexIndex/VSM_RENDER_CORNERS];
 let pairCorner=vertexIndex%VSM_RENDER_CORNERS;
 var out:VsmVoxelOut;
 out.dest=vec2u(pair.w,bitAt(pair.y,21u));
 let page=pages[pair.x];
 if(pairCorner>=page.indexCount){out.position=vec4f(-4.0,-4.0,0.5,1.0);return out;}
 let raw=vsmProjectionData[pair.y&0xFFFFu];
 var corner=pairCorner%3u;
 if(corner!=0u&&bitIsSet(pair.y,22u)){corner=3u-corner;}
 let v=voxelBoxVertex(pairCorner-pairCorner%3u+corner);let brick=v/${VOXEL_BRICK_CORNERS}u;
 let mask=voxelBrickMask(page.pageOffset,brick);let box=voxelMaskBox(mask);
 let o=voxelBoxPoint(box,v);
 let shift=raw.originShiftHigh+raw.originShiftLow;
 let toShifted=mat4x4f(1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,shift.x,shift.y,shift.z,1.0);
 let cells=page.world*voxelCarry(page,brick)*voxelCells(page,brick);
 let shifted=vsmRenderShifted(raw,(cells*vec4f(o,1.0)).xyz);
 let isOrthoView=raw.lightViewToClip[3][3]>=1.0;
 out.fromEmitter=vec4f(shifted,select(raw.emitterSize,0.0,isOrthoView));
 let flatten=bitIsSet(pair.y,20u);
 let clip=vsmRenderClip(raw,shifted,flatten);
 let r=voxelRay(mask,box,o,raw.shiftedToMapUv*toShifted*cells);
 out.from=r.from;out.dir=r.dir;out.depth=r.depth;out.cells=vec4u(r.cells,select(0u,1u,flatten));
 // Clip scaled and biased onto the pair's page, as the raster places every corner.
 let mipLevel=(pair.y>>16u)&7u;
 let s=f32(VSM_LEVEL0_TEXELS>>mipLevel)/f32(VSM_PAGE_TEXELS/2u);
 let vPage=vec2f(f32(byteOf(pair.z,0u)),f32(byteOf(pair.z,1u)));
 out.position=vec4f(clip.x*s-clip.w*(2.0*vPage.x+1.0),clip.w*(2.0*vPage.y+1.0)-clip.y*s,clip.z,clip.w);
 return out;
}
/** The depth fragment: the emitter envelope, then the first voxel's depth on the light's ray, an
 *  atomic max into the pool. */
@fragment fn vsmRenderFs(in:VsmVoxelOut){
 let r=in.fromEmitter.w;
 if(r>0.0&&dot(in.fromEmitter.xyz,in.fromEmitter.xyz)<r*r){discard;}
 let hit=voxelPixel(in.from,in.dir,in.cells.xyz);
 if(!hit.found){discard;}
 var z=voxelDepth(in.depth,hit.t);
 if(in.cells.w!=0u){z=min(z,${VSM_F32_BELOW_ONE});}
 let physical=vec2u(in.dest.x&0x3FFu,(in.dest.x>>10u)&0x3FFu);
 let texel=physical*VSM_PAGE_TEXELS+min(vec2u(in.position.xy),vec2u(VSM_PAGE_TEXEL_MASK));
 let depth=bitcast<u32>(clamp(z,0.0,1.0));
 vsmPoolAtomicMax(texel,in.dest.y,depth);
 if(in.dest.y!=0u){vsmPoolAtomicMax(texel,0u,depth);}
}
`,
    [
      PAGE_INFO_WGSL,
      VSM_CASTER_PROJECTION_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_VERTEX_SPECS, layout),
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_FRAGMENT_SPECS, layout),
      VOXEL_HIT_WGSL,
      byteOf,
      bitAt,
      bitIsSet,
    ],
  )
