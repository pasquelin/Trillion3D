import { HALF_MAX } from '../../../../math/src/constants.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import {
  dotVector3,
  transformHomogeneousPoint,
  writeNormalizedVector3,
} from '../../../../math/src/vector/vector.ts'
import { autoKernel } from '../../gpu/core/computeStages.ts'
import { WORKGROUP_THREADS, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import type { ReflectionGrids } from '../../lighting/reflections/grids.ts'
import { type InspectedView, unprojectInto, viewForward } from './camera.ts'
import { INSPECTION_REFLECTION_CAP, type InspectedReflections } from './types.ts'

const PASS: GPUComputePassDescriptor = { label: 'Trillion3D inspection reflections' }

/** Floats a sample takes: the ray's direction and distance, then its texel, depth and validity. */
const SAMPLE_FLOATS = 8

/**
 * One texel in `stride`² of a surface's grid (`grid`: the stride, the columns and the count; then the blocks of
 * pixels a texel stands for, across and down), read where the last image left it
 * (`../../lighting/reflections/trace/traceGroups.ts`): the history the accumulation wrote at the texel's
 * block's first pixel — its surface's linear depth (`historyDepth`) —, the fresh texel the trace wrote
 * — its hit's distance and valid bit (`freshPack`) —, and the ray's direction
 * (the ray texture's second and third layers, `REFLECTION_RAY_DIRECTION` and `REFLECTION_RAY_CONE`; `../../lighting/reflections/texelWgsl.ts` lays the words out).
 */
const SAMPLES_WGSL = wgslProgram(
  `@group(0) @binding(0) var history:texture_2d<u32>;
@group(0) @binding(1) var fresh:texture_2d<u32>;
@group(0) @binding(2) var rays:texture_2d_array<u32>;
@group(0) @binding(3) var<storage,read_write> samples:array<vec4f>;
@group(0) @binding(4) var<uniform> grid:array<vec4u,2>;
@compute @workgroup_size(WORKGROUP_THREADS) fn main(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(i>=grid[0].z){return;}
 let t=min(vec2u(i%grid[0].y,i/grid[0].y)*grid[0].x,textureDimensions(rays)-1u);
 let f=textureLoad(fresh,t,0).y>>16u;
 let h=textureLoad(history,min(t*grid[1].xy,textureDimensions(history)-1u),0).y>>16u;
 let depth=select(0.0,unpack2x16float((h&0xfff0u)|8u).x,(h>>4u)!=0u);
 let valid=(f&0x8000u)!=0u&&depth>0.0;
 let d=vec3f(unpack2x16float(textureLoad(rays,t,1,0).r),unpack2x16float(textureLoad(rays,t,2,0).r).x);
 samples[2u*i]=vec4f(d,unpack2x16float(f&0x7fffu).x);
 samples[2u*i+1u]=vec4f(vec2f(t),depth,select(0.0,1.0,valid));
}`,
  [WORKGROUP_THREADS_WGSL],
)
const samplesKernel = autoKernel('Trillion3D inspection reflections', SAMPLES_WGSL, 'main')

/** The blocks of pixels a texel of the grid stands for, across and down (`ReflectionSettings.block`, `blockY`). */
export type Block = readonly [number, number]

/** The samples' grid over `width × height` grid texels: one in `stride`² of them, at most
 *  `INSPECTION_REFLECTION_CAP`. */
export function sampleGrid(width: number, height: number) {
  let stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / INSPECTION_REFLECTION_CAP)))
  // The rows and columns round up: one stride more where they pass the cap.
  if (ceilDiv(width, stride) * ceilDiv(height, stride) > INSPECTION_REFLECTION_CAP) stride++
  const columns = ceilDiv(width, stride)
  return { stride, columns, count: columns * ceilDiv(height, stride) }
}

/** Bytes the samples of `grid` take. */
export const sampleBytes = (grid: ReturnType<typeof sampleGrid>) => grid.count * SAMPLE_FLOATS * 4

/** Encodes the samples `grid` takes of `grids` — the history of `parity`, the turn the last image
 *  wrote — into a buffer of their own; the caller copies it, then destroys it once the copy ran. */
