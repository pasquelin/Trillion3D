import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { heldGroup } from '../../gpu/bind/bindIdentity.ts'
import { COMPUTE, computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { askedComputeStage, dispatchOn } from '../../gpu/core/computeStages.ts'
import { hizDepthBindEntries, hizDepthEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../visibility/hiz/gpu/types.ts'
import { LOCAL_CULL_TILE_SIDE, LOCAL_CULL_VOLUME_GROUP } from './localCullWgsl.ts'
import {
  LOCAL_CULL_BINDING as BINDING,
  LOCAL_CULL_PROGRAM,
  LOCAL_CULL_PYRAMID_PROGRAM,
  type LocalFogDiagnostics,
} from './localPrograms.ts'
import type { LocalFogTiling } from './localTiling.ts'

const LABEL = 'Trillion3D fog local volumes cull'
const CULL_PASS: GPUComputePassDescriptor = { label: LABEL }

/** The layouts of the pass: without the depth pyramid, and with it. */
function layoutsOf(device: GPUDevice) {
  const entries = [
    computeBufferEntry(BINDING.air, 'read-only-storage'),
    computeBufferEntry(BINDING.tiles, 'storage'),
  ]
  return {
    plain: device.createBindGroupLayout({ entries }),
    pyramid: device.createBindGroupLayout({
      entries: [...entries, ...hizDepthEntries(BINDING.hiz, COMPUTE)],
    }),
  }
}

/** The bind group of each kind of the pass over the buffers it runs on, made again only when one of them
 *  moved (`createWebgpuBindIdentity`). */
function heldGroups(device: GPUDevice, layouts: ReturnType<typeof layoutsOf>) {
  const held = { plain: heldGroup(), pyramid: heldGroup() }
  return (kind: 'plain' | 'pyramid', lights: GPUBuffer, tiles: GPUBuffer, hiz?: HizDepth) => {
    const kept = held[kind]
    const { next } = kept.identity
    next[0] = lights
    next[1] = tiles
    next[2] = hiz
    if (kept.identity.moved()) {
      const entries: GPUBindGroupEntry[] = [
        { binding: BINDING.air, resource: { buffer: lights } },
        { binding: BINDING.tiles, resource: { buffer: tiles } },
      ]
      if (hiz) entries.push(...hizDepthBindEntries(BINDING.hiz, hiz))
      kept.group = device.createBindGroup({ label: LABEL, layout: layouts[kind], entries })
    }
    return kept.group!
  }
}

/** The pass of one device: the layouts and the pipelines of its programs, asked off the frame, and the bind
 *  group each last ran over. A refusal to compile is said to the diagnostics last given (`localCullOf`). */
function createLocalCull(device: GPUDevice) {
  const layouts = layoutsOf(device)
  const failed = (error: unknown): void =>
    cull.diag?.diagnosticFailure('fog-local-cull-failed', error)
  const asked = (layout: GPUBindGroupLayout, code: string, entry: string) =>
    askedComputeStage(device, [layout], code, entry, LABEL, failed)
  const stages = {
    plain: asked(layouts.plain, LOCAL_CULL_PROGRAM, 'localCullMain'),
    pyramid: asked(layouts.pyramid, LOCAL_CULL_PYRAMID_PROGRAM, 'localCullMain'),
    volumes: asked(layouts.pyramid, LOCAL_CULL_PYRAMID_PROGRAM, 'localCullVolumesMain'),
  }
  const groupOf = heldGroups(device, layouts)
  const cull = {
    /** Where a refusal to compile is said: the diagnostics of the runtime that last asked for the pass. */
    diag: undefined as LocalFogDiagnostics | undefined,
    /** Whether the pass can run: its program without the pyramid is compiled. */
    get ready() {
      return stages.plain.ready
    },
    /**
     * Writes the lists of the tiles `tiling`, for the `count` volumes the light buffer `lights` holds, into
     * `tiles` in the run `steps`: the tiles' frustums cull, and the depth pyramid `hiz` too where one is given
     * and its programs are compiled — a thread a volume finds the volumes it hides, then a thread a tile
     * lists the rest.
     */
    encode(
      steps: ComputeRun,
      lights: GPUBuffer,
      tiles: GPUBuffer,
      tiling: LocalFogTiling,
      count: number,
      hiz?: HizDepth,
    ) {
      if (!stages.plain.ready) return
      const pyramid = !!hiz && stages.pyramid.ready && stages.volumes.ready
      const kind = pyramid ? 'pyramid' : 'plain'
      const group = groupOf(kind, lights, tiles, pyramid ? hiz : undefined)
      const pass = steps.pass(CULL_PASS)
      if (pyramid) dispatchOn(pass, stages.volumes, group, ceilDiv(count, LOCAL_CULL_VOLUME_GROUP))
      dispatchOn(
        pass,
        stages[kind],
        group,
        ceilDiv(tiling.across, LOCAL_CULL_TILE_SIDE),
        ceilDiv(tiling.down, LOCAL_CULL_TILE_SIDE),
      )
    },
  }
  return cull
}

/** The pass of each device. */
const made = new WeakMap<GPUDevice, ReturnType<typeof createLocalCull>>()

/** The pass of `device`, made at the first image that has a local fog volume; `diag` hears a refusal to
 *  compile it. */
export function localCullOf(device: GPUDevice, diag: LocalFogDiagnostics) {
  let pass = made.get(device)
  if (!pass) made.set(device, (pass = createLocalCull(device)))
  pass.diag = diag
  return pass
}
