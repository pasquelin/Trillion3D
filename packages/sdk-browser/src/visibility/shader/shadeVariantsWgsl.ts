import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { COTANGENT_FRAME_WGSL } from '../../geometry/cluster/cotangentFrameWgsl.ts'
import { DIAGNOSTIC_VIEWS as V } from './shadeMode.ts'

/**
 * The pieces of the surface resolve's text that only some of its modules hold (`shadeWgsl.ts`): the
 * displaced class's, the voxel class's, and the frame of the tangents a page stores.
 */

/** What a displaced class's resolve adds to the text (`displaced`): its own module alone holds it
 *  (`shadePipelines.ts`), the classes that draw no displaced pixel compile the text they compiled
 *  before. A displaced row's pixel is placed on its displaced triangle (`solveDisplaced`,
 *  `../tessellation/prismWgsl.ts`): the weights of the surface position the depth gives, and their
 *  steps to the next pixel, which the texture derivatives and the normal's change read. */
export const DISPLACED_PIXEL = ` var solved=false;var stepX=vec3f(0.0);var stepY=vec3f(0.0);
 if(prism.tessellation!=0u&&tessellatedFlags(page)){
  let s=solveDisplaced(page,tri,pos.xy);
  if(s.ok){bary=s.value;stepX=s.dx;stepY=s.dy;solved=true;}
 }
`
export const DISPLACED_GRADIENTS = `  if(solved){ddx=t.uva*stepX.x+t.uvb*stepX.y+t.uvc*stepX.z;ddy=t.uva*stepY.x+t.uvb*stepY.y+t.uvc*stepY.z;}
`
export const DISPLACED_STEPS = `   if(solved){bx=bary+stepX;by=bary+stepY;}
`

/** What a voxel class's resolve adds to the text (`VOXEL`): its own module alone holds it, made
 *  the first time a voxel class is asked (`shadePipelines.ts`); every other class compiles the text
 *  it compiled before voxels. The voxel its pixel shows, its surface in the views and the lit
 *  image, its shadow receiver and its normal. */
export const VOXEL_PIXEL = ` // A voxel row's pixel shows the voxel its ray meets in the brick its box's triangle names, traced
 // again from the box's point as the raster traced it (\`voxelRay\`, \`voxelPixel\`): its surface,
 // its normal turned to the eye where the ray is, in the brick's cells, then carried by its joint.
 var voxel=0u;var voxelN=vec3f(0.0);var voxelV=vec3f(0.0);
 if(VOXEL){
  let base=page.pageOffset;let brick=voxelBrickOf(tri);
  let mask=voxelBrickMask(base,brick);let box=voxelMaskBox(mask);
  let k=pageTriangle(page,pageHeaderFor(page,false),tri);
  let o=voxelBoxPoint(box,k.x)*bary.x+voxelBoxPoint(box,k.y)*bary.y+voxelBoxPoint(box,k.z)*bary.z;
  let carry=voxelCarry(page,brick);
  let ray=voxelRay(mask,box,o,uni.viewProj*page.world*carry*voxelCells(page,brick));
  let hit=voxelPixel(ray.start,ray.dir,ray.cells);
  // A ray the raster met a voxel on and this one grazes past reads the brick's first voxel.
  voxel=voxelRank(base,brick,select(0u,hit.bit,hit.found));
  let n=voxelNormal(base,voxel);
  voxelN=unitOrZero(worldMatrix3(page.world)*cofactor3(carry[0].xyz,carry[1].xyz,carry[2].xyz)*select(n,-n,dot(n,ray.dir)>0.0));
  // The eye seen from the point the ray met, in the world: what the voxel's normals are drawn for.
  let met=page.world*carry*voxelCells(page,brick)*vec4f(select(o,hit.point,hit.found),1.0);
  voxelV=unitOrZero(uni.eye-met.xyz);
  // The trace's cost, on a sampled frame, one pixel in 64 (\`voxelStepsTally\`).
  if(uni.voxelCounting!=0u){voxelStepsTally(pos.xy,hit.steps);}
 }
`
export const VOXEL_DIAGNOSTIC = `  if(VOXEL&&(uni.mode==${V.lod.code}u||uni.mode==${V.hlod.code}u)){base=voxelSurface(page.pageOffset,voxel).rgb;}
`
export const VOXEL_SURFACE = ` // A voxel wears its own prefiltered surface; its normals' spread is its drawn normal's (\`voxelSampledNormal\`).
 if(VOXEL){
  let v=voxelSurface(page.pageOffset,voxel);
  rgb=v.rgb;metal=v.metal;ao=v.ao;emissive=vec3f(0.0);rough=v.rough;
 }
`
export const VOXEL_RECEIVER = `   // A voxel's receiver is its hit, which the depth already places, and its own normal: no
   // offset from its box's corners.
   rcvOffset=select(receiver.offset,vec3f(0.0),VOXEL);
   rcvPlane=select(receiver.plane,voxelN,VOXEL);
`
export const PLAIN_RECEIVER = `   rcvOffset=receiver.offset;
   rcvPlane=receiver.plane;
`
export const VOXEL_NORMAL = `  if(VOXEL){N=voxelSampledNormal(voxelN,voxelRatio(page.pageOffset,voxel),voxelV,vec2i(pos.xy),uni.frameIndex);Nx=N;Ny=N;}
`

/** The frame of the tangents a page stores (`pageTangent`) at the weights `bary` of triangle `tri`:
 *  each corner's tangent turned to the world (`world3`) and to the row's `side`, its bitangent the
 *  corner normal's cross with it by its sign, both blended. The one tangent source of a pixel whose
 *  page stores tangents: its normal map and its lobes bend in it (`physicalValues`). */
export const STORED_TANGENT_FRAME_WGSL = wgslBlock(
  'STORED_TANGENT_FRAME_WGSL',
  [COTANGENT_FRAME_WGSL],
  `fn storedTangentFrame(page:PageInfo,tri:u32,bary:vec3f,n0:vec3f,n1:vec3f,n2:vec3f,world3:mat3x3f,side:f32)->CotangentFrame{
 let h=pageHeader(page);let k=pageTriangle(page,h,tri);
 let ta=pageTangent(page,h,k.x);let tb=pageTangent(page,h,k.y);let tc=pageTangent(page,h,k.z);
 let t0=normalize(world3*ta.xyz)*side;let t1=normalize(world3*tb.xyz)*side;let t2=normalize(world3*tc.xyz)*side;
 let T=normalize(t0*bary.x+t1*bary.y+t2*bary.z);
 let B=normalize(normalize(cross(n0,t0)*ta.w)*bary.x+normalize(cross(n1,t1)*tb.w)*bary.y+normalize(cross(n2,t2)*tc.w)*bary.z);
 return CotangentFrame(T,B);
}`,
)
