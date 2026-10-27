import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { buffers, groupOf, type GroupParts, type ScreenProbeInputs } from './groupParts.ts'
import { RAYS_BINDINGS, RAYS_PROBES } from './importanceWgsl.ts'
import type { CastKernels, ScreenProbeKernels } from './kernels.ts'
import { SCATTER_BINDINGS, SCATTER_PROBES } from './cacheScatterWgsl.ts'
import { PLACE_BINDINGS } from './placeWgsl.ts'
import type { ScreenProbeResources } from './resources.ts'
import { SCREEN_DATA_BINDINGS } from './screenDataWgsl.ts'
import { filterGroups, pixelGroups, traceGroups } from './traceGroups.ts'

/** The bind groups of every kernel for one parity of the history's turn about. */
export type ScreenProbeGroups = ReturnType<typeof createGroups>

/** The placement and the screen data. */
function placeGroups(g: GroupParts, kernels: CastKernels) {
  const { device, r, inputs, last, common, probe, records, surface } = g
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
        depth: r.depth[last],
        shading: r.shading[last],
        vectors: inputs.vectors,
        blue: inputs.blue,
        ...buffers({ brdf: r.brdf, disocclusion: r.disocclusion }),
      }),
    ),
  }
}

/** The scatter of the pixels' importance into the radiance cache and the directions of the rays. */
function rayGroups(g: GroupParts, kernels: CastKernels) {
  const { device, r, inputs, last, final, common, probe, records } = g
  return {
    scatter: groupOf(device, kernels.scatter, [
      ...namedEntries(SCATTER_BINDINGS.at, {
        ...common,
        ...probe,
        ...buffers({
          counts: r.counts,
          brdf: r.brdf,
          pdf: inputs.cachePdf,
          bounceGrid: inputs.bounceGrid,
        }),
      }),
      { binding: SCATTER_PROBES, resource: inputs.probes },
    ]),
    rays: groupOf(device, kernels.rays, [
      ...namedEntries(RAYS_BINDINGS.at, {
        ...common,
        ...records,
        historyInfo: r.info[last],
        historyGather: r.gather[final],
        ray: r.ray,
        blue: inputs.blue,
        cacheFinal: inputs.cacheFinal,
        cacheRaw: inputs.cacheRaw,
        cacheSky: inputs.cacheSky,
        ...buffers({
          brdf: r.brdf,
          bounceGrid: inputs.bounceGrid,
          lights: inputs.lights,
          cacheTags: inputs.cacheTags,
        }),
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
  const { cast } = kernels
  return {
    ...pixelGroups(parts, kernels),
    /** The groups of the kernels over the probes, where the level casts them. */
    cast: cast && {
      ...placeGroups(parts, cast),
      ...rayGroups(parts, cast),
      ...traceGroups(parts, cast),
      ...filterGroups(parts, cast),
    },
  }
}

/** The inputs that are one resource each, those of `ScreenProbeInputs` but the field and the hit's, which name several: a field added to the
 *  inputs and left out of this table fails the compile. The identity names them in this order. */
const INPUT_SLOT: Record<Exclude<keyof ScreenProbeInputs, 'field' | 'hit'>, true> = {
  normals: true,
  flags: true,
  lights: true,
  bounceGrid: true,
  probes: true,
  vectors: true,
  blue: true,
  cacheFinal: true,
  cacheRaw: true,
  cacheSky: true,
  cacheTags: true,
  cachePdf: true,
}
const INPUT_KEYS = Object.keys(INPUT_SLOT) as (keyof typeof INPUT_SLOT)[]
/** The hit's resources the identity names after the inputs and the field's generation. */
const HIT_KEYS = ['tables', 'depth', 'final', 'grid', 'instances'] as const

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
  const identity = createWebgpuBindIdentity(INPUT_KEYS.length + 1 + HIT_KEYS.length)
  const sets: (ScreenProbeGroups | undefined)[] = [undefined, undefined]
  return (turn: 0 | 1, inputs: ScreenProbeInputs) => {
    const { next } = identity
    let at = 0
    for (const key of INPUT_KEYS) next[at++] = inputs[key]
    next[at++] = inputs.field.readGeneration
    for (const key of HIT_KEYS) next[at++] = inputs.hit[key]
    if (identity.moved()) sets[0] = sets[1] = undefined
    return (sets[turn] ??= createGroups(device, kernels, resources, inputs, turn, passes))
  }
}
