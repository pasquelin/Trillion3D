import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { autoKernel } from '../../../gpu/core/computeStages.ts'
import { createGpuPeriodicReadback } from '../../../gpu/core/periodicReadback.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { REFLECTION_SURFACES_WGSL } from '../../reflections/surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from '../../reflections/texelWgsl.ts'
import { REFLECTION_TRACE_BINDINGS } from '../../reflections/trace/traceBindings.ts'
import { reflectionsPending } from '../../reflections/gpu.ts'
import {
  REFLECTION_LIGHT_VIEW_BINDING,
  REFLECTION_VIEW_BINDING,
} from '../../reflections/viewLayout.ts'
import { gpuLineColor, gpuLineSink, type GpuLines } from './gpuLines.ts'

/**
 * THE REFLECTION RAY UNDER THE CURSOR over the image (`reflectionVisualizeTraces`). One thread finds the grid texel the cursor falls in, reads the ray its pixel cast this image (the depth
 * it was cast from, its direction) and what the trace brought back (the distance it reached and the radiance), and draws a line from the surface point to where the ray ended, in the
 * radiance as it is, and a yellow cross of two centimetres at the end. A texel that casts no ray draws nothing. The grid texel, the distance and the radiance are written to a small buffer that
 * is read back a few images late to be written as text (`text`). With no cursor set (`debugCursorX`) nothing is drawn.
 */

const B = REFLECTION_TRACE_BINDINGS
/** The bindings of the kernel beside those of the reflection's group 0 it reads the rays from: the cursor, the trace's fresh texels, the result and the lines' buffers. */
const AT = { query: 62, fresh: 63, found: 64, lines: 65, count: 66 } as const
/** The half length of the cross at the end of the ray, metres: two centimetres. */
const CROSS_SIZE = 0.02
const FOUND_BYTES = 32
const YELLOW = gpuLineColor(1, 1, 0)

export const reflectionTraceWgsl = wgslProgram(
  `struct Query{cursor:vec4f}
@group(0) @binding(${AT.query}) var<uniform> query:Query;
@group(0) @binding(${AT.fresh}) var freshTexels:texture_2d<u32>;
@group(0) @binding(${AT.found}) var<storage,read_write> found:array<vec4f,2>;
// found[0]: the grid texel (xy), 0 outside the grid, 1 inside it, 2 casting a ray (z), the distance the ray reached (w); found[1]: the radiance it brought back.
@compute @workgroup_size(1) fn debugReflectionTraces(){
 found[0]=vec4f(0.0);
 found[1]=vec4f(0.0);
 if(query.cursor.x<0.0||query.cursor.y<0.0){return;}
 let pixel=vec2u(query.cursor.xy/query.cursor.zw*view.viewport.xy);
 let g=pixel/reflectionBlock();
 if(any(g>=reflectionGridSize())){return;}
 found[0]=vec4f(vec2f(g),1.0,0.0);
 let depth=reflectionRayDepth(vec2i(g));
 if(!(depth>0.0)){return;}
 let t=textureLoad(freshTexels,vec2i(g),0).xy;
 let hit=freshHit(t);
 let radiance=texelRadiance(t);
 let point=worldAt(vec2f(reflectionPickedPixel(g))+vec2f(0.5),depth);
 let end=point+normalize(reflectionRayAt(vec2i(g)).xyz)*hit;
 found[0]=vec4f(vec2f(g),2.0,hit);
 found[1]=vec4f(radiance,0.0);
 gpuLineWorld(point,end,pack4x8unorm(vec4f(saturate(radiance),1.0)));
 gpuLineCross(end,${CROSS_SIZE},${YELLOW});
}`,
  [REFLECTION_SURFACES_WGSL, REFLECTION_TEXEL_WGSL, gpuLineSink(AT.lines, AT.count)],
)

const kernel = autoKernel(
  'Trillion3D debug reflection traces',
  reflectionTraceWgsl,
  'debugReflectionTraces',
)

/** The words the text of the view is written from: the result of the kernel as it was read back. */
const NO_TEXT: readonly string[] = []

/** What the reflection ray view keeps between images: the cursor's uniform, the kernel's result and its readback, made at the first image the view is shown. */
export function createReflectionTraces(device: GPUDevice) {
  const query = device.createBuffer({
    label: 'Trillion3D debug reflection trace query',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const found = device.createBuffer({
    label: 'Trillion3D debug reflection trace result',
    size: FOUND_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const words = new Float32Array(FOUND_BYTES / 4)
  const reader = createGpuPeriodicReadback(
    device,
    { label: 'Trillion3D debug reflection trace readback', bytes: FOUND_BYTES, eager: true },
    (mapped) => words.set(new Float32Array(mapped, 0, words.length)),
  )
  const cursor = new Float32Array(4)
  return {
    /** Appends the line of the ray under `cursor` (display pixels of a display of `size`) to `sink`; whether the reflections had an image traced to read. */
    encode(
      rt: WebgpuPagesRuntime,
      encoder: GPUCommandEncoder,
      sink: GpuLines,
      cursorAt: readonly [number, number],
      size: readonly [number, number],
    ) {
      const reflection = rt.gpu.reflection
      const deferred = rt.gpu.deferred
      if (!reflection || !deferred || reflectionsPending(reflection)) return false
      cursor.set([cursorAt[0], cursorAt[1], size[0], size[1]])
      device.queue.writeBuffer(query, 0, cursor)
      const surfaces: (GPUBindingResource | undefined)[] = []
      surfaces[B.raysRead] = reflection.grids.rays
      surfaces[AT.query] = { buffer: query }
      surfaces[AT.fresh] = reflection.grids.fresh
      surfaces[AT.found] = { buffer: found }
      surfaces[AT.lines] = { buffer: sink.lines }
      surfaces[AT.count] = { buffer: sink.count }
      const views: (GPUBindingResource | undefined)[] = []
      views[REFLECTION_VIEW_BINDING] = { buffer: reflection.uniform }
      views[REFLECTION_LIGHT_VIEW_BINDING] = { buffer: deferred.uniform }
      sink.run(encoder, kernel(device), surfaces, 1, 1, views)
      if (reader.due(rt.run.frame) && reader.copy(encoder, found, 0, FOUND_BYTES))
        reader.sampled(rt.run.frame)
      return true
    },
    /** The text of the view, from the result as last read back (`NO_TEXT` before the first): the grid texel, then, where it casts a ray, the distance and the radiance. */
    text(): readonly string[] {
      if (!reader.ready || words[2] === 0) return NO_TEXT
      const lines = [`Pixel: ${words[0]} ${words[1]}`]
      if (words[2] === 2) {
        lines.push(`Distance: ${words[3]!.toFixed(3)}`)
        lines.push(`Radiance: ${[4, 5, 6].map((at) => words[at]!.toFixed(3)).join(' ')}`)
      }
      return lines
    },
    /** After the image's submit: the readback's copy maps. */
    submitted: () => reader.submitted(),
    dispose() {
      query.destroy()
      found.destroy()
      reader.dispose()
    },
  }
}

/** The reflection ray view's state (`createReflectionTraces`). */
export type ReflectionTraces = ReturnType<typeof createReflectionTraces>
