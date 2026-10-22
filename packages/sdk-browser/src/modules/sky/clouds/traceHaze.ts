import { pixelToNdc, unprojectPoint } from '../../../../../math/src/wgsl/projection.ts'
import { workgroupCount } from '../../../../../math/src/scalar/integers.ts'
import {
  COMPUTE,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { askedComputeStage } from '../../../gpu/core/computeStages.ts'
import { CLOUD_HAZE_WGSL } from '../../../lighting/atmosphere/cloudHazeWgsl.ts'
import { PLANET_TO_SCENE } from '../../../lighting/atmosphere/hazeWgsl.ts'
import {
  airLayoutEntries,
  airProgram,
  type AirBindings,
} from '../../../lighting/atmosphere/programs.ts'
import { DEFAULT_AIR_SHAPE, type AirShape } from '../../../lighting/atmosphere/shape.ts'
import { preExposedWgsl } from '../../../post/exposure/preWgsl.ts'
import { CLOUD_FORMAT, type ImageSize } from './reconstructLayout.ts'
import { CLOUD_TRACE_LAYOUT } from './traceLayout.ts'
import { CLOUD_RAY_WGSL } from './traceMarchWgsl.ts'
import { CLOUD_TRACE_GROUP_SIZE } from './traceWgsl.ts'

/**
 * THE HAZE ON THE CLOUDS, PER PIXEL (`cloudHighQualityAerial`): a second pass over the traced
 * images, which lays the haze marched for each texel at the cloud's own depth over the cloud the
 * trace left without it. The trace is run with its haze (and its fog) skipped
 * (`cloudHazeInSecondPass`), into images of its own; this pass reads one of them with the depth image,
 * and writes the other, once for each surface the trace made (the second with the same depth).
 *
 * A texel the cloud covers by a thousandth or less is written clear (no light, a transmittance of
 * one). Any other has the light the air scatters into the way to the cloud (`cloudHaze`, marched
 * from the eye to the depth, jittered by the blue noise of the texel's view pixel, the air's lights
 * shaded by the shadow maps where the settings ask) multiplied by the pre-exposure of the image
 * and laid under the cloud's coverage, the cloud's light kept by the haze's transmittance
 * (`cloudHazeOver`). The ray is the trace's own (`CLOUD_RAY_WGSL`): the trace's block is bound here
 * too. Group 0 is the air's; group 1 the block, the two images read and the image written.
 */
export const CLOUD_HAZE_BINDING = { block: 0, colour: 1, depth: 2, out: 3 } as const

/** The pass's entry. */
export const CLOUD_HAZE_ENTRY = 'cloudHazeMain'

/** What the pass binds of the air, in group 0: the light buffer, the two tables and their sampler,
 *  the image's frame, the blue noise, and — where the shape shades the haze — the shadow maps. */
export const cloudHazeAir = (shape: AirShape): AirBindings => ({
  air: 'read',
  transmittance: true,
  multiScatter: true,
  frame: true,
  noise: true,
  shadow: shape.shadows,
  cloudShadow: true,
})

const B = CLOUD_HAZE_BINDING

/** The program's own text: the point of a march in the scene (`airToScene`), where the air's
 *  lights are shaded by the maps and the clouds. */
const hazeOwn = () => `${PLANET_TO_SCENE}
${CLOUD_TRACE_LAYOUT.wgsl}
@group(1) @binding(${B.block}) var<uniform> cloudTrace:CloudTraceBlock;
@group(1) @binding(${B.colour}) var cloudIn:texture_2d<f32>;
@group(1) @binding(${B.depth}) var depthIn:texture_2d<f32>;
@group(1) @binding(${B.out}) var cloudOut:texture_storage_2d<${CLOUD_FORMAT},write>;
${CLOUD_RAY_WGSL}
@compute @workgroup_size(${CLOUD_TRACE_GROUP_SIZE},${CLOUD_TRACE_GROUP_SIZE},1)
fn ${CLOUD_HAZE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=cloudTrace.traced.x||id.y>=cloudTrace.traced.y){return;}
 let cloud=textureLoad(cloudIn,vec2i(id.xy),0);
 if(cloud.a>0.999){textureStore(cloudOut,vec2i(id.xy),vec4f(0.0,0.0,0.0,1.0));return;}
 let depthKm=textureLoad(depthIn,vec2i(id.xy),0).x;
 let dir=normalize(cloudUnproject(cloudNdc(id.xy),0.5)-frame.eye.xyz);
 let pixel=vec2u((vec2f(id.xy)+0.5)*f32(cloudTrace.mapping.y));
 let haze=cloudHaze(dir,depthKm,blueNoiseScalar(pixel,cloudTrace.sizes.x));
 textureStore(cloudOut,vec2i(id.xy),cloudHazeOver(cloud,vec4f(preExposed(haze.rgb),haze.a)));
}`

/** The pass's whole program for the air's `shape`. */
export const cloudHazeProgram = (shape: AirShape) =>
  airProgram(
    cloudHazeAir(shape),
    hazeOwn(),
    [CLOUD_HAZE_WGSL, pixelToNdc, unprojectPoint, preExposedWgsl('cloudTrace.sky.w')],
    shape,
  )

/** The layout entries of group 1: the block, the cloud image and the depth image read, the image
 *  written. */
export const cloudHazeLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(B.block),
  computeTextureEntry(B.colour, 'unfilterable-float'),
  computeTextureEntry(B.depth, 'unfilterable-float'),
  computeStorageTextureEntry(B.out, CLOUD_FORMAT),
]

/** The groups to dispatch for the traced image: one thread to a texel of it, as the trace's. */
export function cloudHazeDispatch(traced: ImageSize) {
  return {
    x: workgroupCount(traced.view.width, CLOUD_TRACE_GROUP_SIZE),
    y: workgroupCount(traced.view.height, CLOUD_TRACE_GROUP_SIZE),
    z: 1,
  }
}

/** The pass's layouts and pipeline for the air's `shape`, asked now, off the frame; `failed` hears
 *  a failure to compile. */
export function createCloudHazePass(
  device: GPUDevice,
  failed: (error: unknown) => void,
  shape: AirShape = DEFAULT_AIR_SHAPE,
) {
  const air = device.createBindGroupLayout({
    entries: airLayoutEntries(cloudHazeAir(shape), COMPUTE, shape),
  })
  const cloud = device.createBindGroupLayout({ entries: cloudHazeLayoutEntries() })
  const pipeline = askedComputeStage(
    device,
    [air, cloud],
    cloudHazeProgram(shape).code,
    CLOUD_HAZE_ENTRY,
    'Trillion3D cloud haze',
    failed,
  )
  return { air, cloud, pipeline }
}
