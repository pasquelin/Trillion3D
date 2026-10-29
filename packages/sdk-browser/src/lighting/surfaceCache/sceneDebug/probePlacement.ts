import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { octBytesDecode } from '../../../../../math/src/wgsl/octahedral.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import { autoKernel } from '../../../gpu/core/computeStages.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { ScreenProbeResources } from '../../bounce/screen/resources.ts'
import type { ScreenProbeGeometry } from '../../bounce/screen/screenProbeLayout.ts'
import { gpuLineColor, gpuLineSink, type GpuLines } from './gpuLines.ts'

/**
 * THE SCREEN PROBES' PLACEMENT over the image (`screenProbeGatherDebugProbePlacement`): a thread for each probe of the atlas that stands on a lit pixel appends a small quad at the
 * pixel it stands on, yellow for a uniform probe and magenta for an adaptive one (mode 1 both, 2 the adaptive ones alone), or, in mode 3, a cross of two centimetres at its point with a
 * line of ten centimetres along its normal.
 */

const WORKGROUP = 64
/** The half side of the quad of a probe's pixel, display pixels. */
const QUAD = 1
/** The half length of the cross and the length of the normal's line, in metres (two and ten centimetres). */
const CROSS = 2 / CM
const NORMAL = 10 / CM
const YELLOW = gpuLineColor(1, 1, 0)
const MAGENTA = gpuLineColor(1, 0, 1)

export const probePlacementWgsl = wgslProgram(
  `struct Placement{grid:vec4u,scale:vec4f,reach:vec4f}
@group(0) @binding(0) var<uniform> place:Placement;
@group(0) @binding(1) var probeInfo:texture_2d<f32>;
@group(0) @binding(2) var probeNormal:texture_2d<u32>;
@group(0) @binding(3) var<storage,read> probePixels:array<u32>;
@group(0) @binding(4) var<storage,read> adaptiveCount:array<u32>;
@compute @workgroup_size(${WORKGROUP}) fn debugProbePlacement(@builtin(global_invocation_id) id:vec3u){
 // grid: the probes along a row, the uniform ones, the adaptive ones the atlas holds at most, the mode.
 let index=id.x;
 let uniformCount=place.grid.y;
 if(index>=uniformCount+min(adaptiveCount[0],place.grid.z)){return;}
 let adaptive=index>=uniformCount;
 let mode=place.grid.w;
 if(!adaptive&&mode==2u){return;}
 let atlas=vec2i(i32(index%place.grid.x),i32(index/place.grid.x));
 let info=textureLoad(probeInfo,atlas,0);
 // A negative depth: the probe stands on no lit surface.
 if(info.w<0.0){return;}
 let color=select(${YELLOW},${MAGENTA},adaptive);
 if(mode==3u){
  let normal=octBytesDecode(textureLoad(probeNormal,atlas,0).x,0u);
  gpuLineCross(info.xyz,place.reach.x,color);
  gpuLineWorld(info.xyz,info.xyz+place.reach.y*normal,color);
  return;
 }
 let word=probePixels[index];
 let pixel=vec2f(f32(word&0xffffu),f32(word>>16u))*place.scale.xy;
 gpuLineRect(pixel-place.scale.zw,pixel+place.scale.zw,color);
}`,
  [octBytesDecode, gpuLineSink(5, 6)],
)

const kernel = autoKernel(
  'Trillion3D debug probe placement',
  probePlacementWgsl,
  'debugProbePlacement',
)

const words = new ArrayBuffer(48)
const uints = new Uint32Array(words)
const floats = new Float32Array(words)
const uniforms = new WeakMap<GPUDevice, GPUBuffer>()

/** Appends the placement of the probes of `view` (`mode` 1 to 3), seen at a display of `size` pixels, from the records of the turn `turn`. */
export function encodeProbePlacement(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  lines: GpuLines,
  resources: ScreenProbeResources,
  geometry: ScreenProbeGeometry,
  turn: 0 | 1,
  size: readonly [number, number],
  mode: 1 | 2 | 3,
) {
  let uniform = uniforms.get(device)
  if (!uniform) {
    uniform = device.createBuffer({
      label: 'Trillion3D debug probe placement',
      size: words.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    uniforms.set(device, uniform)
  }
  uints.set([geometry.tilesX, geometry.uniform, geometry.maxAdaptive, mode])
  // The probes' pixels are the image's: scaled to the display's, the quad round each.
  const scale = [size[0] / geometry.width, size[1] / geometry.height]
  floats.set([scale[0]!, scale[1]!, QUAD, QUAD, CROSS, NORMAL], 4)
  device.queue.writeBuffer(uniform, 0, words)
  lines.run(
    encoder,
    kernel(device),
    [
      { buffer: uniform },
      resources.info[turn],
      resources.normal,
      { buffer: resources.pixels },
      { buffer: resources.counts },
      { buffer: lines.lines },
      { buffer: lines.count },
    ],
    ceilDiv(geometry.uniform + geometry.maxAdaptive, WORKGROUP),
  )
}
