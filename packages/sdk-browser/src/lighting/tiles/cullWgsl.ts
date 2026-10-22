import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { HIZ_FOOTPRINT_WGSL } from '../../visibility/hiz/gpu/footprintWgsl.ts'

/**
 * THE LIGHT GRID'S CULL AGAINST THE DEPTH PYRAMID (`columnReach`): of a column of cells, the last
 * depth slice that can be seen. The column's pixel rectangle, widened by the margin the fog volume
 * reads the lists beyond the surfaces with (`view.cull.y`, in pixels), is clipped to the image; the
 * farthest depth of its footprint in the culling layer of the pyramid this very image built
 * (`pyramidFarthest`, four texels a side of the lowest level that holds the rectangle) bounds every
 * pixel the column holds, so a cell whose nearest face lies behind it is seen by none and its list
 * is empty, and a light's run ends at the cell that holds that depth — the cell's far end tightened
 * to the farthest surface.
 *
 * The fog volume reads a cell's list at the centre of its own cell, up to `view.cull.z` fog cells
 * (one) behind a surface: the farthest depth is taken as far as the fog slice (`view.sliceMap`, the
 * volume's `fogSliceAtDepth` numbers, `view.cull.w` the near plane) that many slices past the one
 * that holds it. A column with a pixel that shows the background (depth zero), a pyramid that is
 * not this image's, or the setting `lightGridHizCull` off (`view.cull.x`) is not cut. The cell's far end
 * is cut to that depth as it is, with no factor.
 */
export const GRID_CULL_WGSL = wgslBlock(
  'GRID_CULL_WGSL',
  [HIZ_FOOTPRINT_WGSL],
  `@group(1) @binding(0) var hizPyramid:texture_2d_array<u32>;
@group(1) @binding(1) var<uniform> hizLevels:HizLevels;
/** The farthest depth the fog volume's cells read the lists at, behind a surface at \`farthest\`. */
fn fogReachDepth(farthest:f32)->f32{
 let slice=floor(log2(view.cull.w/farthest*view.sliceMap.x+view.sliceMap.y)*view.sliceMap.z);
 if(!(slice>=0.0)){return farthest;}
 let limit=(exp2((slice+view.cull.z+1.0)/view.sliceMap.z)-view.sliceMap.y)/view.sliceMap.x;
 return min(farthest,view.cull.w/limit);
}
/** The last slice of the column of cell \`cell\` a pixel can read the lists at. */
fn columnReach(cell:vec2u)->u32{
 if(view.cull.x==0.0){return GRID_SLICES-1u;}
 let margin=vec2i(i32(view.cull.y));
 let size=vec2i(view.viewport.xy);
 let low=max(vec2i(cell*TILE_SIZE)-margin,vec2i(0));
 let high=min(vec2i((cell+vec2u(1u))*TILE_SIZE)+margin-vec2i(1),size-vec2i(1));
 var farthest=pyramidFarthest(vec4i(low,high));
 if(!(farthest>0.0)){return GRID_SLICES-1u;}
 if(view.cull.z>0.0){farthest=fogReachDepth(farthest);}
 return gridSlice(farthest);
}`,
)
