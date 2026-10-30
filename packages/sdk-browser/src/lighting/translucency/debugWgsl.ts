import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { gpuLineColor, gpuLineSink } from '../surfaceCache/sceneDebug/gpuLines.ts'
import { TV_FRAME_WGSL, TV_SH_WGSL, TV_TEXEL_WGSL } from './frameWgsl.ts'
import { TRANSLUCENCY_CASCADES, TRANSLUCENCY_WORKGROUP } from './layout.ts'

/** The planes of the camera's frustum the cells are counted against: the four sides and the near plane. */
export const DEBUG_CULL_PLANES = 5
/** The words of the counting's uniform: the planes, then the word that says whether the cells are marked, padded to a vector. */
export const DEBUG_CULL_WORDS = DEBUG_CULL_PLANES * 4 + 4
/** The words of the counts: the cells in view, then the cells marked, a word a cascade each. */
export const DEBUG_COUNT_WORDS = 2 * TRANSLUCENCY_CASCADES
/** The colour of a cascade's boxes, by the cascade's number: the inner one green, the outer one yellow. */
export const DEBUG_CASCADE_COLORS = [gpuLineColor(0, 1, 0), gpuLineColor(1, 1, 0)] as const

/** Where the counting binds: the frame, the camera's planes, the dilated marks and the counts. */
export const DEBUG_CULL_BINDING = { frame: 0, planes: 1, marks: 2, counts: 3 } as const
/** Where the boxes' kernel binds: the frame, the dilated marks, then the lines and their count (`gpuLineSink`). */
export const DEBUG_BOXES_BINDING = { frame: 0, marks: 1, lines: 2, count: 3 } as const
/** Where the spheres' draw binds: the frame, the viewer and the volume. */
export const DEBUG_VISUALIZE_BINDING = { frame: 0, viewer: 1, volume: 2 } as const

const WORKGROUP = `@compute @workgroup_size(${TRANSLUCENCY_WORKGROUP},${TRANSLUCENCY_WORKGROUP},${TRANSLUCENCY_WORKGROUP})`
/** The groups a dispatch over the cube takes along each axis of a 2D dispatch: `side` along the first, `side` squared along the second (the cube's depth slabs stacked). */
export const debugGroups = (dim: number) => {
  const side = ceilDiv(dim, TRANSLUCENCY_WORKGROUP)
  return [side, side * side] as const
}
/** The cell of a thread in a 2D dispatch of `debugGroups`. */
const CELL_OF = `vec3u(group.x*${TRANSLUCENCY_WORKGROUP}u+lane.x,(group.y%((dim+${TRANSLUCENCY_WORKGROUP - 1}u)/${TRANSLUCENCY_WORKGROUP}u))*${TRANSLUCENCY_WORKGROUP}u+lane.y,(group.y/((dim+${TRANSLUCENCY_WORKGROUP - 1}u)/${TRANSLUCENCY_WORKGROUP}u))*${TRANSLUCENCY_WORKGROUP}u+lane.z)`
/** The corner of the cube of side 2 whose bits (x, y, z) are those of `corner`, the cube's own coordinates. */
const TV_DEBUG_CORNER_WGSL = wgslBlock(
  'TV_DEBUG_CORNER_WGSL',
  [],
  `fn tvDebugCorner(corner:u32)->vec3f{return vec3f(vec3u(corner&1u,(corner>>1u)&1u,(corner>>2u)&1u))*2.0-vec3f(1.0);}`,
)
const FRAME = (binding: number) =>
  `@group(0) @binding(${binding}) var<uniform> tv:TranslucencyFrame;`

