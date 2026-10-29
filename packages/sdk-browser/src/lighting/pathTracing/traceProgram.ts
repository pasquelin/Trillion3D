import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { PT_FINISH_BOUNCE_WGSL } from './finishWgsl.ts'
import { PT_LIGHT_TABLE_STRUCT } from './lightTable.ts'
import { PT_QUEUE_WGSL } from './queueWgsl.ts'
import { PT_TRACE_BOUNCE_WGSL } from './traceBounceWgsl.ts'

/** The bindings of the group 0 of the trace and of the finish of a bounce, past the cut's tables (`dagReadLayoutEntries`, at 1, 6, 7 and 9): the parameters, the paths' states and queue; for the finish,
 *  the lights with the energy table before them, the light grid and the sky's tables. */
export const PT_TRACE_BINDINGS = {
  view: 0,
  states: 2,
  queue: 3,
  variance: 13,
  lights: 4,
  gridParams: 5,
  grid: 8,
  gridData: 10,
  skyTexture: 11,
  skyPdf: 12,
} as const

const B = PT_TRACE_BINDINGS

/** The scene trace's group and its first binding in it, in the trace and the finish. */
export const PT_TRACE_SCENE = { group: 1, first: 0 } as const

/** The entries of the trace program: the camera's bounce over a tile and over the list of the pixels adaptive sampling still traces, and a bounce over the list of the paths the one before kept. */
export const PT_TRACE_ENTRIES = {
  cameraGrid: 'ptCameraGrid',
  cameraList: 'ptCameraList',
  inner: 'ptInner',
} as const

/** The entry of the finish of a bounce, over the list of the paths the trace of the bounce found a hit for. */
export const PT_FINISH_ENTRY = 'ptFinish'

const paths = `@group(0) @binding(${B.view}) var<uniform> ptView:PtView;
@group(0) @binding(${B.states}) var<storage,read_write> ptStates:array<PtState>;
@group(0) @binding(${B.queue}) var<storage,read_write> ptQueue:array<atomic<u32>>;`

const variance = `@group(0) @binding(${B.variance}) var ptVariance:texture_2d<f32>;`

const lights = `${PT_LIGHT_TABLE_STRUCT}
@group(0) @binding(${B.lights}) var<storage,read> directLights:PtLightTable;
@group(0) @binding(${B.gridParams}) var<uniform> ptGridParams:PtGridParams;
@group(0) @binding(${B.grid}) var ptLightGrid:texture_2d_array<u32>;
@group(0) @binding(${B.gridData}) var ptLightGridData:texture_2d<u32>;
@group(0) @binding(${B.skyTexture}) var ptSkyTexture:texture_2d<f32>;
@group(0) @binding(${B.skyPdf}) var ptSkyPdf:texture_2d<f32>;`

const queue = `fn ptPixelOf(index:u32)->vec2u{return ptView.tile.xy+vec2u(index%ptView.tile.z,index/ptView.tile.z);}`

const entries = `fn ptRunCamera(local:vec2u,push:bool){
 let index=local.x+local.y*ptView.tile.z;
 let pixel=ptView.tile.xy+local;
 // The samples the pixel has gathered, which adaptive sampling seeds its sequence with: the count the error chain holds for it.
 var path=ptCreatePath(pixel,select(0u,u32(textureLoad(ptVariance,vec2i(pixel),0).z),ptView.image.w>0u));
 ptTraceBounce(&path,0u,vec2i(pixel),index);
 ptStorePath(index,path);
 if(push){ptPush(0u,index);}
}
@compute @workgroup_size(8,8,1)
fn ${PT_TRACE_ENTRIES.cameraGrid}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=ptView.tile.zw)){return;}
 ptRunCamera(id.xy,true);
}
@compute @workgroup_size(64,1,1)
fn ${PT_TRACE_ENTRIES.cameraList}(@builtin(workgroup_id) wg:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let at=ptFlat(wg,n,lane);
 if(at>=atomicLoad(&ptQueue[ptCountAt(0u)])){return;}
 let index=atomicLoad(&ptQueue[ptListAt(0u)+at]);
 ptRunCamera(vec2u(index%ptView.tile.z,index/ptView.tile.z),false);
}
@compute @workgroup_size(64,1,1)
fn ${PT_TRACE_ENTRIES.inner}(@builtin(workgroup_id) wg:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let bounce=ptView.flags.w;
 let at=ptFlat(wg,n,lane);
 if(at>=ptRoundCount(bounce)){return;}
 let index=atomicLoad(&ptQueue[ptRoundList(bounce)+at]);
 var path=ptLoadPath(index);
 if(path.dead){
  ptEndHit(index);
  return;
 }
 ptTraceBounce(&path,bounce,vec2i(ptPixelOf(index)),index);
 ptStorePath(index,path);
}
`

/** The finish of a bounce: the paths the bounce holds (`ptView.flags.w`, the queue's list) go on over their hit and material, and those that do are handed to the next bounce, or, when their ray went through a surface that did not cover it, to the next round of the same one. */
const finish = `@compute @workgroup_size(64,1,1)
fn ${PT_FINISH_ENTRY}(@builtin(workgroup_id) wg:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let bounce=ptView.flags.w;
 let at=ptFlat(wg,n,lane);
 if(at>=ptRoundCount(bounce)){return;}
 let index=atomicLoad(&ptQueue[ptRoundList(bounce)+at]);
 var path=ptLoadPath(index);
 let keep=ptFinishBounce(&path,bounce,index);
 path.dead=!keep;
 ptStorePath(index,path);
 if(ptPassedThrough){ptPushRetry(index);}
 else if(keep&&bounce<ptView.counts.z){ptPush(bounce+1u,index);}
}`

/** The trace program: what each path's ray meets, bounce by bounce (`PT_TRACE_BOUNCE_WGSL`). */
export const ptTraceProgram = () =>
  wgslProgram(`${paths}\n${variance}\n${queue}\n${entries}`, [
    PT_QUEUE_WGSL,
    PT_TRACE_BOUNCE_WGSL(PT_TRACE_SCENE),
  ])

/** The finish program: the rest of each bounce over the hit and its material (`PT_FINISH_BOUNCE_WGSL`). */
export const ptFinishProgram = () =>
  wgslProgram(`${paths}\n${lights}\n${queue}\n${finish}`, [
    PT_QUEUE_WGSL,
    PT_FINISH_BOUNCE_WGSL(PT_TRACE_SCENE),
  ])
