import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { VOXEL_BRICK_CORNERS } from '../../../../sdk-core/src/page/voxelPage.ts'
import { PAGE_POINTS_WGSL } from './pageGeometryWgsl.ts'
import { VOXEL_TRACE_WGSL } from './voxelWgsl.ts'

/**
 * A VOXEL ROW'S PIXEL, ONE SEQUENCE FOR EVERY PASS THAT TRACES ITS BRICKS — the camera's raster,
 * the shadow pages' and the resolve: the brick's cells drawn by a matrix (`voxelCells`,
 * `voxelCarry`), the ray a point of its box casts (`voxelRay`), the hit (`voxelCellTrace`) and its
 * depth (`voxelDepth`). Only the voxel variants of those passes include it.
 *
 * Everything a ray needs is affine in the box point it passes through: where it starts, its
 * direction, the clip depth and w at its start and their change along it. A raster's vertex stage
 * computes them at its box's corners and hands them on, the perspective-correct interpolation
 * giving each pixel its own exactly; its fragment runs the DDA and one division, and reads nothing
 * but its varyings — no matrix, no eye, no joint.
 *
 * A box is drawn by its back faces (`rowSide`): a perspective ray starts at the eye, an
 * orthographic one a box's diagonal before the point, so a ray from an eye inside the box, or from
 * a box across the near plane, starts where the eye is and the trace keeps from 0 on
 * (`rayBoxSpan`).
 */
export const VOXEL_HIT_WGSL = wgslBlock(
  'VOXEL_HIT_WGSL',
  [PAGE_POINTS_WGSL, VOXEL_TRACE_WGSL],
  `/** Brick \`brick\`'s cells at rest: its first cell at the origin, one voxel a unit. */
fn voxelCells(page:PageInfo,brick:u32)->mat4x4f{
 let base=page.pageOffset;let side=voxelSide(base);
 let first=voxelOrigin(base)+voxelBrickCell(base,brick)*side;
 return mat4x4f(side,0.0,0.0,0.0,0.0,side,0.0,0.0,0.0,0.0,side,0.0,first.x,first.y,first.z,1.0);
}
/** Where brick \`brick\`'s joint carries it, rigidly — its box's corner 0 at rest where the deformation
 *  put it, each of its three edges from there likewise —, the identity where its row does not
 *  deform. */
fn voxelCarry(page:PageInfo,brick:u32)->mat4x4f{
 if(page.deformOutput==0u){return mat4x4f(1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0);}
 let base=page.pageOffset;let v=brick*${VOXEL_BRICK_CORNERS}u;
 let p0=voxelBoxCorner(base,v);let span=voxelBoxCorner(base,v+7u)-p0;let q0=pageDeformed(page,v,0u);
 let l=mat3x3f((pageDeformed(page,v+1u,0u)-q0)/span.x,(pageDeformed(page,v+2u,0u)-q0)/span.y,(pageDeformed(page,v+4u,0u)-q0)/span.z);
 return mat4x4f(vec4f(l[0],0.0),vec4f(l[1],0.0),vec4f(l[2],0.0),vec4f(q0-l*p0,1.0));
}
/** The ray through box point \`o\` of a brick, in its cells, which \`m\` draws to clip space: where
 *  it starts and its direction, the clip depth and w at its start and their change along it
 *  (\`depth\`), and the brick's mask and packed box (\`cells\`). */
struct VoxelRay{start:vec3f,dir:vec3f,depth:vec4f,cells:vec3u,}
fn voxelRay(mask:vec2u,box:VoxelBox,o:vec3f,m:mat4x4f)->VoxelRay{
 let eye=voxelCellEye(m);
 var r:VoxelRay;
 r.dir=voxelCellRay(eye,o);
 r.start=select(o-r.dir*(8.0/length(r.dir)),eye.xyz,eye.w!=0.0);
 let z=vec4f(m[0].z,m[1].z,m[2].z,m[3].z);let w=vec4f(m[0].w,m[1].w,m[2].w,m[3].w);
 r.depth=vec4f(dot(z,vec4f(r.start,1.0)),dot(w,vec4f(r.start,1.0)),dot(z.xyz,r.dir),dot(w.xyz,r.dir));
 r.cells=vec3u(mask,voxelBoxBits(box));
 return r;
}
/** What a pixel's ray (\`voxelRay\`, interpolated) meets in its brick. */
fn voxelPixel(start:vec3f,dir:vec3f,cells:vec3u)->VoxelHit{return voxelCellTrace(start,dir,cells.xy,voxelBoxOf(cells.z));}
/** The clip depth of a hit at \`t\` along a ray of depth terms \`depth\` (\`voxelRay\`). */
fn voxelDepth(depth:vec4f,t:f32)->f32{return (depth.x+t*depth.z)/(depth.y+t*depth.w);}`,
)