/**
 * THE CELLS COUNTED (`translucencyVolumeDebug`): a thread a cell of the cube, for both cascades, tests the cell's box against the five planes of
 * the camera's frustum — inward planes relative to the eye, the cell out when it lies wholly on their outer side — and adds one to the cascade's
 * count of cells in view; where the cells are marked (`cull.marked`), a cell the dilated marks hold adds one to its cascade's count of cells marked.
 *
 *   tv       uniform   the frame (`TRANSLUCENCY_FRAME`): the cube's cells a side, the cascades' boxes, the eye
 *   cull     uniform   the frustum's planes, relative to the eye, then whether the cells are marked
 *   marks    texture   the dilated marks, the two cascades' cells stacked along the depth (a one-cell stand-in, never read, where none are made)
 *   counts   storage   the cells in view of each cascade, then the cells marked of each
 */
export const TV_DEBUG_CULL_WGSL = wgslProgram(
  `${FRAME(DEBUG_CULL_BINDING.frame)}
struct CullPlanes{planes:array<vec4f,${DEBUG_CULL_PLANES}>,marked:u32,}
@group(0) @binding(${DEBUG_CULL_BINDING.planes}) var<uniform> cull:CullPlanes;
@group(0) @binding(${DEBUG_CULL_BINDING.marks}) var tvMarks:texture_3d<u32>;
@group(0) @binding(${DEBUG_CULL_BINDING.counts}) var<storage,read_write> counts:array<atomic<u32>,${DEBUG_COUNT_WORDS}>;
${WORKGROUP}
fn tvDebugCull(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){
 let dim=tv.mode.x;
 let id=${CELL_OF};
 if(any(id>=vec3u(dim))){return;}
 for(var c=0u;c<${TRANSLUCENCY_CASCADES}u;c++){
  let centre=tvCellPoint(c,vec3f(id))-tv.eye.xyz;
  let extent=vec3f(tv.scale[c].w*0.5);
  var inView=true;
  for(var k=0u;k<${DEBUG_CULL_PLANES}u;k++){
   let plane=cull.planes[k];
   inView=inView&&(-(dot(plane.xyz,centre)+plane.w)<=dot(extent,abs(plane.xyz)));
  }
  if(inView){atomicAdd(&counts[c],1u);}
  if(cull.marked!=0u){
   if(textureLoad(tvMarks,vec3u(id.x,id.y,id.z+c*dim),0).x>0u){atomicAdd(&counts[${TRANSLUCENCY_CASCADES}u+c],1u);}
  }
 }
}`,
  [TV_FRAME_WGSL],
)

/**
 * THE MARKED CELLS' BOXES (`translucencyVolumeDebug`): a thread a cell of the cube, for both cascades, appends the twelve edges of the cell's box
 * where the dilated marks hold it, green in the inner cascade and yellow in the outer one (`gpuLineSink`).
 */
export const TV_DEBUG_BOXES_WGSL = wgslProgram(
  `${FRAME(DEBUG_BOXES_BINDING.frame)}
@group(0) @binding(${DEBUG_BOXES_BINDING.marks}) var tvMarks:texture_3d<u32>;
const CASCADE_COLORS=array<u32,${TRANSLUCENCY_CASCADES}>(${DEBUG_CASCADE_COLORS.join(',')});
${WORKGROUP}
fn tvDebugBoxes(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){
 let dim=tv.mode.x;
 let id=${CELL_OF};
 if(any(id>=vec3u(dim))){return;}
 for(var c=0u;c<${TRANSLUCENCY_CASCADES}u;c++){
  if(textureLoad(tvMarks,vec3u(id.x,id.y,id.z+c*dim),0).x==0u){continue;}
  let centre=tvCellPoint(c,vec3f(id))-tv.eye.xyz;
  let extent=vec3f(tv.scale[c].w*0.5);
  for(var corner=0u;corner<8u;corner++){
   for(var axis=0u;axis<3u;axis++){
    let other=corner^(1u<<axis);
    if(other<corner){continue;}
    gpuLineWorld(centre+extent*tvDebugCorner(corner),centre+extent*tvDebugCorner(other),CASCADE_COLORS[c]);
   }
  }
 }
}`,
  [
    TV_FRAME_WGSL,
    TV_DEBUG_CORNER_WGSL,
    gpuLineSink(DEBUG_BOXES_BINDING.lines, DEBUG_BOXES_BINDING.count),
  ],
)

