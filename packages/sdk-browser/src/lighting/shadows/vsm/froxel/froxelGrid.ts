/**
 * THE FROXEL GRID OF A VIEW, as the page marking reads the depth by it (the reference's froxel
 * renderer): the screen cut into tiles of `FROXEL_TILE_SIZE` pixels and the depth into slices as deep as
 * they are wide at their near end — a perspective view's grow by a constant factor, an orthographic
 * view's by a constant step —, a froxel being a tile and a slice. The depth fills the froxels that
 * hold a visible surface (`froxelBuildWgsl.ts`); a froxel is a box in the view's space, small enough
 * to bound the pixels it stands for (`froxelMarkWgsl.ts`).
 *
 * `VsmFroxelGrid` holds the grid's constants and the view's: its view-to-shifted matrix, its depth
 * words, its rect, and the room the list of froxels has.
 */
import { fieldLayout } from '../../../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { wordViews } from '../../../../gpu/core/wordViews.ts'
import { vsmWriteDepthFromDeviceZ } from '../constants.ts'

/** Pixels a side of a froxel's tile. */
export const FROXEL_TILE_SIZE = 8
/** The slice of a depth the grid has none for (the infinitely far): no froxel. */
const FROXEL_INVALID_SLICE = 1 << 28
/** Words before the froxels of the list: the count, the count held to the room, and two of padding. */
export const FROXEL_LIST_HEADER_WORDS = 4
/** Bytes of a list of `capacity` froxels. */
export const froxelListBytes = (capacity: number) => 4 * (FROXEL_LIST_HEADER_WORDS + 2 * capacity)
/** Threads a group of the marking walks the froxels by. */
export const FROXEL_MARK_GROUP = 64

/** The grid's uniform. */
const GRID = fieldLayout('VsmFroxelGrid', [
  ['viewToShifted', 'mat4x4f'],
  ['toViewScaleBias', 'vec4f'],
  ['depthFromDeviceZ', 'vec4f'],
  ['near', 'f32'],
  ['depthScale1', 'f32'],
  ['recNear', 'f32'],
  ['recLog2DepthScale1', 'f32'],
  ['radius', 'f32'],
  ['invRadius', 'f32'],
  ['isOrtho', 'u32'],
  ['capacity', 'u32'],
  ['viewRectMin', 'vec2u'],
  ['viewSize', 'vec2u'],
] as const)
export const VSM_FROXEL_GRID_BYTES = 4 * GRID.words

/** What the grid is made from: the view's +z-forward view-to-clip (column-major, `vsmForwardZViewToClip`),
 *  its size and rect, the matrix that takes its space to the shifted one, and the room the list has. */
export interface FroxelGridInputs {
  viewToClip: ArrayLike<number>
  perspective: boolean
  viewRectMin: readonly [number, number]
  viewSize: readonly [number, number]
  viewToShifted: ArrayLike<number>
  capacity: number
}

/** Writes the grid into `out` (`VSM_FROXEL_GRID_BYTES`): the reference's constants — a froxel a tile
 *  of the view's depth, as wide as it is deep (`radius`, the narrower of the tile's two spans in
 *  the view's space at unit depth), the near plane read off the projection. */
export function writeFroxelGrid(out: ArrayBuffer, input: FroxelGridInputs) {
  const { f, u } = wordViews(out),
    m = input.viewToClip,
    at = GRID.at
  const [width, height] = input.viewSize
  const absClip = [(FROXEL_TILE_SIZE * 2) / width, (FROXEL_TILE_SIZE * 2) / height]
  const radiusXY = [absClip[0]! / m[0]!, absClip[1]! / m[5]!]
  const radius = Math.min(radiusXY[0]!, radiusXY[1]!)
  // The near plane: where the projection takes a view depth to the device depth 1.
  const near = (m[15]! - m[14]!) / (m[10]! - m[11]!)
  const depthScale = m[11]! * radius
  for (let k = 0; k < 16; k++) f[at.viewToShifted + k] = input.viewToShifted[k]!
  f[at.toViewScaleBias] = absClip[0]! / m[0]!
  f[at.toViewScaleBias + 1] = -absClip[1]! / m[5]!
  f[at.toViewScaleBias + 2] = -1 / m[0]!
  f[at.toViewScaleBias + 3] = 1 / m[5]!
  vsmWriteDepthFromDeviceZ(f, at.depthFromDeviceZ, m, input.perspective)
  f[at.near] = near
  f[at.depthScale1] = 1 + depthScale
  f[at.recNear] = 1 / near
  f[at.recLog2DepthScale1] = 1 / Math.log2(1 + depthScale)
  f[at.radius] = radius
  f[at.invRadius] = 1 / radius
  u[at.isOrtho] = input.perspective ? 0 : 1
  u[at.capacity] = input.capacity
  u[at.viewRectMin] = input.viewRectMin[0]
  u[at.viewRectMin + 1] = input.viewRectMin[1]
  u[at.viewSize] = width
  u[at.viewSize + 1] = height
}

