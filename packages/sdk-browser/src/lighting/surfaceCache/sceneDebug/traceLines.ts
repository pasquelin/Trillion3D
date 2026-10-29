import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { equalAreaDecode } from '../../../../../math/src/wgsl/octahedral.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { autoKernel } from '../../../gpu/core/computeStages.ts'
import { SP_HITS } from '../../bounce/screen/commonWgsl.ts'
import type { ScreenProbeResources } from '../../bounce/screen/resources.ts'
import type { ScreenProbeGeometry } from '../../bounce/screen/screenProbeLayout.ts'
import { gpuLineSink, type GpuLines } from './gpuLines.ts'
import { visualizeTonemapWgsl } from './visualizeTonemap.ts'

/**
 * THE RAYS OF A SCREEN PROBE over the image (`screenProbeGatherVisualizeTraces`), in the reference's two steps. The first kernel picks the probe nearest to the cursor (the middle of the image
 * where none is set) among the uniform probe of its tile and the adaptive probes standing in it, and writes for each of its rays, to a buffer of its own that stays between images, the probe's
 * point, the ray's direction times the distance it reached and the radiance it brought back; a ray that stopped within a centimetre of its probe, which the trace should never do, is written five
 * centimetres long and red. The second turns the buffer into lines, from the point to the end of the ray, in the colour of the radiance seen through the table the image is composed with (`visualizeTonemap.ts`), against the opaque depth where the reference's triangle pass draws them. Where the traces are
 * frozen the first does not run and the lines go on being drawn from the buffer as it was.
 */

const WORKGROUP = 8
const STRIDE = 3
const FLOATS = 4 * STRIDE
/** A ray that ended within this many metres of its probe is a wrong self-intersection, and is shown as one: five centimetres, red. */
const SELF_HIT = 0.01
const SELF_HIT_LENGTH = 0.05

export const probeTraceSetupWgsl = wgslProgram(
  `struct Query{grid:vec4u,counts:vec4u,at:vec4f}
@group(0) @binding(0) var<uniform> query:Query;
@group(0) @binding(1) var probeInfo:texture_2d<f32>;
@group(0) @binding(2) var rayWords:texture_2d<u32>;
@group(0) @binding(3) var hitWords:texture_2d<u32>;
@group(0) @binding(4) var traceLight:texture_2d<u32>;
@group(0) @binding(5) var<storage,read> probePixels:array<u32>;
@group(0) @binding(6) var<storage,read> tileKept:array<u32>;
@group(0) @binding(7) var<storage,read> tileProbes:array<u32>;
@group(0) @binding(8) var<storage,read_write> traces:array<vec4f>;
// grid: the uniform probes along a row and the rows of them, the tile's side, the rays a side; counts: the uniform probes, the most adaptive ones, the samples of a tile, whether the rays are importance sampled; at: the query in the image's pixels.
@compute @workgroup_size(${WORKGROUP},${WORKGROUP}) fn debugProbeTraces(@builtin(global_invocation_id) id:vec3u){
 let rays=query.grid.w;
 if(any(id.xy>=vec2u(rays))){return;}
 let tile=clamp(vec2u(max(query.at.xy,vec2f(0.0)))/vec2u(query.grid.z),vec2u(0u),query.grid.xy-vec2u(1u));
 let tileIndex=tile.y*query.grid.x+tile.x;
 var chosen=tileIndex;
 let own=probePixels[tileIndex];
 var best=length(query.at.xy-vec2f(f32(own&0xffffu),f32(own>>16u)));
 let kept=tileKept[tileIndex];
 for(var rank=0u;rank<min(query.counts.z,32u);rank++){
  if((kept&(1u<<rank))==0u){continue;}
  let adaptive=tileProbes[tileIndex*query.counts.z+rank];
  if(adaptive>=query.counts.y){continue;}
  let word=probePixels[query.counts.x+adaptive];
  let away=length(query.at.xy-vec2f(f32(word&0xffffu),f32(word>>16u)));
  if(away<best){best=away;chosen=query.counts.x+adaptive;}
 }
 let atlas=vec2u(chosen%query.grid.x,chosen/query.grid.x);
 let info=textureLoad(probeInfo,vec2i(atlas),0);
 let texel=vec2i(atlas*rays+id.xy);
 let slot=(id.y*rays+id.x)*${STRIDE}u;
 var origin=vec3f(0.0);
 var direction=vec3f(0.0);
 var reached=0.0;
 var light=vec3f(0.0);
 // A negative depth: the probe stands on no lit surface, and its rays are not drawn.
 if(info.w>0.0){
  var coord=id.xy;
  var size=f32(rays);
  if(query.counts.w!=0u){
   let word=textureLoad(rayWords,texel,0).r;
   coord=spRayCoord(word);
   size=f32(spRayMip(spRayLevel(word),rays));
  }
  let hit=textureLoad(hitWords,texel,0).r;
  reached=spHitDistance(hit);
  light=unpackLight(textureLoad(traceLight,texel,0).r);
  if(hit!=0u&&reached<${SELF_HIT}){reached=${SELF_HIT_LENGTH};light=vec3f(1.0,0.0,0.0);}
  origin=info.xyz;
  direction=equalAreaDecode((vec2f(coord)+vec2f(0.5))/size);
 }
 traces[slot]=vec4f(origin,0.0);
 traces[slot+1u]=vec4f(direction*reached,0.0);
 traces[slot+2u]=vec4f(light,0.0);
}`,
  [SP_HITS, equalAreaDecode, unpackLight],
)

