import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { autoKernel, dispatchOn } from '../../../gpu/core/computeStages.ts'
import { DEBUG_LINE_SPACE, DEBUG_LINE_STRUCT } from '../../../hair/debugLinesWgsl.ts'
import type { DebugAppendedLines } from '../../../hair/debugLinesPass.ts'

/**
 * THE LINES THE GPU APPENDS, one mechanism for every view that draws what a kernel finds: the kernel appends lines (`gpuLineSink`) to a buffer of its own with one atomic count, a
 * last kernel turns the count into the arguments of an indirect draw, and the debug lines pass draws that many (`../../../hair/debugLinesPass.ts`). The host's list holds 16384 lines;
 * this one `GPU_LINE_CAPACITY` unless the view asks for more, and no line is written, nor read back, while no view that draws is shown.
 */

/** The lines a buffer holds unless the view asks for more (`createGpuLines`): those past it are dropped, the count going on. */
const GPU_LINE_CAPACITY = 1 << 18
const LINE_BYTES = 32
const LABEL = 'Trillion3D debug lines appended'

/** A colour of a view as the bytes r, g, b, a of a word (`debugColor`), as a kernel writes it. */
export const gpuLineColor = (r: number, g: number, b: number, a = 1) =>
  `${(Math.round(r * 255) | (Math.round(g * 255) << 8) | (Math.round(b * 255) << 16) | (Math.round(a * 255) << 24)) >>> 0}u`

/**
 * The lines a kernel appends, as it reads them: `lines` and `count` the bindings of the buffers (read and write storage), and the functions to write with. `gpuLineWorld` a segment between two
 * points of the world relative to the eye, `gpuLinePixels` one between two pixels of the display, `gpuLineRect` the four edges of a quad of pixels, `gpuLineFilled` the quad filled (one line as
 * wide as the quad), `gpuLineCross` the three axes of a cross of half length `size` round a point of the world, `gpuLineWorldDepthTested` a segment between two points of the world drawn only
 * where no opaque surface is nearer the eye.
 */
export const gpuLineSink = (lines: number, count: number) =>
  wgslBlock(
    `gpuLineSink(${lines}, ${count})`,
    [],
    `${DEBUG_LINE_STRUCT}
@group(0) @binding(${lines}) var<storage,read_write> sinkLines:array<DebugLine>;
@group(0) @binding(${count}) var<storage,read_write> sinkCount:atomic<u32>;
fn gpuLineAdd(line:DebugLine){
 let at=atomicAdd(&sinkCount,1u);
 if(at<arrayLength(&sinkLines)){sinkLines[at]=line;}
}
fn gpuLineWorld(a:vec3f,b:vec3f,color:u32){gpuLineAdd(DebugLine(a,color,b,${DEBUG_LINE_SPACE.world}.0));}
fn gpuLineWorldDepthTested(a:vec3f,b:vec3f,color:u32){gpuLineAdd(DebugLine(a,color,b,${DEBUG_LINE_SPACE.worldDepthTested}.0));}
fn gpuLinePixels(a:vec2f,b:vec2f,color:u32){gpuLineAdd(DebugLine(vec3f(a,0.0),color,vec3f(b,0.0),${DEBUG_LINE_SPACE.pixels}.0));}
fn gpuLineRect(lo:vec2f,hi:vec2f,color:u32){
 gpuLinePixels(lo,vec2f(hi.x,lo.y),color);
 gpuLinePixels(vec2f(hi.x,lo.y),hi,color);
 gpuLinePixels(hi,vec2f(lo.x,hi.y),color);
 gpuLinePixels(vec2f(lo.x,hi.y),lo,color);
}
fn gpuLineFilled(lo:vec2f,hi:vec2f,color:u32){
 let middle=0.5*(lo.y+hi.y);
 gpuLineAdd(DebugLine(vec3f(lo.x,middle,abs(hi.y-lo.y)),color,vec3f(hi.x,middle,0.0),${DEBUG_LINE_SPACE.pixels}.0));
}
fn gpuLineCross(p:vec3f,size:f32,color:u32){
 gpuLineWorld(p-vec3f(size,0.0,0.0),p+vec3f(size,0.0,0.0),color);
 gpuLineWorld(p-vec3f(0.0,size,0.0),p+vec3f(0.0,size,0.0),color);
 gpuLineWorld(p-vec3f(0.0,0.0,size),p+vec3f(0.0,0.0,size),color);
}`,
  )

