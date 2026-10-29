import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { VG_TYPES_WGSL } from './gridTypesWgsl.ts'

/** The bytes of the grid parameters (`VgGridParams`): the ortho grid's bounds, resolution and flags, the frustum grid's and its view matrix, the voxels of a top-level cell. */
export const VG_GRID_PARAMS_BYTES = 176

/**
 * THE EXTINCTION OF THE VOXEL GRIDS AT A WORLD POINT: the point is looked for in the frustum grid first (a view-space point cut into the
 * grid's cells by the field of view and the linear depth), then, outside it, in the ortho grid (the point's place in the bounds cut into the
 * top-level cells). A top-level cell holds the bottom-level cells of its volume, or, with the indirection grid, the indirection cells that
 * hold them; a cell of the bottom level is read by the Morton order of its place, with no interpolation.
 *
 * The host declares what the functions read: `gridParams` (uniform, `VgGridParams`), `gridOrthoTop` and `gridIndirection` (the ortho
 * grid's top-level cells and indirection cells, one word each), `gridExtinction` (the ortho grid's bottom-level cells, two words each),
 * `gridFrustumTop` and `gridFrustumExtinction` (the frustum grid's), all read-only storage arrays.
 */
export const VG_EVAL_WGSL = wgslBlock(
  'VG_EVAL_WGSL',
  [VG_TYPES_WGSL],
  `struct VgGridParams{
 orthoMin:vec3f,
 useOrtho:i32,
 orthoMax:vec3f,
 indirection:i32,
 orthoResolution:vec3i,
 useFrustum:i32,
 frustumMin:vec3f,
 nearDepth:f32,
 frustumMax:vec3f,
 farDepth:f32,
 frustumResolution:vec3i,
 tanHalfFov:f32,
 worldToView:mat4x4f,
 // x the voxels along a side of a top-level cell of the ortho grid (its bottom level times its indirection grid).
 cellVoxels:vec4i,
}

/** The cell of a point of a top-level cell at a resolution of cells a side: the cell by the Morton order of its place. */
fn vgMortonCell(inCell:vec3f,res:u32)->u32{
 let place=clamp(vec3i(inCell*f32(res)),vec3i(0),vec3i(i32(res)-1));
 return mortonEncode3(vec3u(place));
}
/** The voxel of the point in view space: the screen place by the field of view, the depth linear between the near and far planes. */
fn vgViewToVoxel(view:vec3f)->vec3f{
 let res=vec3f(gridParams.frustumResolution);
 let aspect=res.xy/res.x;
 let screen=view.xy/(gridParams.tanHalfFov*aspect*view.z);
 let depth=(view.z-gridParams.nearDepth)/(gridParams.farDepth-gridParams.nearDepth);
 return vec3f(screen*0.5+vec2f(0.5),depth)*res;
}

fn vgEvalExtinctionInFrustum(world:vec3f,inFrustum:ptr<function,bool>)->vec3f{
 *inFrustum=false;
 if(gridParams.useFrustum==0){return vec3f(0.0);}
 let view=(gridParams.worldToView*vec4f(world,1.0)).xyz;
 let voxel=vgViewToVoxel(view);
 let res=vec3f(gridParams.frustumResolution);
 *inFrustum=all(voxel>vec3f(0.0))&&all(voxel<res);
 if(!*inFrustum){return vec3f(0.0);}
 let word=gridFrustumTop[vgLinearIndex(vec3u(voxel),gridParams.frustumResolution)];
 if(!vgIsAllocated(word)){return vec3f(0.0);}
 let cell=vgBottomIndex(word)+vgMortonCell(fract(voxel),word&7u);
 return vgColorOf(gridFrustumExtinction[cell]);
}

/** The bottom-level cell of the ortho grid a point falls in, as an index of the cell arrays; -1 outside the grid or where the cell holds none. */
fn vgOrthoCellAt(world:vec3f)->i32{
 if(gridParams.useOrtho==0){return -1;}
 let uv=(world-gridParams.orthoMin)/(gridParams.orthoMax-gridParams.orthoMin);
 if(any(uv<vec3f(0.0))||any(uv>vec3f(1.0))){return -1;}
 let res=vec3f(gridParams.orthoResolution);
 let top=uv*res;
 // A point on the far face is in the last cell, not past it.
 let topCell=min(vec3u(top),vec3u(gridParams.orthoResolution-vec3i(1)));
 let word=gridOrthoTop[vgLinearIndex(topCell,gridParams.orthoResolution)];
 if(!vgIsAllocated(word)){return -1;}
 if(gridParams.indirection!=0){
  let side=word&7u;
  let inDirection=fract(top)*f32(side);
  let inner=gridIndirection[vgBottomIndex(word)+vgMortonCell(fract(top),side)];
  if(!vgIsAllocated(inner)){return -1;}
  return i32(vgBottomIndex(inner)+vgMortonCell(fract(inDirection),inner&7u));
 }
 return i32(vgBottomIndex(word)+vgMortonCell(fract(top),word&7u));
}

fn vgEvalExtinctionOutOfFrustum(world:vec3f)->vec3f{
 let cell=vgOrthoCellAt(world);
 if(cell<0){return vec3f(0.0);}
 return vgColorOf(gridExtinction[u32(cell)]);
}

fn vgEvalExtinction(world:vec3f)->vec3f{
 var inFrustum=false;
 let inside=vgEvalExtinctionInFrustum(world,&inFrustum);
 if(inFrustum){return inside;}
 return vgEvalExtinctionOutOfFrustum(world);
}`,
)
