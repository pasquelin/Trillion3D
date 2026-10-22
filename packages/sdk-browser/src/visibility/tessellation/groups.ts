import { atlasEntries } from '../../gpu/bind/bindEntries.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { VIS_UNIFORM_BYTES } from '../../gpu/bind/bindLayout.ts'
import { bufferEntry, resourceEntry } from '../../gpu/bind/liveEntries.ts'
import { RASTER_PASS_POST } from '../raster/contract.ts'
import type { GpuRasterInput } from '../raster/types.ts'
import {
  TESS_BINDINGS as B,
  TESS_PROGRAMS,
  type TessBinding,
  type TessProgram,
} from './bindings.ts'
import type { TessellationResources } from './resources.ts'

/** The pyramid a pass's occlusion test reads and its levels uniform: the pass's own, set as the pass
 *  begins (`createTessellation`). */
export type PassPyramid = { view: GPUTextureView; levels: GPUBuffer }

/** What the groups name of the frame: the geometry, the page table and the atlas, which every
 *  program reads — and, of the cut's, the visibility uniform, the cut's masks and the surfaces'
 *  records. The shadow maps' programs read the geometry alone. */
export type TessInput = Pick<
  GpuRasterInput,
  'indices' | 'positions' | 'pages' | 'uvs' | 'normals' | 'textures' | 'sampler'
> &
  Partial<Pick<GpuRasterInput, 'uniform' | 'postUniformOffset' | 'selection' | 'material'>>

/** What the groups name that is not the frame's: the raster's `work` buffer and the pyramid each pass
 *  tests against, which the cut's programs read, and the tessellation's own buffers. */
type Owned = {
  work?: GPUBuffer
  resources: Pick<TessellationResources, 'tess' | 'dispatch' | 'uniforms' | 'occluded'>
  pyramids?: PassPyramid[]
}

/** The entries a binding of `pass` names, read live from the frame (`current`) and from what the
 *  tessellation owns. */
function bindingEntries(
  name: TessBinding,
  pass: number,
  current: () => TessInput,
  { work, resources, pyramids }: Owned,
): GPUBindGroupEntry[] {
  switch (name) {
    case 'indices':
      return [bufferEntry(B.indices, () => current().indices)]
    case 'positions':
      return [bufferEntry(B.positions, () => current().positions)]
    case 'pages':
      return [bufferEntry(B.pages, () => current().pages)]
    case 'uniform':
      return [
        bufferEntry(
          B.uniform,
          () => current().uniform,
          () => (pass === RASTER_PASS_POST ? current().postUniformOffset : 0),
          () => VIS_UNIFORM_BYTES,
        ),
      ]
    case 'tessUniform':
      return [bufferEntry(B.tessUniform, () => resources.uniforms[pass])]
    // Without a cut's selection the image reads no mask (`uni.selectionEnabled`): any read-only
    // `array<u32>` binds, as the binning's does.
    case 'mask':
      return [bufferEntry(B.mask, () => current().selection?.maskBuffer ?? current().indices)]
    case 'tess':
    case 'tessRead':
      return [bufferEntry(B.tess, () => resources.tess)]
    case 'uvs':
      return [bufferEntry(B.uvs, () => current().uvs)]
    case 'color':
      return atlasEntries(B.color, () => current().textures.color)
    case 'material':
      return [resourceEntry(B.material, () => current().material)]
    case 'normals':
      return [resourceEntry(B.normals, () => current().normals)]
    case 'data':
      return atlasEntries(B.data, () => current().textures.data)
    case 'sampler':
      return [resourceEntry(B.sampler, () => current().sampler)]
    case 'work':
      return [bufferEntry(B.work, () => work)]
    case 'dispatch':
      return [bufferEntry(B.dispatch, () => resources.dispatch)]
    case 'pyramid':
      return [resourceEntry(B.pyramid, () => pyramids![pass]!.view)]
    case 'levels':
      return [bufferEntry(B.levels, () => pyramids![pass]!.levels)]
    case 'occluded':
    case 'occludedRead':
      return [bufferEntry(B.occluded, () => resources.occluded)]
  }
}

/**
 * The tessellation's bind groups, one for each program and pass of the cut, each made again only
 * when a resource it names moved (`createWebgpuBindIdentity`): the frame's geometry, page table,
 * atlas and visibility uniform — at the offset of the pass's entry, as the binning's group does
 * (`../raster/bindings.ts`) — and what the tessellation owns. The input is the frame's, read live.
 */
export function createTessellationGroups(
  device: GPUDevice,
  layouts: Partial<Record<TessProgram, GPUBindGroupLayout>>,
  owned: Owned,
) {
  let current: TessInput
  const read = () => current
  const held = new Map<string, { identity: WebgpuBindIdentity; group?: GPUBindGroup }>()
  return {
    /** The group of `program` for `pass` over `input`: the pass's own, made when a resource moved. */
    of(program: TessProgram, pass: number, input: TessInput) {
      current = input
      const key = `${program}${pass}`
      let slot = held.get(key)
      if (!slot) held.set(key, (slot = { identity: createWebgpuBindIdentity() }))
      const layout = layouts[program]!
      slot.identity.entries[0] ??= TESS_PROGRAMS[program].flatMap((name) =>
        bindingEntries(name, pass, read, owned),
      )
      if (slot.identity.entriesMoved(layout)) slot.group = undefined
      return (slot.group ??= device.createBindGroup({
        layout,
        entries: slot.identity.entries[0],
      }))
    },
  }
}