/** The vertices of the cube a sphere is drawn in: two triangles a face, the corners numbered by their bits (x, y, z). */
const CUBE_CORNERS = [
  0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 2, 3, 0, 3, 1, 4, 5, 7,
  4, 7, 6,
]
/** The vertices a cell's cube is drawn with. */
export const DEBUG_CUBE_VERTICES = CUBE_CORNERS.length

/**
 * THE SPHERES OF THE CELLS (`translucencyVolumeVisualize`): one instance a cell of the cascade `viewer.cascade`, a cube round the cell's centre of
 * the sphere's radius; the fragment stage casts the ray from the eye through the cube's point and keeps the pixels the ray meets the sphere at, lit
 * by the cell's light as a surface of the sphere's normal there would read it (`tvIrradiance`, the volume's units, which already hold the
 * pre-exposure). The pixel's depth is the cube's own, tested against and written to the scene's depth by the pass
 * (it runs 1 at the near plane to 0 at infinity), so the cubes hide each other and the opaque surfaces.
 *
 *   tv       uniform   the frame (`TRANSLUCENCY_FRAME`)
 *   viewer   uniform   the view-projection relative to the eye, the sphere's radius, the cascade and the cells a side
 *   volume   texture   the volume the surfaces read (the cascades' ambient and directional light stacked along the depth)
 */
export const TV_DEBUG_VISUALIZE_WGSL = wgslProgram(
  `${FRAME(DEBUG_VISUALIZE_BINDING.frame)}
struct Viewer{viewProj:mat4x4f,radius:f32,cascade:u32,dim:u32,}
@group(0) @binding(${DEBUG_VISUALIZE_BINDING.viewer}) var<uniform> viewer:Viewer;
@group(0) @binding(${DEBUG_VISUALIZE_BINDING.volume}) var volume:texture_3d<f32>;
const CUBE=array<u32,${DEBUG_CUBE_VERTICES}>(${CUBE_CORNERS.join('u,')}u);
struct Sphere{
 @builtin(position) position:vec4f,
 @location(0) @interpolate(flat) cell:vec3u,
 @location(1) @interpolate(flat) centre:vec3f,
 @location(2) spot:vec3f,
}
@vertex fn tvVisualizeVs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Sphere{
 let corner=CUBE[vertex];
 let offset=tvDebugCorner(corner);
 let cell=vec3u(instance%viewer.dim,(instance/viewer.dim)%viewer.dim,instance/(viewer.dim*viewer.dim));
 let centre=tvCellPoint(viewer.cascade,vec3f(cell))-tv.eye.xyz;
 var out:Sphere;
 out.spot=centre+offset*viewer.radius;
 out.cell=cell;
 out.centre=centre;
 out.position=viewer.viewProj*vec4f(out.spot,1.0);
 return out;
}
@fragment fn tvVisualizeFs(in:Sphere)->@location(0) vec4f{
 // The ray from the eye (the origin) through the cube's point against the sphere: the nearer root.
 let ray=in.spot;
 let a=dot(ray,ray);
 let b=-2.0*dot(ray,in.centre);
 let c=dot(in.centre,in.centre)-viewer.radius*viewer.radius;
 let discriminant=b*b-4.0*a*c;
 if(discriminant<0.0){discard;}
 let hit=(-b-sqrt(discriminant))/(2.0*a);
 if(hit<0.0){discard;}
 let normal=normalize(hit*ray-in.centre);
 let ambient=textureLoad(volume,vec3u(in.cell.xy,in.cell.z+tvSlab(viewer.cascade,0u)*viewer.dim),0);
 let directional=textureLoad(volume,vec3u(in.cell.xy,in.cell.z+tvSlab(viewer.cascade,1u)*viewer.dim),0).xyz;
 return vec4f(tvIrradiance(ambient.rgb,directional,normal,false),1.0);
}`,
  [TV_FRAME_WGSL, TV_TEXEL_WGSL, TV_SH_WGSL, TV_DEBUG_CORNER_WGSL],
)
