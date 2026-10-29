import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { airLayoutEntries } from '../../../lighting/atmosphere/programs.ts'
import { cloudTraceKeyText, type CloudTraceKey } from '../clouds/traceExtraLayout.ts'
import type { AirShape } from '../../../lighting/atmosphere/shape.ts'
import { createCloudTracePass } from '../clouds/trace.ts'
import {
  COMPOSE_FACE_CODE,
  FACE_ENTRIES,
  FACE_LAYOUT,
  FOG_FACE_AIR,
  SKY_FACE_AIR,
  SKY_FACE_AIR_SHADOWED,
  fogFaceProgram,
  skyFaceProgram,
  skyViewCapture,
} from './faceWgsl.ts'
import { cubeFilterLayouts, cubeFilterStages } from './cubeFilterPipelines.ts'
import { askedPipelines } from './askedPipelines.ts'
import { SKY_LIGHT_CUBE_FORMAT } from './layout.ts'
import { KEEP_ALPHA, LIGHT_THROUGH } from '../../../materials/surface/materialBlending.ts'

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
    color: LIGHT_THROUGH,
    alpha: KEEP_ALPHA,
  },
}

type Asked = ReturnType<typeof askedPipelines>

/** The bind group layouts of the capture's passes. */
function skyLightLayouts(device: GPUDevice, shape: AirShape) {
  const layout = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries })
  return {
    skyView: layout(airLayoutEntries(skyViewCapture(shape).bindings, COMPUTE, shape)),
    skyAir: layout(airLayoutEntries(SKY_FACE_AIR, FRAGMENT, shape)),
    skyAirShadowed: layout(airLayoutEntries(SKY_FACE_AIR_SHADOWED, FRAGMENT, shape)),
    fogAir: layout(airLayoutEntries(FOG_FACE_AIR, FRAGMENT, shape)),
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
    ...cubeFilterLayouts(device),
  }
}

type SkyLightLayouts = ReturnType<typeof skyLightLayouts>

/** A pipeline made when first asked for, and asked then. */
function lazily<P>(make: () => P) {
  let made: P | undefined
  return { ask: () => (made ??= make()) }
}

/** The three face draws: the sky, the fog over it and the clouds' composition. */
function faceDraws(
  device: GPUDevice,
  draw: Asked['draw'],
  layouts: SkyLightLayouts,
  shape: AirShape,
) {
  const module = (label: string, code: string) => device.createShaderModule({ label, code })
  return {
    sky: draw(
      module('Trillion3D sky light sky', skyFaceProgram(shape).code),
      [layouts.skyAir, layouts.face],
      FACE_ENTRIES.sky,
      REPLACE,
      'Trillion3D sky light sky',
    ),
    fog: draw(
      module('Trillion3D sky light fog', fogFaceProgram(shape).code),
      [layouts.fogAir, layouts.face],
      FACE_ENTRIES.fog,
      OVER,
      'Trillion3D sky light fog',
    ),
    compose: draw(
      module('Trillion3D sky light compose', COMPOSE_FACE_CODE),
      [layouts.clouds, layouts.face],
      FACE_ENTRIES.compose,
      OVER,
      'Trillion3D sky light compose',
    ),
  }
}

/** The sky table the faces are drawn from, the mips' downsample, the roughness filter and the
 *  harmonics' two sums, the filtered cube's and the captured cube's. */
function filterStages(
  device: GPUDevice,
  compute: Asked['compute'],
  layouts: SkyLightLayouts,
  shape: AirShape,
) {
  return {
    skyView: compute(
      device.createShaderModule({
        label: 'Trillion3D sky light sky table',
        code: skyViewCapture(shape).code,
      }),
      layouts.skyView,
      'skyViewMain',
      'Trillion3D sky light sky table',
    ),
    ...cubeFilterStages(device, compute, layouts),
  }
}

/**
 * THE CAPTURE'S LAYOUTS AND PIPELINES, asked at once, off the frame (`PreparedPipeline.ask`): the
 * sky table the sky of the faces reads, the three face draws, the mips' downsample and the filter,
 * and the harmonics' two sums, the air's
 * programs written for `shape`; the clouds' tracing (the clouds part's own, `createCloudTracePass`) is asked
 * when first wanted, one for each key the capture traces with (`cloudTrace`). The cube is read by a
 * sampler that takes the nearest texel and the nearest level, which the face composition's cloud
 * read does not use; the captured cube's harmonics read it bilinearly.
 */
export function createSkyLightPipelines(
  device: GPUDevice,
  failed: (error: unknown) => void,
  shape: AirShape,
) {
  const layouts = skyLightLayouts(device, shape)
  const { draw, compute } = askedPipelines(device, failed)
  const module = (label: string, code: string) => device.createShaderModule({ label, code })
  const traces = new Map<string, ReturnType<typeof createCloudTracePass>>()
  /** The tracing of each key object asked: a frame's readers hold one key, and join its text once. */
  const byKey = new WeakMap<CloudTraceKey, ReturnType<typeof createCloudTracePass>>()
  return {
    layouts,
    shape,
    /** The sky shaded by the opaque scene (`skyLightShadowFromOpaque`): compiled when first asked, the
     *  unshaded one drawing until it is. */
    skyShadowed: lazily(() =>
      draw(
        module('Trillion3D sky light sky shadowed', skyFaceProgram(shape, true).code),
        [layouts.skyAirShadowed, layouts.face],
        FACE_ENTRIES.sky,
        REPLACE,
        'Trillion3D sky light sky shadowed',
      ),
    ),
    pipelines: {
      ...faceDraws(device, draw, layouts, shape),
      ...filterStages(device, compute, layouts, shape),
    },
    /** The clouds' tracing of the key `key`, asked when first wanted: the faces draw no cloud until
     *  it is compiled. */
    cloudTrace(key: CloudTraceKey) {
      let pass = byKey.get(key)
      if (pass) return pass
      const text = cloudTraceKeyText(key)
      pass = traces.get(text)
      if (!pass) traces.set(text, (pass = createCloudTracePass(device, failed, key, shape)))
      byKey.set(key, pass)
      return pass
    },
  }
}

/** What `createSkyLightPipelines` made. */
export type SkyLightPipelines = ReturnType<typeof createSkyLightPipelines>
