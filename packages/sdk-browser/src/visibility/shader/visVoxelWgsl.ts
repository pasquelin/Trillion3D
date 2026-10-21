import { PAGE_BINDING, PAGE_INFO_WGSL, PAGE_LOOKUP_WGSL } from './pageWgsl.ts'
import { VOXEL_HIT_WGSL } from './voxelHitWgsl.ts'
import { VIS_ID_PHASE, VIS_WORK_BINDING } from './visWgsl.ts'
import { VIS_WRITE_WGSL, pixelOffset } from '../raster/pixelWgsl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { visTriangle } from '../visWords.ts'
import { VOXEL_BRICK_CORNERS } from '../../../../sdk-core/src/page/voxelPage.ts'

/** The voxel slots' stages (`BIN_KIND.VOXEL`, `../passes/pipelines.ts`). */
export const VIS_VOXEL_VERTEX = 'vis_voxel_vs',
  VIS_VOXEL_FRAGMENT = 'vis_voxel_fs'

/**
 * THE VOXEL SLOTS OF THE VISIBILITY RASTER, a module of their own: the raster's other slots compile
 * the text they compiled before voxels, and no stage of theirs tests a row for voxels.
 *
 * A voxel row's vertex draws a corner of a brick's box, carried by its joint (`voxelCarry`), and
 * hands its pixels the ray through it (`voxelRay`); the pixel traces it (`voxelPixel`) and takes
 * the visibility write (`VIS_WRITE_WGSL`) at the depth of the first voxel it meets, its identifier
 * the box's triangle — the resolve finds the voxel again from there —, or nothing: a hit in front
 * of the near plane or behind the far one is none. Both phases trace the same ray, so a pixel meets
 * the key it wrote. Rows draw here on layer 0 alone (`itemWords.ts`): no coplanar units raise
 * their key. These slots are drawn last of a half, and only on a frame whose table holds a voxel
 * row (`drawVis`).
 */
export const visVoxelShader = () =>
  wgslProgram(
    `${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${PAGE_BINDING.uniforms}
${PAGE_BINDING.instances}
${PAGE_BINDING.slotOffsets}
${VIS_WORK_BINDING}
override ${VIS_ID_PHASE}:bool=false;
struct VisVoxelIn{@builtin(position) @invariant position:vec4f,@location(0) @interpolate(flat) id:u32,@location(1) start:vec3f,@location(2) dir:vec3f,@location(3) depth:vec4f,@location(4) @interpolate(flat) cells:vec3u,}
@vertex fn ${VIS_VOXEL_VERTEX}(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VisVoxelIn{
 var out:VisVoxelIn;
 let at=drawBatch(instanceIndex);let page=pages[at.x];let corner=at.y+vertexIndex;
 if(corner>=page.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);return out;}
 let v=voxelBoxVertex(corner);let brick=v/${VOXEL_BRICK_CORNERS}u;
 let mask=voxelBrickMask(page.pageOffset,brick);let box=voxelMaskBox(mask);
 let o=voxelBoxPoint(box,v);
 let m=uni.viewProj*page.world*voxelCarry(page,brick)*voxelCells(page,brick);
 out.position=m*vec4f(o,1.0);
 let r=voxelRay(mask,box,o,m);
 out.start=r.start;out.dir=r.dir;out.depth=r.depth;out.cells=r.cells;
 out.id=page.packedBase|visTriangle(corner/3u);
 return out;
}
@fragment fn ${VIS_VOXEL_FRAGMENT}(in:VisVoxelIn){
 let hit=voxelPixel(in.start,in.dir,in.cells);
 let z=voxelDepth(in.depth,hit.t);
 if(!hit.found||!(z>=0.0&&z<=1.0)){return;}
 let offset=pixelOffset(vec2u(in.position.xy));
 let key=visKey(z,0u);
 if(!visPasses(offset,key,${VIS_ID_PHASE})){return;}
 visWrite(offset,key,in.id,${VIS_ID_PHASE});
}
`,
    [PAGE_INFO_WGSL, PAGE_LOOKUP_WGSL, VOXEL_HIT_WGSL, VIS_WRITE_WGSL, pixelOffset, visTriangle],
  )
