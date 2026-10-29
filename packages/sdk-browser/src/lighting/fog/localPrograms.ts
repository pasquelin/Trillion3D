import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { skyLightDiffuseWgsl } from '../../modules/sky/skyLight/read.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { AIR_BUFFER_STRUCT } from '../atmosphere/layout.ts'
import {
  FOG_LOCAL_CULL_HIDDEN_WGSL,
  FOG_LOCAL_CULL_SEEN_WGSL,
  FOG_LOCAL_CULL_WGSL,
} from './localCullWgsl.ts'
import { FOG_LOCAL_SKY_WGSL } from './localSkyWgsl.ts'

/**
 * THE PROGRAMS OF THE PASSES THAT WRITE FOR THE LOCAL FOG VOLUMES, each declaring the light buffer's
 * front (`AirBuffer`) as `directLights`, in group 0: the sky light's term into the volumes' block, and
 * the tiles' lists into the buffer made for them.
 */

/** Where a pass says that its program did not compile: the diagnostics of the runtime that last asked for
 *  the pass, read when the refusal comes and not before. */
export interface LocalFogDiagnostics {
  diagnosticFailure(phase: string, error: unknown): void
}

/** The pass of a device, made by `create` at the first image that has a local fog volume; the
 *  returned function hands it the diagnostics that hear a refusal to compile it. */
export function localPassOf<P extends { diag: LocalFogDiagnostics | undefined }>(
  create: (device: GPUDevice) => P,
) {
  const made = new WeakMap<GPUDevice, P>()
  return (device: GPUDevice, diag: LocalFogDiagnostics) => {
    let pass = made.get(device)
    if (!pass) made.set(device, (pass = create(device)))
    pass.diag = diag
    return pass
  }
}

/** Where the sky light's pass binds what it reads and writes: the light buffer's front, and the sky
 *  light's harmonics and uniform. */
export const LOCAL_SKY_BINDING = { air: 0, harmonics: 1, params: 2 } as const

/** Where the culling pass binds what it reads and writes: the light buffer's front, the lists it writes,
 *  and — for the program that reads the depth pyramid — the pyramid's three bindings from `hiz`. */
export const LOCAL_CULL_BINDING = { air: 0, tiles: 1, hiz: 2 } as const

/** The light buffer's front, bound at `binding`, read or written. */
const front = (binding: number, access: 'read' | 'read_write') => `${AIR_BUFFER_STRUCT}
@group(0) @binding(${binding}) var<storage,${access}> directLights:AirBuffer;
`

/** The lists' buffer, which the culling pass writes. */
const CULL_FRONT = `${front(LOCAL_CULL_BINDING.air, 'read')}@group(0) @binding(${LOCAL_CULL_BINDING.tiles}) var<storage,read_write> localFogTiles:array<u32>;
`

/** The sky light's pass (`FOG_LOCAL_SKY_WGSL`). */
export const LOCAL_SKY_PROGRAM = wgslProgram(front(LOCAL_SKY_BINDING.air, 'read_write'), [
  skyLightDiffuseWgsl({
    group: 0,
    harmonics: LOCAL_SKY_BINDING.harmonics,
    params: LOCAL_SKY_BINDING.params,
  }),
  FOG_LOCAL_SKY_WGSL,
])

/** The culling pass where no depth pyramid culls (`FOG_LOCAL_CULL_WGSL`). */
export const LOCAL_CULL_PROGRAM = wgslProgram(CULL_FRONT, [
  FOG_LOCAL_CULL_SEEN_WGSL,
  FOG_LOCAL_CULL_WGSL,
])

/** The culling pass where the depth pyramid culls too (`FOG_LOCAL_CULL_HIDDEN_WGSL`). */
export const LOCAL_CULL_PYRAMID_PROGRAM = wgslProgram(CULL_FRONT, [
  hizDepthWgsl(0, LOCAL_CULL_BINDING.hiz),
  FOG_LOCAL_CULL_HIDDEN_WGSL,
  FOG_LOCAL_CULL_WGSL,
])
