import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  logSliceOfDepth,
  ndcToUv,
  unprojectPoint,
  uvToNdc,
} from '../../../../math/src/wgsl/projection.ts'
import { VOLUME_FADE_START } from '../../../../sdk-core/src/contracts/volumeMaterial.ts'
import { WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { FOG_VOLUME_FLAG } from './frame.ts'
import { FOG_CELLS_WGSL } from './gridWgsl.ts'
import { FOG_VOXEL_FRAME, FOG_VOXEL_OBJECT, FOG_VOXEL_SPAN } from './voxelLayout.ts'
import { voxelGraphWgsl, type VoxelGraphSet } from './voxelGraph.ts'

/** The structures of the voxelisation, written once for the programs that read them. */
export const FOG_VOXEL_STRUCTS_WGSL = wgslBlock(
  'FOG_VOXEL_STRUCTS_WGSL',
  [],
  `${FOG_VOXEL_OBJECT.wgsl}\n${FOG_VOXEL_SPAN.wgsl}\n${FOG_VOXEL_FRAME.wgsl}`,
)

/**
 * THE SLICES AN OBJECT REACHES (`prepareMain`), one thread an object: the sphere around its box in
 * view space — its centre's view depth and the radius —, the rectangle its box covers in view space
 * (the eight corners' extent across the view), and the slices of the sphere's nearest and farthest
 * depth, `trunc(log2(depth · B + O) · S)`: the first held at 0, the last at the grid's, and whether
 * the object reaches any (`slices.z`): its first slice is before the grid's end and not past its
 * last, and the last is not before the grid. A depth where the logarithm has no value, behind the
 * grid's near end, counts as the slice 0.
 */
export const FOG_VOXEL_PREPARE_WGSL = wgslBlock(
  'FOG_VOXEL_PREPARE_WGSL',
  [FOG_VOXEL_STRUCTS_WGSL, WORKGROUP_THREADS_WGSL, logSliceOfDepth],
  `
fn voxelSliceOf(depth:f32)->i32{
 let x=depth*frame.sliceMap.x+frame.sliceMap.y;
 if(x<=0.0){return 0;}
 return i32(logSliceOfDepth(depth,frame.sliceMap.xyz));
}
/** The view-space coordinates across the view of a point relative to the eye. */
fn voxelViewAcross(p:vec3f)->vec2f{return vec2f(dot(p,voxelFrame.right.xyz),dot(p,voxelFrame.up.xyz));}
@compute @workgroup_size(WORKGROUP_THREADS)
fn prepareMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=voxelFrame.count.x){return;}
 let object=voxelObjects[id.x];
 let radius=object.sphere.w;
 let origin=vec3f(voxelViewAcross(object.sphere.xyz),dot(object.sphere.xyz,frame.forward.xyz));
 var low=vec2f(10000000.0);
 var high=vec2f(-10000000.0);
 for(var corner=0;corner<8;corner++){
  let mask=vec3f(f32(corner&1),f32((corner>>1)&1),f32((corner>>2)&1));
  let local=object.boundsMin.xyz+(object.boundsMax.xyz-object.boundsMin.xyz)*mask;
  let across=voxelViewAcross((object.toWorld*vec4f(local,1.0)).xyz);
  low=min(low,across);
  high=max(high,across);
 }
 let gridZ=i32(frame.grid.z);
 let farthest=voxelSliceOf(origin.z+radius);
 let nearest=voxelSliceOf(origin.z-radius);
 let first=max(nearest,0);
 let last=min(farthest,gridZ-1);
 let reaches=nearest<gridZ&&first<=farthest&&farthest>=0;
 voxelSpans[id.x]=FogVoxelSpan(vec4f(origin,radius),vec4f(low,high),vec4i(first,last,select(0,1,reaches),0));
}`,
)

/** The cells a graph's footprint is found at: the cell's centre a cell to the right and a cell below,
 *  in the world relative to the eye. */
const NEIGHBOUR_CELLS = ` let right=depth*voxelRay(uvToNdc((centre+vec2f(1.0,0.0))*frame.grid.w*frame.view.zw));
 let below=depth*voxelRay(uvToNdc((centre+vec2f(0.0,1.0))*frame.grid.w*frame.view.zw));
`

/** An object that wears a graph adds what the graph gives the cell (\`fogGraphAt\`), which a cell the
 *  object's mask or the fade leaves nothing of (\`scale\` zero) never evaluates; a graph that is none
 *  of the image's set (its program's place zero) adds its material's. */
const GRAPH_BRANCH = `  if(object.graph.x!=0u){
   if(scale==0.0){continue;}
   let made=fogGraphAt(object,position,right,below);
   scattering+=vec4f(made.albedo*made.extinction,made.extinction)*scale;
   emitted+=made.emissive*scale;
   continue;
  }
`

/** The ray of a cell, the quad an object covers on a slice, and the mask of its shape. */
const VOXEL_HELPERS_TEXT = `
const VOXEL_FADE_START:f32=${VOLUME_FADE_START.toFixed(6)};
/** The ray through the device point \`ndc\` seen with the matrix the depth was drawn with, its forward
 *  component 1. */
fn voxelRay(ndc:vec2f)->vec3f{
 let along=unprojectPoint(voxelFrame.inverseDepthViewProj,vec3f(ndc,1.0))-frame.eye.xyz;
 return along/dot(along,frame.forward.xyz);
}
/** The place, in cells across and down, of the point \`across\` in the view at \`depth\`, shifted by the
 *  first offsets across. */
fn voxelCellsOf(across:vec2f,depth:f32)->vec2f{
 let world=frame.eye.xyz+across.x*voxelFrame.right.xyz+across.y*voxelFrame.up.xyz+depth*frame.forward.xyz;
 let clip=frame.viewProj*vec4f(world,1.0);
 let ndc=clip.xy/clip.w+frame.offsets[0].xy/frame.grid.xy;
 return ndcToUv(ndc)*frame.view.xy/frame.grid.w;
}
/** The rectangle of cells (low, high) the object's quad covers on the slice at \`depth\`, cut \`reach\` wide
 *  where the object is a sphere. */
fn voxelQuad(object:FogVoxelObject,span:FogVoxelSpan,depth:f32,reach:f32)->vec4f{
 var low=span.rect.xy;
 var high=span.rect.zw;
 if(object.boundsMin.w==0.0){low=span.origin.xy-reach;high=span.origin.xy+reach;}
 let a=voxelCellsOf(low,depth);
 let b=voxelCellsOf(vec2f(high.x,low.y),depth);
 let c=voxelCellsOf(vec2f(low.x,high.y),depth);
 let d=voxelCellsOf(high,depth);
 return vec4f(min(min(a,b),min(c,d)),max(max(a,b),max(c,d)));
}
/** 1 where \`position\` (relative to the eye) lies in the object's sphere or box, else 0. */
fn voxelMask(object:FogVoxelObject,position:vec3f)->f32{
 if(object.boundsMin.w==0.0){
  let to=object.sphere.xyz-position;
  return select(1.0,0.0,dot(to,to)>object.sphere.w*object.sphere.w);
 }
 let local=(object.toLocal*vec4f(position,1.0)).xyz;
 return select(1.0,0.0,any(local<object.boundsMin.xyz)||any(local>object.boundsMax.xyz));
}`

/** The voxelisation's entry; `graphs` adds the neighbour cells and the graph branch. */
const voxelizeMainText = (graphs?: VoxelGraphSet) => `@compute @workgroup_size(4,4,4)
fn voxelizeMain(@builtin(global_invocation_id) cell:vec3u){
 if(any(cell>=vec3u(frame.grid.xyz))){return;}
 let slice=i32(cell.z);
 let depth=fogDepthAtSlice(f32(cell.z)+frame.offsets[0].z);
 let centre=vec2f(cell.xy)+0.5;
 let position=depth*voxelRay(uvToNdc(centre*frame.grid.w*frame.view.zw));
 let fade=1.0-saturate((depth/voxelFrame.passes.z-VOXEL_FADE_START)/(1.0-VOXEL_FADE_START));
 let weight=fade*fade*fade;
 let passSlices=max(i32(voxelFrame.passes.x),1);
 let only=i32(voxelFrame.passes.y);
 var scattering=vec4f(0.0);
 var emitted=vec3f(0.0);
${graphs ? NEIGHBOUR_CELLS : ''} for(var i=0u;i<voxelFrame.count.x;i++){
  let span=voxelSpans[i];
  if(span.slices.z==0||slice<span.slices.x||slice>span.slices.y){continue;}
  if(only>=0&&(slice-span.slices.x)/passSlices!=only){continue;}
  let object=voxelObjects[i];
  let radius=span.origin.w;
  let apart=abs(depth-span.origin.z);
  if(radius!=0.0&&apart>radius){continue;}
  let quad=voxelQuad(object,span,depth,sqrt(max(radius*radius-apart*apart,0.0)));
  if(any(centre<quad.xy)||any(centre>=quad.zw)){continue;}
  let scale=weight*voxelMask(object,position);
${graphs ? GRAPH_BRANCH : ''}  scattering+=vec4f(object.albedo.rgb*object.albedo.w,object.albedo.w)*scale;
  emitted+=object.emissive.rgb*scale;
 }
 if((u32(frame.medium.w)&${FOG_VOLUME_FLAG.glow}u)==0u){emitted=vec3f(0.0);}
 textureStore(fogVoxelOut,vec3i(cell),scattering);
 textureStore(fogVoxelEmitOut,vec3i(cell),vec4f(emitted,0.0));
}`

/**
 * THE OBJECTS IN THE VOLUME (\`voxelizeMain\`), one thread a cell: what each object that covers the
 * cell adds to the medium, summed — the scattering with the extinction beside, and the emissive
 * light. It is the rasterisation of each object's camera-facing quad on each slice it reaches, seen
 * from the cell: the quad of a slice lies at the slice's view depth (the slice plus the frame's
 * first offset in depth), over the view-space rectangle of the object's box, or over the square
 * around the circle the sphere cuts the slice at; it covers the cell whose centre falls in its
 * projection (the left and top edges in, the right and bottom out), the projection shifted by the
 * frame's first offsets across, as the quad's own was. A covered cell reads the object's material
 * at its centre's place on the slice — the point on the ray through it, read with the matrix the depth
 * was drawn with —, and counts it where that place lies in the object's sphere or box:
 * \`scale = unit · fade³\`, the fade 1 up to 0.6 of the fog's distance and 0 at it.
 */
export const fogVoxelWgsl = (graphs?: VoxelGraphSet) =>
  wgslBlock(
    graphs ? `FOG_VOXEL_WGSL(${graphs.key})` : 'FOG_VOXEL_WGSL',
    [
      FOG_VOXEL_STRUCTS_WGSL,
      FOG_CELLS_WGSL,
      ndcToUv,
      uvToNdc,
      unprojectPoint,
      ...(graphs ? [voxelGraphWgsl(graphs)] : []),
    ],
    `${VOXEL_HELPERS_TEXT}
${voxelizeMainText(graphs)}`,
  )

/** The voxelisation of objects that wear no graph. */
export const FOG_VOXEL_WGSL = fogVoxelWgsl()
