import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import type { SkyLightReadSet } from '../../modules/sky/skyLight/read.ts'
import { heldGroup } from '../../gpu/bind/bindIdentity.ts'
import { computeBufferEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { askedComputeStage, dispatchOn } from '../../gpu/core/computeStages.ts'
import {
  LOCAL_SKY_BINDING as BINDING,
  LOCAL_SKY_PROGRAM,
  type LocalFogDiagnostics,
} from './localPrograms.ts'

const SKY_PASS: GPUComputePassDescriptor = { label: 'Trillion3D fog local volumes sky' }

/** The pass of one device: its layout and its pipeline, asked off the frame, and the bind group of the
 *  buffers it last ran over (made again only when one moved). A refusal to compile is said to the
 *  diagnostics last given (`localSkyOf`). */
function createLocalSky(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(BINDING.air, 'storage'),
      computeUniformEntry(BINDING.harmonics),
      computeUniformEntry(BINDING.params),
    ],
  })
  const failed = (error: unknown): void =>
    sky.diag?.diagnosticFailure('fog-local-sky-failed', error)
  const stage = askedComputeStage(
    device,
    [layout],
    LOCAL_SKY_PROGRAM,
    'localSkyMain',
    'Trillion3D fog local volumes sky',
    failed,
  )
  const held = heldGroup()
  const sky = {
    /** Where a refusal to compile is said: the diagnostics of the runtime that last asked for the pass. */
    diag: undefined as LocalFogDiagnostics | undefined,
    /** Writes the sky light's term into `lights` in the run `steps`, from what `reads` reads it with: nothing
     *  while the pipeline is not compiled. */
    encode(steps: ComputeRun, lights: GPUBuffer, reads: SkyLightReadSet) {
      if (!stage.ready) return
      const { next } = held.identity
      next[0] = lights
      next[1] = reads.harmonics
      next[2] = reads.params
      if (held.identity.moved())
        held.group = device.createBindGroup({
          label: 'Trillion3D fog local volumes sky',
          layout,
          entries: [
            { binding: BINDING.air, resource: { buffer: lights } },
            { binding: BINDING.harmonics, resource: { buffer: reads.harmonics } },
            { binding: BINDING.params, resource: { buffer: reads.params } },
          ],
        })
      const pass = steps.pass(SKY_PASS)
      dispatchOn(pass, stage, held.group!, 1)
    },
  }
  return sky
}

/** The pass of each device. */
const made = new WeakMap<GPUDevice, ReturnType<typeof createLocalSky>>()

/** The pass of `device`, made at the first image that has a local fog volume; `diag` hears a refusal to
 *  compile it. */
export function localSkyOf(device: GPUDevice, diag: LocalFogDiagnostics) {
  let pass = made.get(device)
  if (!pass) made.set(device, (pass = createLocalSky(device)))
  pass.diag = diag
  return pass
}