/** The kernel that turns the count into the arguments of the draw: six vertices, a quad, for each line held. */
const FINISH_WGSL = wgslProgram(
  `${DEBUG_LINE_STRUCT}
@group(0) @binding(0) var<storage,read_write> sinkCount:atomic<u32>;
@group(0) @binding(1) var<storage,read_write> drawArgs:array<u32>;
@group(0) @binding(2) var<storage,read_write> sinkLines:array<DebugLine>;
@compute @workgroup_size(1) fn gpuLinesFinish(){
 drawArgs[0]=6u;
 drawArgs[1]=min(atomicLoad(&sinkCount),arrayLength(&sinkLines));
 drawArgs[2]=0u;
 drawArgs[3]=0u;
}`,
  [],
)

const finish = autoKernel(`${LABEL} finish`, FINISH_WGSL, 'gpuLinesFinish')

/** A kernel of the views that append lines (`autoKernel`, made for a device). */
export type LineStage = ReturnType<ReturnType<typeof autoKernel>>

/** Runs the kernel `stage` of `device`, binding `resources` (from binding 0, in the kernel's own order, none for a binding it does not use) and, from group 1, the `more` groups the same way, over `x` × `y` workgroups, in a pass of its own. */
export function runLineKernel(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  stage: LineStage,
  resources: readonly (GPUBindingResource | undefined)[],
  x: number,
  y = 1,
  ...more: readonly (GPUBindingResource | undefined)[][]
) {
  const pipeline = stage.get()
  if (!pipeline) return
  const groupOf = (group: number, bound: readonly (GPUBindingResource | undefined)[]) =>
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(group),
      entries: bound.flatMap((resource, binding) => (resource ? [{ binding, resource }] : [])),
    })
  const pass = encoder.beginComputePass({ label: LABEL })
  more.forEach((bound, at) => pass.setBindGroup(at + 1, groupOf(at + 1, bound)))
  dispatchOn(pass, stage, groupOf(0, resources), x, y)
  pass.end()
}

/** The buffers of lines appended to an image of a view: the lines (`capacity` of them), their count and the arguments of the draw; the count emptied at each image. */
export function createGpuLines(device: GPUDevice, capacity = GPU_LINE_CAPACITY) {
  const make = (label: string, size: number, usage: GPUBufferUsageFlags) =>
    device.createBuffer({ label: `${LABEL} ${label}`, size, usage: usage | GPUBufferUsage.STORAGE })
  const lines = make('lines', capacity * LINE_BYTES, 0)
  const count = make('count', 16, GPUBufferUsage.COPY_DST)
  const args = make('arguments', 16, GPUBufferUsage.INDIRECT)
  const run = (
    encoder: GPUCommandEncoder,
    stage: LineStage,
    resources: readonly (GPUBindingResource | undefined)[],
    x: number,
    y = 1,
    ...more: readonly (GPUBindingResource | undefined)[][]
  ) => runLineKernel(device, encoder, stage, resources, x, y, ...more)
  const uniforms = new Map<string, GPUBuffer>()
  return {
    lines,
    count,
    capacity,
    run,
    /** The uniform of the kernel `name`, written with `data` (a kernel has a buffer of its own: the commands of an image read it as the last write left it). */
    uniform(name: string, data: ArrayBuffer) {
      let buffer = uniforms.get(name)
      if (!buffer) {
        buffer = device.createBuffer({
          label: `${LABEL} ${name}`,
          size: data.byteLength,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
        uniforms.set(name, buffer)
      }
      device.queue.writeBuffer(buffer, 0, data)
      return buffer
    },
    /** What the lines pass draws. */
    appended: { lines, args } satisfies DebugAppendedLines,
    /** Empties the lines for an image: the kernels of the views append after this. */
    begin: (encoder: GPUCommandEncoder) => encoder.clearBuffer(count),
    /** Writes the arguments of the draw once every kernel has appended its lines. */
    end(encoder: GPUCommandEncoder) {
      run(encoder, finish(device), [{ buffer: count }, { buffer: args }, { buffer: lines }], 1)
    },
    dispose() {
      lines.destroy()
      count.destroy()
      args.destroy()
      for (const buffer of uniforms.values()) buffer.destroy()
    },
  }
}

/** The lines the GPU appends to an image of a view (`createGpuLines`). */
export type GpuLines = ReturnType<typeof createGpuLines>
