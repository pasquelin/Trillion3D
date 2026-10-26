import { PAGE_BINDING, PAGE_INFO_WGSL, PAGE_LOOKUP_WGSL } from './pageWgsl.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { materialTableWgsl } from '../../materials/table/materialWgsl.ts'
import { VIS_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { wpoGraphWgsl } from './wpoGraphWgsl.ts'
import { VOXEL_HIT_WGSL } from './voxelHitWgsl.ts'
import { VIS_OUT_WGSL, hardwareWorkBinding } from './visWgsl.ts'
import { VIS_KEY_WGSL, pixelOffset, visWriteWgsl } from '../raster/pixelWgsl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { visTriangle } from '../visWords.ts'
import { VOXEL_BRICK_CORNERS } from '../../../../sdk-core/src/page/voxelPage.ts'
import type { Clipping } from '../../gpu/core/clipDistances.ts'
import { planeDistance } from '../../../../math/src/wgsl/geometry.ts'

/** The voxel slots' stages (`BIN_KIND.VOXEL`, `../passes/pipelines.ts`). */
export const VIS_VOXEL_VERTEX = 'vis_voxel_vs',
  VIS_VOXEL_FRAGMENT = 'vis_voxel_fs'

/** The voxel slots' fragment stage: the brick's voxels traced along the ray the vertex stage handed
 *  on, the first hit's depth taken as the pixel's key — into the buffer's word (`wide`) or out, with
 *  the identifier —, a miss, or a hit outside the depth range or behind the view's plane, leaving. */
const voxelFragment = (wide: boolean, clipping?: Clipping) => {
  const leave = wide ? 'return;' : 'return visLeft();'
  return `@fragment fn ${VIS_VOXEL_FRAGMENT}(in:VisVoxelIn)${wide ? '' : '->VisOut'}{
 let hit=voxelPixel(in.start,in.dir,in.cells);
 let z=voxelDepth(in.depth,hit.t);
 if(!hit.found||!(z>=0.0&&z<=1.0)){${leave}}
${clipping ? ` if(planeDistance(in.plane,in.start+in.dir*hit.t)<0.0){${leave}}\n` : ''}${
    wide
      ? ' visWrite(pixelOffset(vec2u(in.position.xy)),visKey(z,0u),in.id,false);'
      : ' return VisOut(in.id,bitcast<f32>(visKey(z,0u)));'
  }
}`
}

/**
 * THE VOXEL SLOTS OF THE VISIBILITY RASTER, a module of their own: the raster's other slots compile
 * the text they compiled before voxels, and no stage of theirs tests a row for voxels.
 *
 * A voxel row's vertex draws a corner of a brick's box, carried by its joint (`voxelCarry`), and
 * hands its pixels the ray through it (`voxelRay`); the pixel traces it (`voxelPixel`) and takes
 * the visibility write (`visWriteWgsl`; on a device without the 64-bit word, its identifier and
 * depth key out, `VIS_OUT_WGSL`) at the depth of the first voxel it meets, its identifier
 * the box's triangle — the resolve finds the voxel again from there —, or nothing: a hit in front
 * of the near plane or behind the far one is none, and so is one behind the view's clip plane — the
 * plane brought into the brick's cells, which the hit's point is read in — in the module made for the
 * project switch (`clipping`), which holds that code and the plain module does not. Rows draw here
 * on layer 0 alone (`PageRec.depthLayer`): no coplanar units raise their key. These slots are drawn last of a half, and only on a frame whose table holds a voxel
 * row (`drawVis`). With `wpo`, a brick whose surface wires a `worldPositionOffset` is carried by it,
 * its box and its voxels alike (`voxelCarry`).
 */
export const visVoxelShader = (clipping?: Clipping, wpo: WpoSet = NO_WPO, wide = false) =>
  wgslProgram(
    `${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${PAGE_BINDING.uniforms}
${PAGE_BINDING.instances}
${PAGE_BINDING.slotOffsets}
${hardwareWorkBinding(wide)}
${wpo.programs.length ? `@group(0) @binding(${VIS_BINDINGS.uv}) var<storage, read> uvs:array<f32>;\n` : ''}struct VisVoxelIn{@builtin(position) position:vec4f,@location(0) @interpolate(flat) id:u32,@location(1) start:vec3f,@location(2) dir:vec3f,@location(3) depth:vec4f,@location(4) @interpolate(flat) cells:vec3u,${clipping ? '@location(5) @interpolate(flat) plane:vec4f,' : ''}}
@vertex fn ${VIS_VOXEL_VERTEX}(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VisVoxelIn{
 var out:VisVoxelIn;
 let at=drawBatch(instanceIndex);let page=pages[at.x];let corner=at.y+vertexIndex;
 if(corner>=page.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);return out;}
 let v=voxelBoxVertex(corner);let brick=v/${VOXEL_BRICK_CORNERS}u;
 let mask=voxelBrickMask(page.pageOffset,brick);let box=voxelMaskBox(mask);
 let o=voxelBoxPoint(box,v);
 let cells=page.world*voxelCarry(page,brick)*voxelCells(page,brick);
 let m=uni.viewProj*cells;
 out.position=m*vec4f(o,1.0);
${clipping ? ' out.plane=transpose(cells)*uni.clipPlane;\n' : ''} let r=voxelRay(mask,box,o,m);
 out.start=r.start;out.dir=r.dir;out.depth=r.depth;out.cells=r.cells;
 out.id=page.packedBase|visTriangle(corner/3u);
 return out;
}
${voxelFragment(wide, clipping)}
`,
    [
      PAGE_INFO_WGSL,
      PAGE_LOOKUP_WGSL,
      VOXEL_HIT_WGSL,
      ...(wide ? [visWriteWgsl(true), pixelOffset] : [VIS_KEY_WGSL, VIS_OUT_WGSL]),
      visTriangle,
      ...(clipping ? [planeDistance] : []),
      ...(wpo.programs.length ? [materialTableWgsl(VIS_BINDINGS.material), wpoGraphWgsl(wpo)] : []),
    ],
  )
