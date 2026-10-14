// The work the run-time proxy's rays spend in a frame, counted by the proof alone: the engine counts
// nothing in its kernel (`bounce/runtimeRadianceWgsl.ts`, its cost is the frame's GPU duration the proxy
// budget observes). On every device the page's WebGPU grants from now on, the shipped trace is compiled
// with a counter the proof adds to its text — each ray's work summed over its workgroup, one atomic a
// workgroup into a word the proof adds past the tile list's tiles —, and the frame state's kernel
// starts that word again with the list. The engine's buffers, layouts and dispatches are its own.
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { latestMade } from '../kit/worldErrors.ts'
import { onGrantedDevices } from '../kit/grantedDevices.ts'

/** The trace's text, whose ray of the proxy and whose entry the counter joins. */
const RAY = 'return ReflectionProxied(seen.color,seen.confidence);'
const ENTRY = 'tracePixel(flatIndex(wg,rows,1u),lid.xy);'
const BEGIN = 'fn reflectionBegin(){'

/** What the counter adds to the trace: each invocation's work, its workgroup's sum, and the one
 *  add of it to the list's last word. */
const COUNTER = `
var<private> proofSpentHere:u32;
var<workgroup> proofGroupSpent:atomic<u32>;
fn proofShare(first:bool){
 if(proofSpentHere!=0u){atomicAdd(&proofGroupSpent,proofSpentHere);}
 workgroupBarrier();
 if(first){
  let spent=atomicLoad(&proofGroupSpent);
  if(spent!=0u){atomicAdd(&traceList[arrayLength(&traceList)-1u],spent);}
 }
}
`

/** The shipped text with the counter, or the text as it was when it is not the trace's. */
function counted(code: string) {
  if (code.includes(BEGIN))
    return code.replace(BEGIN, `${BEGIN}traceList[arrayLength(&traceList)-1u]=0u;`)
  if (!code.includes(ENTRY)) return code
  if (!code.includes(RAY)) throw new Error('the shipped trace has no ray of the proxy to count')
  return (
    code
      .replace(RAY, `proofSpentHere+=rtWork+rtExtra;${RAY}`)
      .replace(ENTRY, `${ENTRY}proofShare(all(lid.xy==vec2u(0u)));`) + COUNTER
  )
}

/** Whether the hook is on: the proof's GPU is installed once a process (`installProofGpu`), and a
 *  second hook would count the counted text again. */
let installed = false

/** Counts the trace's work on every device granted from now on: the tile lists are made a word
 *  longer, that word the frame's work. Hooked once a process, whatever the cases it draws. */
export function countTraceWork() {
  if (installed) return
  installed = true
  onGrantedDevices((device) => {
    const createBuffer = device.createBuffer.bind(device),
      createShaderModule = device.createShaderModule.bind(device)
    device.createBuffer = (descriptor) =>
      createBuffer(
        descriptor.label?.startsWith('Trillion3D reflection tile list')
          ? { ...descriptor, size: descriptor.size + 4 }
          : descriptor,
      )
    device.createShaderModule = (descriptor) =>
      createShaderModule({ ...descriptor, code: counted(descriptor.code) })
  })
}

/** The work the frame's proxy rays spent, read on `device` in the last word of the world's newest
 *  tile list (`made`, `listenToWorldDevices`); none before the world made a list. */
export async function traceWork(device: GPUDevice, made: Map<string, GPUBuffer>) {
  const list = latestMade(made, (label) => label.startsWith('Trillion3D reflection tile list'))
  if (!list) return undefined
  // Its last word alone: the tiles before it are the engine's.
  const words = (await readGpuBuffer(device, list, 4, list.size - 4))!
  return { spent: words[0] }
}
