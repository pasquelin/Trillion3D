import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { TV_FRAME_WGSL, TV_TEXEL_WGSL } from './frameWgsl.ts'
import {
  MARKED_WORKGROUP,
  MARK_FORMAT,
  MOST_GROUPS_PER_AXIS,
  TRANSLUCENCY_WORKGROUP,
  VOLUME_FORMAT,
  WRAPPED_GROUP_STRIDE,
} from './layout.ts'

/**
 * THE VOLUME'S MARKED CELLS (`translucencyVolumeMarkVoxels`): the see-through surfaces that read the volume mark the cells they will read
 * (`translucencyVolumeMarkWgsl`, in the fragment stage of a pass that draws them once more before the volume is made), and the volume is
 * lit and filtered over those cells alone. The passes, in this order, each one thread a cell of either cascade (the cascades stacked along
 * the depth, `markExtent`) but the last:
 *
 * `clearMain`, before the surfaces mark: the marks of this image, the dilation that follows them and the light the injection writes are
 * emptied — the injection writes the marked cells alone, and the blur reads their neighbours, which must hold nothing — and the count of
 * the list is set to zero.
 *
 * `dilateMain`: every marked cell marks itself and the eight cells at the corners of the cube round it (within its cascade), into the
 * dilated marks. The cells are marked 255, whoever marks them.
 *
 * `gatherMain`: every cell the dilated marks hold is added to the list, at the place the count gives it (an atomic add): its position in
 * the stacked marks, `x + dim · (y + dim · z)`.
 *
 * `argsMain`, one thread: the groups of the injection over that list (`MARKED_WORKGROUP` cells a group) as the arguments of an indirect
 * dispatch, wrapped along the second axis where the first would pass the limit of an axis (`WRAPPED_GROUP_STRIDE` groups a row): the
 * injection returns at once from a group past the count.
 */

/** Where the clearing binds what it reads and writes, in group 0: the frame, the marks, the dilated marks, the light the injection writes and the count. */
export const CLEAR_BINDING = { frame: 0, marks: 1, dilated: 2, injected: 3, count: 4 } as const
/** Where the dilation binds, in group 0: the frame, the marks it reads and the dilated marks it writes. */
export const DILATE_BINDING = { frame: 0, marks: 1, dilated: 2 } as const
/** Where the gathering binds, in group 0: the frame, the dilated marks it reads, the count and the list it fills. */
export const GATHER_BINDING = { frame: 0, dilated: 1, count: 2, list: 3 } as const
/** Where the arguments' kernel binds, in group 0: the count it reads and the arguments it writes. */
export const ARGS_BINDING = { count: 0, args: 1 } as const

const WORKGROUP = `@compute @workgroup_size(${TRANSLUCENCY_WORKGROUP},${TRANSLUCENCY_WORKGROUP},${TRANSLUCENCY_WORKGROUP})`

/** The frame every pass of the marks reads: the cells a side and the cascades' boxes. */
const FRAME_DECLARATION = (binding: number) =>
  `@group(0) @binding(${binding}) var<uniform> tv:TranslucencyFrame;`

/** The program of the clearing (`clearMain`). */
export const CLEAR_PROGRAM = wgslProgram(
  `${FRAME_DECLARATION(CLEAR_BINDING.frame)}
@group(0) @binding(${CLEAR_BINDING.marks}) var tvMarks:texture_storage_3d<${MARK_FORMAT},write>;
@group(0) @binding(${CLEAR_BINDING.dilated}) var tvDilated:texture_storage_3d<${MARK_FORMAT},write>;
@group(0) @binding(${CLEAR_BINDING.injected}) var tvInjected:texture_storage_3d<${VOLUME_FORMAT},write>;
@group(0) @binding(${CLEAR_BINDING.count}) var<storage,read_write> tvCount:array<u32>;
`,
  [
    wgslBlock(
      'CLEAR_WGSL',
      [TV_FRAME_WGSL, TV_TEXEL_WGSL],
      `${WORKGROUP}
fn clearMain(@builtin(global_invocation_id) id:vec3u){
 let dim=tv.mode.x;
 if(id.x>=dim||id.y>=dim||id.z>=dim*2u){return;}
 let cascade=id.z/dim;
 let slice=id.z%dim;
 textureStore(tvMarks,id,vec4u(0u));
 textureStore(tvDilated,id,vec4u(0u));
 textureStore(tvInjected,vec3u(id.xy,slice+tvSlab(cascade,0u)*dim),vec4f(0.0));
 textureStore(tvInjected,vec3u(id.xy,slice+tvSlab(cascade,1u)*dim),vec4f(0.0));
 if(id.x==0u&&id.y==0u&&id.z==0u){tvCount[0]=0u;}
}`,
    ),
  ],
)

/** The program of the dilation (`dilateMain`). */
export const DILATE_PROGRAM = wgslProgram(
  `${FRAME_DECLARATION(DILATE_BINDING.frame)}
@group(0) @binding(${DILATE_BINDING.marks}) var tvMarks:texture_3d<u32>;
@group(0) @binding(${DILATE_BINDING.dilated}) var tvDilated:texture_storage_3d<${MARK_FORMAT},write>;
`,
  [
    wgslBlock(
      'DILATE_WGSL',
      [TV_FRAME_WGSL],
      `/** The cell \`c\` of cascade \`cascade\` marked 255 in the dilated marks, where it lies in the cascade. */
fn dilateMark(cascade:u32,c:vec3i){
 let dim=i32(tv.mode.x);
 if(all(c>=vec3i(0))&&all(c<vec3i(dim))){
  textureStore(tvDilated,vec3u(u32(c.x),u32(c.y),u32(c.z+i32(cascade)*dim)),vec4u(255u,0u,0u,0u));
 }
}
${WORKGROUP}
fn dilateMain(@builtin(global_invocation_id) id:vec3u){
 let dim=tv.mode.x;
 if(id.x>=dim||id.y>=dim||id.z>=dim*2u){return;}
 if(textureLoad(tvMarks,id,0).x==0u){return;}
 let cascade=id.z/dim;
 let c=vec3i(i32(id.x),i32(id.y),i32(id.z%dim));
 dilateMark(cascade,c);
 for(var i=0u;i<8u;i++){
  let corner=vec3i(select(-1,1,(i&1u)!=0u),select(-1,1,(i&2u)!=0u),select(-1,1,(i&4u)!=0u));
  dilateMark(cascade,c+corner);
 }
}`,
    ),
  ],
)

