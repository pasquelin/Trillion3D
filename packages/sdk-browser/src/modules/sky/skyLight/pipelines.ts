import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../../lighting/deferred/fullscreen.ts'
import { airLayoutEntries } from '../../../lighting/atmosphere/programs.ts'
import { createCloudTracePass } from '../clouds/trace.ts'
import {
  COMPOSE_FACE_CODE,
  FACE_ENTRIES,
  FACE_LAYOUT,
  FOG_FACE_AIR,
  FOG_FACE_PROGRAM,
  SKY_FACE_AIR,
  SKY_FACE_PROGRAM,
} from './faceWgsl.ts'
import { FILTER_ENTRIES, FILTER_CODE } from './filterWgsl.ts'
import { IRRADIANCE_ENTRY, IRRADIANCE_CODE } from './irradianceWgsl.ts'
import { SKY_LIGHT_CUBE_FORMAT } from './layout.ts'

/** `GPUShaderStage`'s flags and `GPUColorWrite`'s, written in the clear. */
const FRAGMENT = 2,
  COMPUTE = 4
const RED = 1,
  GREEN = 2,
  BLUE = 4

/** Where a face's colour is written: the sky replaces what was there, the fog and the composition
 *  add their light and multiply what is under it by what they let through (the source's alpha), the
 *  colour channels written and the alpha left. */
const REPLACE: GPUColorTargetState = {
  format: SKY_LIGHT_CUBE_FORMAT,
  writeMask: RED | GREEN | BLUE,
}
const OVER: GPUColorTargetState = {
  format: SKY_LIGHT_CUBE_FORMAT,
  writeMask: RED | GREEN | BLUE,
  blend: {
    color: { srcFactor: 'one', dstFactor: 'src-alpha', operation: 'add' },
    alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
  },
}

/**
 * THE CAPTURE'S LAYOUTS AND PIPELINES, asked at once, off the frame (`PreparedPipeline.ask`): the
 * three face draws, the clouds' tracing (the clouds part's own, `createCloudTracePass`), the mips'
 * downsample and the filter, and the harmonics' sum. The cube is read by a sampler that takes
 * the nearest texel and the nearest level, which the face composition's cloud read does not use.
 */
export function createSkyLightPipelines(device: GPUDevice, failed: (error: unknown) => void) {
  const layout = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries })
  const layouts = {
    skyAir: layout(airLayoutEntries(SKY_FACE_AIR, FRAGMENT)),
    fogAir: layout(airLayoutEntries(FOG_FACE_AIR, FRAGMENT)),
    face: layout([
      computeUniformEntry(
        0,
        { hasDynamicOffset: true, minBindingSize: FACE_LAYOUT.words * 4 },
        FRAGMENT,
      ),
    ]),
    clouds: layout([
      computeTextureEntry(0, 'float', '2d', FRAGMENT),
      computeSamplerEntry(1, 'filtering', FRAGMENT),
    ]),
    filter: layout([
      computeUniformEntry(0, { hasDynamicOffset: true, minBindingSize: 16 }),
      computeTextureEntry(1, 'float', 'cube'),
      computeSamplerEntry(2, 'non-filtering'),
      computeStorageTextureEntry(3, SKY_LIGHT_CUBE_FORMAT, 'write-only', '2d-array'),
    ]),
    irradiance: layout([
      computeUniformEntry(0, { minBindingSize: 4 }),
      computeTextureEntry(1, 'float', 'cube'),
      computeSamplerEntry(2, 'non-filtering'),
      computeBufferEntry(3, 'storage', COMPUTE),
    ]),
  }
  const draw = (
    code: string,
    groups: GPUBindGroupLayout[],
    entry: string,
    target: GPUColorTargetState,
    label: string,
  ) => {
    const module = device.createShaderModule({ label, code })
    const pipeline = preparedPipeline(
      device,
      fullscreenDescriptor(device, module, groups, entry, [target], label),
    ).ask()
    pipeline.prepare().catch(failed)
    return pipeline
  }
  const compute = (
    module: GPUShaderModule,
    group: GPUBindGroupLayout,
    entry: string,
    label: string,
  ) => {
    const pipeline = preparedComputeStage(
      device,
      device.createPipelineLayout({ bindGroupLayouts: [group] }),
      module,
      entry,
      undefined,
      label,
    ).ask()
    pipeline.prepare().catch(failed)
    return pipeline
  }
  const filterModule = device.createShaderModule({
    label: 'Trillion3D sky light filter',
    code: FILTER_CODE,
  })
  const irradianceModule = device.createShaderModule({
    label: 'Trillion3D sky light harmonics',
    code: IRRADIANCE_CODE,
  })
  const pipelines = {
    sky: draw(
      SKY_FACE_PROGRAM.code,
      [layouts.skyAir, layouts.face],
      FACE_ENTRIES.sky,
      REPLACE,
      'Trillion3D sky light sky',
    ),
    fog: draw(
      FOG_FACE_PROGRAM.code,
      [layouts.fogAir, layouts.face],
      FACE_ENTRIES.fog,
      OVER,
      'Trillion3D sky light fog',
    ),
    compose: draw(
      COMPOSE_FACE_CODE,
      [layouts.clouds, layouts.face],
      FACE_ENTRIES.compose,
      OVER,
      'Trillion3D sky light compose',
    ),
    downsample: compute(
      filterModule,
      layouts.filter,
      FILTER_ENTRIES.downsample,
      'Trillion3D sky light mips',
    ),
    convolve: compute(
      filterModule,
      layouts.filter,
      FILTER_ENTRIES.convolve,
      'Trillion3D sky light filter',
    ),
    irradiance: compute(
      irradianceModule,
      layouts.irradiance,
      IRRADIANCE_ENTRY,
      'Trillion3D sky light harmonics',
    ),
  }
  return { layouts, pipelines, cloudTrace: createCloudTracePass(device, failed) }
}

/** What `createSkyLightPipelines` made. */
export type SkyLightPipelines = ReturnType<typeof createSkyLightPipelines>
