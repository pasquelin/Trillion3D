import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { buffers, groupOf, type GroupParts, type ScreenProbeInputs } from './groupParts.ts'
import { RAYS_BINDINGS, RAYS_PROBES } from './importanceWgsl.ts'
import type { ScreenProbeKernels } from './kernels.ts'
import { PLACE_BINDINGS } from './placeWgsl.ts'
import type { ScreenProbeResources } from './resources.ts'
import { SCREEN_DATA_BINDINGS } from './screenDataWgsl.ts'
import { filterGroups, pixelGroups, traceGroups } from './traceGroups.ts'

/** The bind groups of every kernel for one parity of the history's turn about. */
export type ScreenProbeGroups = ReturnType<typeof createGroups>

/** The placement, the screen data and the rays. */
function placeGroups(g: GroupParts) {
  const { device, kernels, r, inputs, last, final, common, probe, records, surface } = g
  return {
    place: groupOf(
      device,
      kernels.place,
      namedEntries(PLACE_BINDINGS.at, {
        ...common,
        ...surface,
        ...probe,
        ...buffers({
          pixels: r.pixels,
          mask: r.mask,
          counts: r.counts,
          header: r.header,
          indices: r.indices,
          args: r.args,
        }),
        vectors: inputs.vectors,
      }),
    ),
    screenData: groupOf(
      device,
      kernels.screenData,
      namedEntries(SCREEN_DATA_BINDINGS.at, {
        ...common,
        ...records,
        ...surface,
        history: r.history[last],
        vectors: inputs.vectors,
        ...buffers({ brdf: r.brdf, disocclusion: r.disocclusion }),
      }),
    ),
    rays: groupOf(device, kernels.rays, [
      ...namedEntries(RAYS_BINDINGS.at, {
        ...common,
        ...records,
        historyInfo: r.info[last],
        historyGather: r.gather[final],
        ray: r.ray,
        ...buffers({ brdf: r.brdf, bounceGrid: inputs.bounceGrid, lights: inputs.lights }),
      }),
      { binding: RAYS_PROBES, resource: inputs.probes },
    ]),
  }
}

/** The groups of a frame of parity `turn` (0 or 1): this frame's resources are the turn's, the last frame's
 *  — the history — the other. `passes` is the spatial filter's count: its last pass writes the one of
 *  the two gathered textures the rays read next frame and the conversion reads now. */
function createGroups(
  device: GPUDevice,
  kernels: ScreenProbeKernels,
  r: ScreenProbeResources,
  inputs: ScreenProbeInputs,
  turn: 0 | 1,
  passes: number,
) {
  const probe = { info: r.info[turn], normal: r.normal }
  const parts: GroupParts = {
    device,
    kernels,
    r,
    inputs,
    turn,
    last: (1 - turn) as 0 | 1,
    final: (passes % 2) as 0 | 1,
    common: { params: { buffer: r.params } },
    probe,
    records: { ...probe, ...buffers({ counts: r.counts, pixels: r.pixels }) },
    surface: { normals: inputs.normals, flags: inputs.flags },
  }
  return {
    ...placeGroups(parts),
    ...traceGroups(parts),
    ...filterGroups(parts),
    ...pixelGroups(parts),
  }
}

/** The inputs that are one resource each, in the order the identity names them: those of `ScreenProbeInputs` but the proxy,
 *  which names three. A field added to the inputs and left out here fails the compile. */
const INPUT_KEYS = [
  'normals',
  'flags',
  'lights',
  'lightLists',
  'bounceGrid',
  'probes',
  'lightFunction',
  'vectors',
] as const satisfies readonly Exclude<keyof ScreenProbeInputs, 'proxy'>[]
const inputsComplete: Exclude<
  keyof ScreenProbeInputs,
  'proxy' | (typeof INPUT_KEYS)[number]
> extends never
  ? true
  : never = true

/**
 * The groups of a view's kernels over its resources, one set for each parity of the history's turn about, made
 * again only when what the image gives them (`ScreenProbeInputs`) was replaced — the G-buffer grew, the light
 * buffer was replaced — or the spatial filter's passes changed parity: `of(turn, inputs)`.
 */
export function createScreenProbeGroups(
  device: GPUDevice,
  kernels: ScreenProbeKernels,
  resources: ScreenProbeResources,
  passes: number,
) {
  if (!inputsComplete) throw new Error('SCREEN_PROBE_INPUTS')
  const identity = createWebgpuBindIdentity(INPUT_KEYS.length + 3)
  const sets: (ScreenProbeGroups | undefined)[] = [undefined, undefined]
  return (turn: 0 | 1, inputs: ScreenProbeInputs) => {
    const { next } = identity
    let at = 0
    for (const key of INPUT_KEYS) next[at++] = inputs[key]
    next[at++] = inputs.proxy.buffer
    next[at++] = inputs.proxy.worlds
    next[at] = inputs.proxy.tree
    if (identity.moved()) sets[0] = sets[1] = undefined
    return (sets[turn] ??= createGroups(device, kernels, resources, inputs, turn, passes))
  }
}
