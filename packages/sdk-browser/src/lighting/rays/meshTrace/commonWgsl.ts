import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { depthOfLogSlice } from '../../../../../math/src/wgsl/projection.ts'
import { OBJECT_FLAGS } from '../../distanceField/layout.ts'
import { MESH_GRID_FLAG, MESH_GRID_PARAMS } from './layout.ts'

/**
 * WHAT EVERY PROGRAM OF THE MESHES' FIELDS TRACE DECLARES (`meshGridCommonWgsl`): its uniform (`msdf`,
 * `MESH_GRID_PARAMS`), a device depth as a distance in centimetres and back, the depth law's slices
 * (`msdfSliceDepth`: the depth a slice starts at, from the log law or, for a grid of one slice, from the span the
 * mesh may be traced over) and the index of the grid's cell a pixel at a depth falls in (`msdfCellIndex`: the pixel's cell
 * along x and y, the slice along z, held to the last, rows of x then y then z).
 */
export const meshGridCommonWgsl = (group: number, binding: number) =>
  wgslBlock(
    `MESH_GRID_COMMON_WGSL ${group} ${binding}`,
    [depthOfLogSlice],
    `${wgslConsts({
      MSDF_SLICES: MESH_GRID_FLAG.slices,
      MSDF_EMISSIVE: OBJECT_FLAGS.emissive,
      MSDF_VISIBLE: OBJECT_FLAGS.visible,
      MSDF_HIDDEN_AFFECTS: OBJECT_FLAGS.affectsIndirectLightingHidden,
    })}
${MESH_GRID_PARAMS.wgsl}
@group(${group}) @binding(${binding}) var<uniform> msdf:MeshGridParams;
fn msdfDepthCm(z:f32)->f32{
 let distance=select(msdf.depth.y+(1.0-z)*msdf.depth.x,msdf.depth.x/max(z,1e-30),msdf.depth.z>0.5);
 return min(distance*100.0,3.4e38);
}
fn msdfDeviceDepth(cm:f32)->f32{
 let distance=cm*0.01;
 return select(1.0-(distance-msdf.depth.y)/msdf.depth.x,msdf.depth.x/max(distance,1e-30),msdf.depth.z>0.5);
}
fn msdfSliceDepth(slice:f32)->f32{
 if((msdf.counts.w&MSDF_SLICES)!=0u){return depthOfLogSlice(slice,msdf.zParams.xyz);}
 return mix(0.0,msdf.distances.x,slice);
}
fn msdfSliceOf(depth:f32)->u32{
 let slice=u32(max(0.0,log2(max(depth*msdf.zParams.x+msdf.zParams.y,1e-30))*msdf.zParams.z));
 return min(slice,msdf.grid.z-1u);
}
fn msdfCellIndex(pixel:vec2u,depth:f32)->u32{
 let x=pixel.x>>msdf.grid.w;
 let y=pixel.y>>msdf.grid.w;
 return (msdfSliceOf(depth)*msdf.grid.y+y)*msdf.grid.x+x;
}`,
  )
