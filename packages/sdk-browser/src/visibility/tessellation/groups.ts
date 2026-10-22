import { atlasEntries } from '../../gpu/bind/bindEntries.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { VIS_UNIFORM_BYTES } from '../../gpu/bind/bindLayout.ts'
import { bufferEntry, resourceEntry } from '../../gpu/bind/liveEntries.ts'
import { RASTER_PASS_POST, type RasterPass } from '../raster/contract.ts'
import type { GpuRasterInput } from '../raster/types.ts'
import {
  TESS_BINDINGS as B,
  TESS_PROGRAMS,
  type TessBinding,
  type TessProgram,
} from './bindings.ts'
import type { TessellationResources } from './resources.ts'

/** What the groups name that is not the frame's: the raster's `work` buffer, the tessellation's own
 *  buffers and the displaced records' (`createDisplacementBuffer`). */
type Owned = {
  work: GPUBuffer
  resources: Pick<TessellationResources, 'tess' | 'dispatch' | 'uniforms'>
  displacement: { readonly buffer: GPUBuffer | undefined }
}

/**
 * The tessellation's bind groups, one for each program and pass of the cut, each made again only
 * when a resource it names moved (`createWebgpuBindIdentity`): the frame's geometry, page table,
 * atlas and visibility uniform — at the offset of the pass's entry, as the binning's group does
 * (`../raster/bindings.ts`) — and what the tessellation owns. `input` is the frame's, read live.
 */
export function createTessellationGroups(
  device: GPUDevice,
  layouts: Record<TessProgram, GPUBindGroupLayout>,
  owned: Owned,
) {
  let current: GpuRasterInput
  const { work, resources, displacement } = owned
  /** The entries a binding of `pass` names, read live from the frame and from what is owned. */
  const entries = (name: TessBinding, pass: RasterPass): GPUBindGroupEntry[] => {
    switch (name) {
      case 'indices':
        return [bufferEntry(B.indices, () => current.indices)]
      case 'positions':
        return [bufferEntry(B.positions, () => current.positions)]
      case 'pages':
        return [bufferEntry(B.pages, () => current.pages)]
      case 'uniform':
        return [
          bufferEntry(
            B.uniform,
            () => current.uniform,
            () => (pass === RASTER_PASS_POST ? current.postUniformOffset : 0),
            () => VIS_UNIFORM_BYTES,
          ),
        ]
      case 'tessUniform':
        return [bufferEntry(B.tessUniform, () => resources.uniforms[pass])]
      // Without a cut's selection the image reads no mask (`uni.selectionEnabled`): any
      // read-only `array<u32>` binds, as the binning's does.
      case 'mask':
        return [bufferEntry(B.mask, () => current.selection?.maskBuffer ?? current.indices)]
      case 'tess':
        return [bufferEntry(B.tess, () => resources.tess)]
      case 'disp':
        return [bufferEntry(B.disp, () => displacement.buffer)]
      case 'uvs':
        return [bufferEntry(B.uvs, () => current.uvs)]
      case 'normals':
        return [resourceEntry(B.normals, () => current.normals)]
      case 'data':
        return atlasEntries(B.data, () => current.textures.data)
      case 'sampler':
        return [resourceEntry(B.sampler, () => current.sampler)]
      case 'work':
        return [bufferEntry(B.work, () => work)]
      case 'dispatch':
        return [bufferEntry(B.dispatch, () => resources.dispatch)]
    }
  }
  const held = new Map<string, { identity: WebgpuBindIdentity; group?: GPUBindGroup }>()
  return {
    /** The group of `program` for `pass` over `input`: the pass's own, made when a resource moved. */
    of(program: TessProgram, pass: RasterPass, input: GpuRasterInput) {
      current = input
      const key = `${program}${pass}`
      let slot = held.get(key)
      if (!slot) held.set(key, (slot = { identity: createWebgpuBindIdentity() }))
      const layout = layouts[program]
      slot.identity.entries[0] ??= TESS_PROGRAMS[program].flatMap((name) => entries(name, pass))
      if (slot.identity.entriesMoved(layout)) slot.group = undefined
      return (slot.group ??= device.createBindGroup({
        layout,
        entries: slot.identity.entries[0],
      }))
    },
  }
}
export type TessellationGroups = ReturnType<typeof createTessellationGroups>