/**
 * The grid in WGSL, over a host that binds `froxelGrid:VsmFroxelGrid` (uniform):
 * - `vsmFroxelSlice(depth)`: the slice a view depth falls in, past the near plane's —
 *   floor(log2(depth / near) / log2(1 + radius)) for a perspective view, the steps of `radius`
 *   from `near` for an orthographic one;
 * - `vsmFroxelDepth(slice)`: the view depth a slice starts at;
 * - `vsmFroxelCentre(froxel)` and `vsmFroxelBounds(froxel)`: its centre and its box in the view's space;
 * - `vsmFroxelDeviceZ(depth)`: the device depth of a view depth (the light grid's cells are cut by it).
 */
export const VSM_FROXEL_GRID_WGSL = wgslBlock(
  'VSM_FROXEL_GRID_WGSL',
  [],
  `
${GRID.wgsl}
struct VsmFroxel{xy:u32,z:i32,}
struct VsmFroxelBox{lo:vec3f,hi:vec3f,}
const FROXEL_INVALID_SLICE:i32=${FROXEL_INVALID_SLICE};
fn vsmFroxelPack(xy:vec2u,z:i32)->VsmFroxel{return VsmFroxel(xy.x|(xy.y<<16u),z);}
fn vsmFroxelTile(f:VsmFroxel)->vec2u{return vec2u(f.xy&0xFFFFu,f.xy>>16u);}
fn vsmFroxelSlice(depth:f32)->i32{
 if(froxelGrid.isOrtho!=0u){return i32(floor((depth-froxelGrid.near)*froxelGrid.invRadius));}
 return i32(floor(log2(depth*froxelGrid.recNear)*froxelGrid.recLog2DepthScale1));
}
fn vsmFroxelDepth(slice:f32)->f32{
 if(froxelGrid.isOrtho!=0u){return slice*froxelGrid.radius+froxelGrid.near;}
 return froxelGrid.near*pow(froxelGrid.depthScale1,slice);
}
fn vsmFroxelCentre(f:VsmFroxel)->vec3f{
 let z=vsmFroxelDepth(f32(f.z)+0.5);
 let xy=(vec2f(vsmFroxelTile(f))+0.5)*froxelGrid.toViewScaleBias.xy+froxelGrid.toViewScaleBias.zw;
 if(froxelGrid.isOrtho!=0u){return vec3f(xy,z);}
 return vec3f(xy*z,z);
}
fn vsmFroxelBounds(f:VsmFroxel)->VsmFroxelBox{
 var lo=vec2f(vsmFroxelTile(f))*froxelGrid.toViewScaleBias.xy+froxelGrid.toViewScaleBias.zw;
 var hi=lo+froxelGrid.toViewScaleBias.xy;
 let near=vsmFroxelDepth(f32(f.z));
 var r:VsmFroxelBox;
 if(froxelGrid.isOrtho!=0u){
  r.lo=vec3f(lo,near);
  r.hi=vec3f(hi,near+froxelGrid.radius);
  return r;
 }
 // The extreme corners: the tile's span farthest from the axis, at the near and at the far end.
 if(abs(lo.x)>abs(hi.x)){let t=lo.x;lo.x=hi.x;hi.x=t;}
 if(abs(lo.y)>abs(hi.y)){let t=lo.y;lo.y=hi.y;hi.y=t;}
 let far=near*froxelGrid.depthScale1;
 let atNear=lo*near;
 let atFar=hi*far;
 r.lo=vec3f(min(atNear,atFar),near);
 r.hi=vec3f(max(atNear,atFar),far);
 return r;
}
/** The view depth of a device depth (reverse-Z), from the grid's words (\`vsmWriteDepthFromDeviceZ\`). */
fn vsmFroxelViewDepth(deviceZ:f32)->f32{
 let t=froxelGrid.depthFromDeviceZ;
 return deviceZ*t.x+t.y+1.0/(deviceZ*t.z-t.w);
}
fn vsmFroxelDeviceZ(depth:f32)->f32{
 let t=froxelGrid.depthFromDeviceZ;
 if(froxelGrid.isOrtho!=0u){return (depth-t.y+1.0)/t.x;}
 return (1.0/depth+t.w)/t.z;
}
`,
)