export const probeTraceLinesWgsl = wgslProgram(
  `struct Draw{count:u32,tonemap:u32,depthTested:u32,pad:u32}
@group(0) @binding(0) var<uniform> draw:Draw;
@group(0) @binding(1) var<storage,read> traces:array<vec4f>;
@compute @workgroup_size(64) fn debugProbeTraceLines(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=draw.count){return;}
 let slot=id.x*${STRIDE}u;
 let origin=traces[slot].xyz;
 let light=traces[slot+2u].xyz;
 let color=pack4x8unorm(vec4f(saturate(visualizeTonemap(light,draw.tonemap!=0u)),1.0));
 if(draw.depthTested!=0u){gpuLineWorldDepthTested(origin,origin+traces[slot+1u].xyz,color);}
 else{gpuLineWorld(origin,origin+traces[slot+1u].xyz,color);}
}`,
  [visualizeTonemapWgsl(4), gpuLineSink(2, 3)],
)

const setup = autoKernel('Trillion3D debug probe traces', probeTraceSetupWgsl, 'debugProbeTraces')
const toLines = autoKernel(
  'Trillion3D debug probe trace lines',
  probeTraceLinesWgsl,
  'debugProbeTraceLines',
)

/** What the view of a screen probe's rays asks of one image. */
export interface ProbeTraceOptions {
  /** The cursor in the display's pixels; the middle of the image where a coordinate is negative. */
  cursor: readonly [number, number]
  size: readonly [number, number]
  /** Whether the buffer keeps the rays of an earlier image. */
  frozen: boolean
  /** Whether the rays are importance sampled (their texel is in the ray words). */
  importance: boolean
  /** Whether the lines are coloured through the table the composition reads, or by the display's transfer alone. */
  tonemapped: boolean
  /** Whether the opaque depth hides the lines of the rays behind a surface. */
  depthTested: boolean
  /** What the colour binds (`visualizeTonemapBindings`). */
  tone: readonly GPUBindingResource[]
}

/** What the view of a screen probe's rays keeps between images: the buffer of the rays of the probe it follows, made at the first image and given back when the view goes. */
export function createProbeTraces(device: GPUDevice) {
  let data: GPUBuffer | undefined
  let rays = 0
  const query = new ArrayBuffer(48)
  const queryUints = new Uint32Array(query)
  const queryFloats = new Float32Array(query)
  const draw = new Uint32Array(4)
  const appendLines = (encoder: GPUCommandEncoder, sink: GpuLines, options: ProbeTraceOptions) => {
    draw.set([rays, options.tonemapped ? 1 : 0, options.depthTested ? 1 : 0])
    sink.run(
      encoder,
      toLines(device),
      [
        { buffer: sink.uniform('probeTraceLines', draw.buffer) },
        { buffer: data! },
        { buffer: sink.lines },
        { buffer: sink.count },
        ...options.tone,
      ],
      ceilDiv(rays, 64),
    )
  }
  return {
    /** Appends the rays of the probe nearest to the cursor to `sink`, from the records of the turn `turn` of `resources`; the buffer is written first unless it is frozen and holds an earlier image's. */
    encode(
      encoder: GPUCommandEncoder,
      sink: GpuLines,
      resources: ScreenProbeResources,
      geometry: ScreenProbeGeometry,
      turn: 0 | 1,
      options: ProbeTraceOptions,
    ) {
      const count = geometry.tracing * geometry.tracing
      const fresh = !data || rays !== count
      if (fresh) {
        data?.destroy()
        data = device.createBuffer({
          label: 'Trillion3D debug probe traces',
          size: count * FLOATS * 4,
          usage: GPUBufferUsage.STORAGE,
        })
        rays = count
      }
      if (fresh || !options.frozen) {
        const known = options.cursor[0] >= 0 && options.cursor[1] >= 0
        // The cursor is a pixel of the display, the image its scaled copy.
        const at = known
          ? [
              (options.cursor[0] * geometry.width) / options.size[0],
              (options.cursor[1] * geometry.height) / options.size[1],
            ]
          : [(geometry.tilesX >> 1) * geometry.tile, (geometry.tilesY >> 1) * geometry.tile]
        queryUints.set([
          geometry.tilesX,
          geometry.tilesY,
          geometry.tile,
          geometry.tracing,
          geometry.uniform,
          geometry.maxAdaptive,
          geometry.samplesX * geometry.samplesY,
          options.importance ? 1 : 0,
        ])
        queryFloats.set(at, 8)
        sink.run(
          encoder,
          setup(device),
          [
            { buffer: sink.uniform('probeTraces', query) },
            resources.info[turn],
            resources.ray,
            resources.hit,
            resources.radiance,
            { buffer: resources.pixels },
            { buffer: resources.header },
            { buffer: resources.indices },
            { buffer: data! },
          ],
          ceilDiv(geometry.tracing, WORKGROUP),
          ceilDiv(geometry.tracing, WORKGROUP),
        )
      }
      appendLines(encoder, sink, options)
    },
    dispose() {
      data?.destroy()
      data = undefined
    },
  }
}

/** The rays of a screen probe the view keeps (`createProbeTraces`). */
export type ProbeTraces = ReturnType<typeof createProbeTraces>