/** The program of the gathering (`gatherMain`). */
export const GATHER_PROGRAM = wgslProgram(
  `${FRAME_DECLARATION(GATHER_BINDING.frame)}
@group(0) @binding(${GATHER_BINDING.dilated}) var tvDilated:texture_3d<u32>;
@group(0) @binding(${GATHER_BINDING.count}) var<storage,read_write> tvCount:array<atomic<u32>>;
@group(0) @binding(${GATHER_BINDING.list}) var<storage,read_write> tvList:array<u32>;
`,
  [
    wgslBlock(
      'GATHER_WGSL',
      [TV_FRAME_WGSL],
      `${WORKGROUP}
fn gatherMain(@builtin(global_invocation_id) id:vec3u){
 let dim=tv.mode.x;
 if(id.x>=dim||id.y>=dim||id.z>=dim*2u){return;}
 if(textureLoad(tvDilated,id,0).x==0u){return;}
 let at=atomicAdd(&tvCount[0],1u);
 tvList[at]=id.x+dim*(id.y+dim*id.z);
}`,
    ),
  ],
)

/** The program of the arguments' kernel (`argsMain`). */
export const ARGS_PROGRAM = wgslProgram(
  `@group(0) @binding(${ARGS_BINDING.count}) var<storage,read> tvCount:array<u32>;
@group(0) @binding(${ARGS_BINDING.args}) var<storage,read_write> tvArgs:array<u32>;
`,
  [
    wgslBlock(
      'ARGS_WGSL',
      [],
      `@compute @workgroup_size(1)
fn argsMain(){
 var groups=vec3u((tvCount[0]+${MARKED_WORKGROUP - 1}u)/${MARKED_WORKGROUP}u,1u,1u);
 if(groups.x>${MOST_GROUPS_PER_AXIS}u){
  groups.y=(groups.x+${WRAPPED_GROUP_STRIDE - 1}u)/${WRAPPED_GROUP_STRIDE}u;
  groups.x=${WRAPPED_GROUP_STRIDE}u;
 }
 tvArgs[0]=groups.x;
 tvArgs[1]=groups.y;
 tvArgs[2]=groups.z;
}`,
    ),
  ],
)

/**
 * THE SURFACES' MARK OF THE VOLUME (`markVolumeVoxels`), for the fragment stage of the pass that draws the surfaces that read the volume
 * before it is made: the frame (`frame`, binding in `group`: the cascades' boxes this image placed and the cells a side) and the marks
 * (`marks`, a write-only storage texture of `MARK_FORMAT`, the cascades stacked). A fragment at the world point `P` reads the volume as a
 * surface does — the point's place in each cascade, the inner one counting where the point lies well inside it, none of the outer one
 * where the inner counts whole, no noise on the point — and marks the eight cells whose centres lie round that place in each cascade it reads
 * (the cells a trilinear fetch takes), those that lie in the cascade, with 255.
 */
export const translucencyVolumeMarkWgsl = (group: number, frame: number, marks: number) =>
  wgslBlock(
    `translucencyVolumeMarkWgsl(${group},${frame},${marks})`,
    [TV_FRAME_WGSL],
    `@group(${group}) @binding(${frame}) var<uniform> tv:TranslucencyFrame;
@group(${group}) @binding(${marks}) var tvMarks:texture_storage_3d<${MARK_FORMAT},write>;
/** The cell \`c\` of cascade \`cascade\` marked, where it lies in the cascade. */
fn markVolumeCell(cascade:u32,c:vec3i){
 let dim=i32(tv.mode.x);
 if(all(c>=vec3i(0))&&all(c<vec3i(dim))){
  textureStore(tvMarks,vec3u(u32(c.x),u32(c.y),u32(c.z+i32(cascade)*dim)),vec4u(255u,0u,0u,0u));
 }
}
/** The eight cells a trilinear fetch at the place \`uvw\` of the box of cascade \`cascade\` takes, marked. */
fn markVolumeTrilinear(cascade:u32,uvw:vec3f){
 let base=vec3i(floor(uvw*f32(tv.mode.x)-vec3f(0.5)));
 for(var i=0u;i<8u;i++){
  markVolumeCell(cascade,base+vec3i(i32(i&1u),i32((i>>1u)&1u),i32((i>>2u)&1u)));
 }
}
/** The cells a surface at the world point \`P\` reads in the volume, marked. */
fn markVolumeVoxels(P:vec3f){
 let inner=(P-tv.corner[0].xyz)*tv.scale[0].xyz;
 let outer=(P-tv.corner[1].xyz)*tv.scale[1].xyz;
 let ramp=saturate((vec3f(0.5)-abs(inner-vec3f(0.5)))*6.0);
 let share=ramp.x*ramp.y*ramp.z;
 if(share>0.0){markVolumeTrilinear(0u,inner);}
 if(share<1.0){markVolumeTrilinear(1u,outer);}
}`,
  )
