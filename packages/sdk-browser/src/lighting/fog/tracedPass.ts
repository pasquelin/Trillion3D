import { dagReadGroupEntries, dagReadLayoutEntries } from '../../geometry/dag/shader/bindings.ts'
import { heldProgramGroup, keptProgramGroup } from '../../gpu/bind/programGroups.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../gpu/core/computeStages.ts'
import { dispatchCubes } from '../../gpu/dispatch/grid.ts'
import { sceneMaskedLayoutEntries } from '../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneTraceGroupBinder } from '../rays/sceneTrace/sceneTraceGroup.ts'
import { FOG_BINDING } from './bindings.ts'
import { tracedLayoutEntries } from './layoutEntries.ts'
import type { FogPassContext, FogPassInputs } from './passes.ts'
import {
  heldMakerOf,
  oncePerDeviceOverPrograms,
  sceneMaskKey,
} from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { fogTracedProgram } from './programs.ts'
import type { VolumeTextures } from './resources.ts'
import { FOG_TRACED_ENTRY, FOG_TRACED_SCENE } from './tracedWgsl.ts'

const LABEL = 'Trillion3D fog traced shadows'

/** The name the pass holds the graph programs of its rays under (`sceneMaskHold.ts`). */
export const FOG_TRACED_HOLD = 'fog traced shadows'

/** What the pass that traces the volume's lights' shadows (`tracedWgsl.ts`) is made of on a device, for the graph masks `programs` its rays cut by (`sceneMaskProgramsOf`): its group 0 (the fog's own beside the cut's tables) and the scene trace's group, its pipeline
 *  compiled off the frame (not waited for: the volume holds no traced shadow until it is `ready`) and the binder of the scene trace's group. The bind group of group 0 is the volume's (`FogGroups.traced`), not the device's: two volumes name other resources. */
export const fogTracedKernel = oncePerDeviceOverPrograms(
  (device: GPUDevice, _key: 'traced', programs) => {
    const label = `${LABEL} ${sceneMaskKey(programs)}`
    const layouts = [
      device.createBindGroupLayout({
        label,
        entries: [...tracedLayoutEntries(), ...dagReadLayoutEntries()],
      }),
      device.createBindGroupLayout({
        label: `${label} scene`,
        entries: sceneMaskedLayoutEntries(FOG_TRACED_SCENE.first),
      }),
    ]
    const stages = startedComputeStages(
      device,
      label,
      device.createPipelineLayout({ bindGroupLayouts: layouts }),
      device.createShaderModule({ label, code: fogTracedProgram(programs) }),
      [FOG_TRACED_ENTRY],
    )
    return {
      layouts,
      get ready() {
        return stages.ready
      },
      get pending() {
        return stages.pending
      },
      pipeline: () => stages.pipelineOf(FOG_TRACED_ENTRY),
      sceneGroup: sceneTraceGroupBinder(device),
    }
  },
)

/** The maker of the pass for a device, as the mask hold takes it (`maskHold.use`): one function a device, not one an image. */
export const fogTracedMaker = heldMakerOf(fogTracedKernel)

/** The pass that traces the volume's lights' shadows, made over a set of graph programs. */
export type FogTracedKernel = ReturnType<typeof fogTracedKernel>

/**
 * The shadows of the lights the volume traces, into the traced volume (`tracedWgsl.ts`): one word a cell, before the scatter reads it. Nothing where the image names no light
 * (`FogPassInputs.rays` and `tracedKernel`: the scene trace the image made and the ready pass over it, given only where lights are named in `FogVolumeFrame.traced`) or has no volume to write (`FogPassContext.traced`): the volume then keeps what it holds.
 */
export function encodeFogTraced(
  pass: GPUComputePassEncoder,
  context: FogPassContext,
  input: FogPassInputs,
  textures: VolumeTextures,
) {
  const { device, resources, groups, traced, ping } = context
  const { rays, tracedKernel: kernel } = input
  if (!rays || !kernel || !traced) return
  const { views } = rays
  const held = resources.tracedHeld()
  const furthest = textures.furthest[ping]!
  const { next } = groups.traced.identity
  next[0] = resources.frame.buffer
  next[1] = input.depth
  next[2] = furthest
  next[3] = input.lights
  next[4] = traced
  next[5] = held
  next[6] = views.nodes
  next[7] = views.frames
  next[8] = views.worlds
  next[9] = views.tree
  pass.setPipeline(kernel.pipeline())
  pass.setBindGroup(
    0,
    heldProgramGroup(groups.traced) ??
      keptProgramGroup(
        device,
        kernel.layouts[0]!,
        groups.traced,
        [
          ...namedEntries(FOG_BINDING, {
            frame: { buffer: resources.frame.buffer },
            depth: input.depth,
            furthest,
            lights: { buffer: input.lights },
            tracedOut: traced,
            tracedHeld: { buffer: held },
          }),
          ...dagReadGroupEntries(views),
        ],
        LABEL,
      ),
  )
  pass.setBindGroup(
    FOG_TRACED_SCENE.group,
    kernel.sceneGroup(kernel.layouts[1]!, rays.sceneTrace, FOG_TRACED_SCENE.first),
  )
  const { cells } = context
  dispatchCubes(pass, cells.x, cells.y, cells.z)
}