export function encodeReflectionSamples(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  grids: ReflectionGrids,
  parity: number,
  grid: ReturnType<typeof sampleGrid>,
  block: Block,
) {
  const bytes = sampleBytes(grid)
  const samples = device.createBuffer({
    label: 'Trillion3D inspection reflections',
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const uniform = device.createBuffer({
    label: 'Trillion3D inspection reflection grid',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(
    uniform,
    0,
    new Uint32Array([grid.stride, grid.columns, grid.count, 0, block[0], block[1], 0, 0]),
  )
  const pipeline = samplesKernel(device).get()
  if (pipeline) {
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: sequentialEntries([
        grids.history[parity],
        grids.fresh,
        grids.rays,
        { buffer: samples },
        { buffer: uniform },
      ]),
    })
    const pass = encoder.beginComputePass(PASS)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(ceilDiv(grid.count, WORKGROUP_THREADS))
    pass.end()
  }
  return { samples, destroy: () => (samples.destroy(), uniform.destroy()) }
}

/** Whether clip point `clip` lies outside the view: behind the eye or past an edge. */
const outsideView = (clip: Float64Array) =>
  clip[3] <= 0 || Math.abs(clip[0]) > clip[3] || Math.abs(clip[1]) > clip[3]

/** Whether the ray at `at` of `samples`, leaving `point` as far as `distance`, ends outside the view. */
function leavesView(
  clip: Float64Array,
  view: InspectedView,
  point: Float64Array,
  samples: Float32Array,
  at: number,
  distance: number,
) {
  transformHomogeneousPoint(
    clip,
    view.viewProjection,
    point[0] + samples[at] * distance,
    point[1] + samples[at + 1] * distance,
    point[2] + samples[at + 2] * distance,
  )
  return outsideView(clip)
}

/**
 * The rays of `samples` (`SAMPLE_FLOATS` each) placed in the world: a texel's ray leaves its
 * block's centre at the history's depth along the eye's ray through it (`view`, a perspective
 * camera, over a target `size` pixels, a texel a block of `block` pixels, across and down), toward its direction, as far as its distance.
 */
export function decodeReflections(
  samples: Float32Array,
  count: number,
  stride: number,
  view: InspectedView,
  size: readonly number[],
  block: Block,
): InspectedReflections {
  const inverse = invertMatrix4(new Float64Array(16), view.viewProjection),
    forward = viewForward(view.view),
    eye = view.eye
  const origins: number[] = [],
    directions: number[] = [],
    distances: number[] = []
  const point = new Float64Array(3),
    ray = new Float64Array(3),
    clip = new Float64Array(4)
  let towardCamera = 0,
    offView = 0,
    missed = 0
  for (let i = 0; i < count; i++) {
    const at = i * SAMPLE_FLOATS
    if (samples[at + 7] === 0) continue
    // The eye's ray through the block's centre, and the surface where it is the history's depth.
    const x = ((samples[at + 4] + 0.5) * block[0] * 2) / size[0] - 1,
      y = 1 - ((samples[at + 5] + 0.5) * block[1] * 2) / size[1]
    unprojectInto(point, 0, inverse, x, y, 0.5)
    writeNormalizedVector3(ray, 0, point[0] - eye[0], point[1] - eye[1], point[2] - eye[2])
    const along = samples[at + 6] / dotVector3(ray, forward)
    const distance = samples[at + 3] >= HALF_MAX ? Infinity : samples[at + 3]
    let ahead = 0
    for (let k = 0; k < 3; k++) {
      point[k] = eye[k] + ray[k] * along
      origins.push(point[k])
      directions.push(samples[at + k])
      ahead += samples[at + k] * forward[k]
    }
    distances.push(distance)
    // Back against the view: behind the image plane, where no pixel of it can answer.
    if (ahead < 0) towardCamera++
    if (distance === Infinity) missed++
    else if (leavesView(clip, view, point, samples, at, distance)) offView++
  }
  return {
    count: distances.length,
    stride,
    origins: new Float32Array(origins),
    directions: new Float32Array(directions),
    distances: new Float32Array(distances),
    towardCamera,
    offView,
    missed,
  }
}
